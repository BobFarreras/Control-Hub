import { randomUUID } from "node:crypto";
import { parseApiEnvironment } from "@control-hub/config";
import { createDatabaseClient, withTenant } from "@control-hub/database";
import { createAuth } from "./auth.js";
import { parseBootstrapInput } from "./bootstrap-input.js";
import { provisionTenantWithOwner } from "./provisioning.js";

/**
 * The one-off that gives an installation its tenant and its first Owner.
 *
 * It runs from the API image as well as from a checkout: `tsup` emits `dist/bootstrap.js` beside
 * `dist/server.js`, because a production installation has no source tree and the runbook's «the
 * equivalent OCI job» has to be something that exists. It needs the migration role rather than the
 * application one -- `control_hub_app` has `select` on `tenants` and nothing more, which is correct
 * and is exactly why this cannot run as the API does.
 *
 * Nobody is asked for a password. See `bootstrap-input.ts` for why, and read the end of this file
 * for what happens instead.
 */
const environment = parseApiEnvironment({
  ...process.env,
  DATABASE_URL: process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL
});
const input = parseBootstrapInput(process.env);

const database = createDatabaseClient(environment.DATABASE_URL);
try {
  const existing = await database<{ count: number }[]>`select count(*)::int as count from tenants`;
  if (existing[0]?.count !== 0) throw new Error("Bootstrap refused: this installation already has a tenant");
  const auth = createAuth(environment, { allowSignUp: true });
  const existingUser = await database<{ id: string }[]>`select id from "user" where email = ${input.email}`;
  const result = existingUser[0]
    ? { user: existingUser[0] }
    : await auth.api.signUpEmail({ body: { email: input.email, password: input.password, name: input.name } });
  if (!result.user) throw new Error("Owner account creation failed");
  const tenantId = randomUUID();
  await provisionTenantWithOwner(database, {
    tenantId,
    slug: input.tenantSlug,
    name: input.tenantName,
    ownerUserId: result.user.id
  });
  await withTenant(
    database,
    tenantId,
    async (transaction) => transaction`
    insert into audit_log (id, tenant_id, actor_user_id, action, target_type, target_id, outcome)
    values (${randomUUID()}, ${tenantId}, ${result.user.id}, 'installation.bootstrap', 'tenant', ${tenantId}, 'success')
  `
  );

  /**
   * The Owner sets their own password, through the same reset flow every other member uses.
   *
   * The generated password is discarded here without ever being displayed, which is what makes the
   * invariant true: there is no password in the terminal, in a log, or in a file. The cost is that
   * this mail is the only way into the account, so a failure to send it must be loud -- an
   * installation whose Owner never receives the link is finished and unusable, and the bootstrap
   * refuses to run a second time.
   */
  if (input.passwordIsOurs) {
    try {
      await auth.api.requestPasswordReset({
        body: { email: input.email, redirectTo: `${environment.APP_ORIGIN}/reset-password` }
      });
      console.info(`Control Hub bootstrap completed. A link to set the Owner password was sent to ${input.email}.`);
      console.info("Verify the address, set a password and enable MFA before using protected modules.");
    } catch (error) {
      console.error(`The Owner account exists but the mail to ${input.email} could not be sent.`);
      console.error("Fix SMTP, then use «forgot password» on the sign-in page -- do not run this again.");
      throw error;
    }
  } else {
    console.info(
      "Control Hub bootstrap completed. Verify the Owner email and enable MFA before using protected modules."
    );
  }
  await auth.close();
} finally {
  await database.end({ timeout: 5 });
}
process.exit(0);

import { randomUUID } from "node:crypto";
import { parseApiEnvironment } from "@control-hub/config";
import { createDatabaseClient, withTenant } from "@control-hub/database";
import { rolePermissions, type RoleCode } from "@control-hub/domain";
import { createAuth } from "./auth.js";

const environment = parseApiEnvironment({
  ...process.env,
  DATABASE_URL: process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL
});
const email = process.env.BOOTSTRAP_OWNER_EMAIL?.trim().toLowerCase();
const password = process.env.BOOTSTRAP_OWNER_PASSWORD;
const name = process.env.BOOTSTRAP_OWNER_NAME?.trim();
const tenantName = process.env.BOOTSTRAP_TENANT_NAME?.trim();
const tenantSlug = process.env.BOOTSTRAP_TENANT_SLUG?.trim();
if (
  !email ||
  !password ||
  password.length < 12 ||
  !name ||
  !tenantName ||
  !tenantSlug?.match(/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/)
) {
  throw new Error(
    "BOOTSTRAP_OWNER_EMAIL, BOOTSTRAP_OWNER_PASSWORD (12+), BOOTSTRAP_OWNER_NAME, BOOTSTRAP_TENANT_NAME and a valid BOOTSTRAP_TENANT_SLUG are required"
  );
}

const database = createDatabaseClient(environment.DATABASE_URL);
try {
  const existing = await database<{ count: number }[]>`select count(*)::int as count from tenants`;
  if (existing[0]?.count !== 0) throw new Error("Bootstrap refused: this installation already has a tenant");
  const auth = createAuth(environment, { allowSignUp: true });
  const existingUser = await database<{ id: string }[]>`select id from "user" where email = ${email}`;
  const result = existingUser[0]
    ? { user: existingUser[0] }
    : await auth.api.signUpEmail({ body: { email, password, name } });
  if (!result.user) throw new Error("Owner account creation failed");
  const tenantId = randomUUID();
  await database.begin(async (transaction) => {
    await transaction`insert into tenants (id, slug, name) values (${tenantId}, ${tenantSlug}, ${tenantName})`;
    await transaction`select set_config('app.tenant_id', ${tenantId}, true)`;
    await transaction`insert into tenant_settings (tenant_id, brand_name) values (${tenantId}, ${tenantName})`;
    const membershipId = randomUUID();
    await transaction`insert into memberships (id, tenant_id, user_id) values (${membershipId}, ${tenantId}, ${result.user.id})`;
    for (const roleCode of Object.keys(rolePermissions) as RoleCode[]) {
      const roleId = randomUUID();
      await transaction`insert into roles (id, tenant_id, code, name) values (${roleId}, ${tenantId}, ${roleCode}, ${roleCode})`;
      for (const permission of rolePermissions[roleCode])
        await transaction`insert into role_permissions (role_id, permission_code) values (${roleId}, ${permission})`;
      if (roleCode === "owner")
        await transaction`insert into membership_roles (membership_id, role_id) values (${membershipId}, ${roleId})`;
    }
  });
  await withTenant(
    database,
    tenantId,
    async (transaction) => transaction`
    insert into audit_log (id, tenant_id, actor_user_id, action, target_type, target_id, outcome)
    values (${randomUUID()}, ${tenantId}, ${result.user.id}, 'installation.bootstrap', 'tenant', ${tenantId}, 'success')
  `
  );
  await auth.close();
  console.info(
    "Control Hub bootstrap completed. Verify the Owner email and enable MFA before using protected modules."
  );
} finally {
  await database.end({ timeout: 5 });
}
process.exit(0);

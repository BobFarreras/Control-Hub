import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute } from "node:path";
import { parseApiEnvironment } from "@control-hub/config";
import { createDatabaseClient } from "@control-hub/database";
import { createAuth } from "./auth.js";
import { provisionTenantWithOwner } from "./provisioning.js";

/**
 * The fixture behind the authenticated end to end suite.
 *
 * The point of it is that the suite can sign in for real. The second factor is mandatory for
 * every account and stays mandatory here: this script does not disable it, it *enrols* it,
 * through the same `enable` then `verify` pair the security page drives, and then refuses to
 * hand over any credentials unless the database confirms the account came out with the factor
 * switched on. What makes the run automatable is not a weakened control, it is that the TOTP
 * secret of this one throwaway account is known to this one throwaway environment.
 *
 * Nothing here is a secret in the repository. The address, the password and the database all
 * arrive from the environment, and the generated secret is written to a path the caller names,
 * outside version control.
 */

if (!process.argv.includes("--confirm-test")) throw new Error("The end to end seed requires --confirm-test");
if (process.env.NODE_ENV === "production") throw new Error("The end to end seed is disabled in production");

const databaseUrl = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("MIGRATION_DATABASE_URL or DATABASE_URL is required");

/**
 * Two independent guards, because this script rewrites the account it finds. A database that
 * is merely local can still be the one somebody has been developing against all week, so the
 * name has to say out loud that it exists to be thrown away.
 */
const parsed = new URL(databaseUrl);
if (!["localhost", "127.0.0.1", "::1"].includes(parsed.hostname))
  throw new Error("The end to end seed only accepts a local database");
if (!/_e2e$/.test(parsed.pathname))
  throw new Error(`The end to end seed only accepts a database whose name ends in _e2e, got ${parsed.pathname}`);

const email = process.env.E2E_OWNER_EMAIL?.trim().toLowerCase();
const password = process.env.E2E_OWNER_PASSWORD;
const credentialsPath = process.env.E2E_CREDENTIALS_FILE;
if (!email || !password || password.length < 12 || !credentialsPath)
  throw new Error("E2E_OWNER_EMAIL, E2E_OWNER_PASSWORD (12+ characters) and E2E_CREDENTIALS_FILE are required");
// Absolute, because this runs inside the api package while every caller thinks in repository
// paths, and a secret written one directory off is a secret nobody knows they have.
if (!isAbsolute(credentialsPath)) throw new Error("E2E_CREDENTIALS_FILE must be an absolute path");

const tenantName = process.env.E2E_TENANT_NAME?.trim() || "Control Hub E2E";
const tenantSlug = process.env.E2E_TENANT_SLUG?.trim() || "control-hub-e2e";
const ownerName = process.env.E2E_OWNER_NAME?.trim() || "E2E Owner";

/** Stable ids from a label, so a second run updates the same rows instead of stacking new ones. */
function id(scope: string) {
  const value = createHash("sha256").update(scope).digest("hex").slice(0, 32);
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-4${value.slice(13, 16)}-a${value.slice(17, 20)}-${value.slice(20)}`;
}

/**
 * RFC 4648 base32, to turn the secret Better Auth publishes in the enrolment URI back into the
 * string it keys the HMAC with, which is what its own code generator expects. The suite has the
 * matching decoder in `tests/e2e/support/totp.ts`, pinned to the RFC vectors there; this copy is
 * a handful of lines rather than a dependency shared across an app and a test harness.
 */
function decodeBase32(secret: string): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const character of secret.replace(/=+$/u, "").toUpperCase()) {
    const value = alphabet.indexOf(character);
    if (value < 0) throw new Error("The enrolment URI carried a secret that is not base32");
    buffer = (buffer << 5) | value;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  return Buffer.from(bytes).toString();
}

/** Better Auth answers with `set-cookie`; the next call has to send it back as `cookie`. */
function sessionCookie(headers: Headers): string {
  const cookies = headers.getSetCookie();
  if (cookies.length === 0) throw new Error("Signing in returned no session cookie");
  return cookies.map((cookie) => cookie.split(";")[0]).join("; ");
}

const environment = parseApiEnvironment({ ...process.env, DATABASE_URL: databaseUrl });
const database = createDatabaseClient(databaseUrl);
const auth = createAuth(environment, { allowSignUp: true });

try {
  // ---------------------------------------------------------------- the account and its tenant

  const existingUser = await database<{ id: string }[]>`select id from "user" where email = ${email}`;
  const userId =
    existingUser[0]?.id ?? (await auth.api.signUpEmail({ body: { email, password, name: ownerName } })).user?.id;
  if (!userId) throw new Error("Creating the end to end owner failed");

  // Verified by fiat, because no mailbox is going to be opened by a browser in CI. This is a
  // property of the fixture account, not a relaxation of the rule: sign-in still demands it.
  await database`update "user" set "emailVerified" = true where id = ${userId}`;

  const existingTenant = await database<{ tenant_id: string }[]>`
    select tenant_id from memberships where user_id = ${userId} order by created_at limit 1`;
  const tenantId = existingTenant[0]?.tenant_id ?? id(`${tenantSlug}:tenant`);
  if (!existingTenant[0])
    await provisionTenantWithOwner(database, { tenantId, slug: tenantSlug, name: tenantName, ownerUserId: userId });

  const [membership] = await database<{ id: string }[]>`
    select id from memberships where tenant_id = ${tenantId} and user_id = ${userId}`;
  if (!membership) throw new Error("The end to end owner has no membership");

  // ------------------------------------------------------------------------ the second factor

  /**
   * Enrolment is redone on every run. A previous run left the account with the factor on, and
   * its secret was never stored anywhere this process can read, so there would be no way to
   * sign in and re-enrol. Clearing the enrolment of a throwaway account in a throwaway database
   * is how the fixture is rebuilt; the account is never left without a factor, because the
   * assertion below refuses to continue unless it ends up with one.
   */
  await database`delete from "twoFactor" where "userId" = ${userId}`;
  await database`update "user" set "twoFactorEnabled" = false where id = ${userId}`;
  await database`delete from session where "userId" = ${userId}`;

  const signIn = await auth.api.signInEmail({ body: { email, password }, returnHeaders: true });
  const cookie = sessionCookie(signIn.headers);

  const enrolment = await auth.api.enableTwoFactor({
    body: { password },
    headers: new Headers({ cookie })
  });
  const totpUri = enrolment.totpURI;
  const base32Secret = new URL(totpUri).searchParams.get("secret");
  if (!base32Secret) throw new Error("Enrolment returned no TOTP secret");

  // Completing enrolment the way a person does: a code produced from the freshly issued secret,
  // checked by Better Auth. Only this flips `twoFactorEnabled`.
  const { code } = await auth.api.generateTOTP({ body: { secret: decodeBase32(base32Secret) } });
  await auth.api.verifyTOTP({ body: { code }, headers: new Headers({ cookie }) });

  const [enrolled] = await database<{ twoFactorEnabled: boolean | null }[]>`
    select "twoFactorEnabled" from "user" where id = ${userId}`;
  if (!enrolled?.twoFactorEnabled)
    throw new Error("Refusing to continue: the end to end owner did not end up with a second factor");

  // The session that enrolled the factor never went through it. Leaving it usable would let the
  // suite pass with a cookie that predates the control it is meant to exercise.
  await database`delete from session where "userId" = ${userId}`;

  // --------------------------------------------------------------------------- support fixture

  // The schedule and the targets come first: a ticket copies the targets when it opens and
  // cannot be created at all without them.
  for (const weekday of [1, 2, 3, 4, 5])
    await database`
      insert into support_schedule (id, tenant_id, weekday, opens_at, closes_at)
      values (${id(`${tenantId}:schedule:${weekday}`)}, ${tenantId}, ${weekday}, '08:00', '16:00')
      on conflict do nothing`;

  const slaTargets = [
    ["low", 480, 4800],
    ["normal", 240, 2400],
    ["high", 60, 480],
    ["urgent", 15, 240]
  ] as const;
  for (const [priority, firstResponse, resolution] of slaTargets)
    await database`
      insert into sla_targets (id, tenant_id, priority, first_response_minutes, resolution_minutes, effective_from)
      values (${id(`${tenantId}:sla:${priority}`)}, ${tenantId}, ${priority}, ${firstResponse}, ${resolution}, '2020-01-01T00:00:00Z')
      on conflict do nothing`;

  const customers = [
    ["Far Harbour Logistics", "ops@far-harbour.example.test"],
    ["Vallmar Clinics", "admin@vallmar.example.test"],
    ["Tramuntana Foods", "hello@tramuntana.example.test"]
  ] as const;
  for (const [name, billingEmail] of customers)
    await database`
      insert into customers (id, tenant_id, display_name, normalized_name, billing_email, normalized_billing_email)
      values (${id(`${tenantId}:customer:${billingEmail}`)}, ${tenantId}, ${name}, ${name.toLowerCase()}, ${billingEmail}, ${billingEmail})
      on conflict do nothing`;

  /**
   * Every ticket here has a job.
   *
   * The two at the top pin the commitment column to a value the clock cannot move: one opened
   * a quarter ago against a fifteen minute target is past it under any calendar, and one opened
   * now against an eight hour target is inside it under any calendar. Without that pair the
   * column could only be asserted on whichever branch the CI runner happened to land in.
   *
   * The rest are the ones the suite mutates, one each, so a status change in one test cannot
   * decide the outcome of another.
   *
   * Status, assignee and the opening time are reset on every run. The suite changes exactly
   * those, and a fixture that kept whatever the last run left behind would pass once and then
   * fail against a ticket that is already in the state the test means to move it to.
   */
  const tickets = [
    {
      key: "breached",
      subject: "E2E La passarel·la de pagament rebutja totes les targetes",
      priority: "urgent",
      status: "open",
      openedMinutesAgo: 90 * 24 * 60
    },
    {
      key: "within",
      subject: "E2E Revisar els textos legals del peu de pagina",
      priority: "low",
      status: "new",
      openedMinutesAgo: 0
    },
    {
      key: "conversation",
      subject: "E2E La sincronitzacio nocturna ha fallat dues nits seguides",
      priority: "high",
      status: "open",
      openedMinutesAgo: 180
    },
    {
      key: "transition",
      subject: "E2E Sol·licitud d'alta d'un usuari nou",
      priority: "normal",
      status: "new",
      openedMinutesAgo: 120
    },
    {
      key: "assignment",
      subject: "E2E La còpia de seguretat setmanal no s'ha completat",
      priority: "normal",
      status: "open",
      openedMinutesAgo: 300
    }
  ] as const;

  const ticketIds = new Map<string, string>();
  let ticketNumber = 0;
  for (const ticket of tickets) {
    ticketNumber += 1;
    const ticketId = id(`${tenantId}:ticket:${ticket.key}`);
    ticketIds.set(ticket.key, ticketId);
    const [, firstResponseMinutes, resolutionMinutes] = slaTargets.find(([code]) => code === ticket.priority)!;
    const customerId = id(`${tenantId}:customer:${customers[ticketNumber % customers.length]![1]}`);
    await database`
      insert into tickets (
        id, tenant_id, ticket_number, customer_id, subject, description, status, priority, category,
        opened_at, first_response_target_minutes, resolution_target_minutes
      )
      values (
        ${ticketId}, ${tenantId}, ${ticketNumber}, ${customerId}, ${ticket.subject},
        'Ticket sembrat per a les proves end-to-end.', ${ticket.status}, ${ticket.priority}, 'general',
        now() - ${`${ticket.openedMinutesAgo} minutes`}::interval, ${firstResponseMinutes}, ${resolutionMinutes}
      )
      on conflict (id) do update set
        status = excluded.status,
        assignee_membership_id = null,
        opened_at = excluded.opened_at,
        first_response_at = null,
        updated_at = now()`;
  }
  await database`
    insert into ticket_counters (tenant_id, next_number) values (${tenantId}, ${tickets.length + 1})
    on conflict (tenant_id) do update set next_number = greatest(ticket_counters.next_number, ${tickets.length + 1})`;

  /**
   * The conversation the suite reads. The internal note is the one that matters: leaking it is
   * the principal threat recorded in `docs/specifications/support.md`, and the test asserts it
   * is marked as internal in the markup rather than only painted a different colour.
   *
   * Messages are append-only, so a re-run cannot update them; the deterministic id and the
   * conflict clause are what make a second run a no-op instead of a duplicate thread.
   */
  const conversationId = ticketIds.get("conversation")!;
  const conversation = [
    {
      key: "customer-reply",
      visibility: "customer",
      body: "Bon dia, hem revisat els registres i la sincronitzacio torna a fallar a les 02:00.",
      minutesAgo: 150
    },
    {
      key: "internal-note",
      visibility: "internal",
      body: "Nota interna: la clau API del client caduca divendres, cal renovar-la abans de respondre.",
      minutesAgo: 120
    }
  ] as const;
  for (const message of conversation)
    await database`
      insert into ticket_messages (id, tenant_id, ticket_id, author_membership_id, body, visibility, created_at)
      values (
        ${id(`${tenantId}:message:${message.key}`)}, ${tenantId}, ${conversationId}, ${membership.id},
        ${message.body}, ${message.visibility}, now() - ${`${message.minutesAgo} minutes`}::interval
      )
      on conflict do nothing`;
  // A customer-visible reply from a member is exactly what first response means, so the ticket
  // records one; leaving it null would show a stage the thread contradicts.
  await database`
    update tickets set first_response_at = (
      select min(created_at) from ticket_messages
      where tenant_id = ${tenantId} and ticket_id = ${conversationId} and visibility = 'customer'
    )
    where tenant_id = ${tenantId} and id = ${conversationId} and first_response_at is null`;

  // ------------------------------------------------------------------------- hand over the keys

  await mkdir(dirname(credentialsPath), { recursive: true });
  await writeFile(
    credentialsPath,
    `${JSON.stringify(
      {
        email,
        password,
        totpUri,
        tenantId,
        membershipId: membership.id,
        ownerName,
        tickets: Object.fromEntries(ticketIds),
        subjects: Object.fromEntries(tickets.map((ticket) => [ticket.key, ticket.subject])),
        internalNote: conversation.find((message) => message.visibility === "internal")!.body,
        customerReply: conversation.find((message) => message.visibility === "customer")!.body
      },
      null,
      2
    )}\n`,
    { encoding: "utf8", mode: 0o600 }
  );

  console.info(
    `End to end fixture ready for tenant ${tenantId}: owner with a verified second factor, ${customers.length} customers and ${tickets.length} tickets. Credentials written to ${credentialsPath}.`
  );
} finally {
  await auth.close();
  await database.end({ timeout: 5 });
}
process.exit(0);

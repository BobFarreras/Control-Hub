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

  const commerceFixture = {
    customer: customers[0][0],
    product: "E2E Agent de veu",
    plan: "Professional"
  } as const;
  const productId = id(`${tenantId}:product:e2e-voice-agent`);
  const versionId = id(`${tenantId}:version:e2e-voice-agent:1.0.0`);
  const planId = id(`${tenantId}:plan:e2e-voice-agent:professional`);
  await database`
    insert into products (id, tenant_id, code, name, description)
    values (${productId}, ${tenantId}, 'e2e-voice-agent', ${commerceFixture.product}, 'Oferta recurrent per a proves E2E')
    on conflict do nothing`;
  await database`
    insert into product_versions (id, tenant_id, product_id, version, status, released_at)
    values (${versionId}, ${tenantId}, ${productId}, '1.0.0', 'active', '2026-01-01T00:00:00Z')
    on conflict do nothing`;
  await database`
    insert into plans (id, tenant_id, product_version_id, code, name, commercial_model)
    values (${planId}, ${tenantId}, ${versionId}, 'e2e-voice-agent-pro', ${commerceFixture.plan}, 'subscription')
    on conflict do nothing`;
  await database`
    insert into plan_prices
      (id, tenant_id, plan_id, currency, amount_minor, cost_minor, tax_basis_points, billing_interval, effective_from)
    values
      (${id(`${tenantId}:price:e2e-voice-agent:professional`)}, ${tenantId}, ${planId}, 'EUR', 9900, 2500, 2100,
       'monthly', '2026-01-01T00:00:00Z')
    on conflict do nothing`;

  /**
   * Every ticket here has a job.
   *
   * The two at the top pin the commitment column to a value the clock cannot move: one opened
   * a quarter ago against a fifteen minute target is past it under any calendar, and one opened
   * now against an eight hour target is inside it under any calendar. Without that pair the
   * column could only be asserted on whichever branch the CI runner happened to land in.
   *
   * The third carries the conversation the suite reads.
   *
   * **Nothing seeded here is mutated by a test.** The two tests that change a status and an
   * assignee open a ticket of their own through the dialog, because those moves are one way: a
   * seeded row would be in the target state already on the second attempt, and Playwright retries.
   * Resetting on every run is not enough — a retry happens inside one run, long after this seed.
   *
   * Status, assignee and the opening time are still reset, so a database left over from an older
   * revision of the suite cannot decide what these rows say today.
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

  // -------------------------------------------------------------------- infrastructure fixture

  /**
   * An n8n integration nobody has to reach.
   *
   * The screen composes the address of a workflow out of the base configured here and the id the
   * provider gave, and the suite asserts the address it composed rather than following it: what
   * is under test is that we build the link, not that an n8n is listening on this machine. The
   * base is a loopback address for that same reason -- a fixture naming a real host would be a
   * fixture that could reach one.
   *
   * Two workflows, because one of them has to be old. A reading whose age the screen has to
   * report as stale cannot be produced by a fresh seed; it has to be seeded stale.
   */
  const infrastructureFixture = {
    instance: "n8n E2E",
    baseUrl: "http://127.0.0.1:5678",
    fresh: { externalId: "workflow:e2e-fresh", name: "E2E Sincronitzacio nocturna" },
    stale: { externalId: "workflow:e2e-stale", name: "E2E Informe setmanal" },
    rule: "E2E Automatitzacio que falla",
    customer: customers[0][0],
    /**
     * The machine and the three answers a reading can give.
     *
     * `up` is a container whose reading keeps moving, `down` is one that stopped moving hours ago
     * while the collector kept passing, and `unknown` is a probe of an operation no pass has ever
     * reported. The third one is the reason this fixture exists at all: it can only be produced by
     * a collector that never ran, and the difference between "it is down" and "we cannot see it"
     * is the one this screen must never blur.
     */
    host: { name: "E2E VPS principal", hostname: "e2e-vps" },
    /**
     * The collector, and a label it reads that nobody has declared.
     *
     * The discovery is about exactly this pair: one machine whose `hostname` was typed
     * correctly and one the collector can see and the inventory has never heard of. The second
     * one shows on no other screen -- the inventory lists what somebody declared -- which is why
     * the seed has to carry it and why it cannot be produced by declaring something here.
     */
    collector: "Prometheus E2E",
    undeclaredHostname: "e2e-vps-nou",
    /**
     * What the collector reads and nobody has declared.
     *
     * The selector's reason to exist, and the one thing a seed can carry that the product cannot
     * produce: a label read from outside that no one has claimed. A container and a backup, so
     * the grouping by kind is exercised by more than one group. The names are the ones the domain
     * proposes -- the identifier with the prefix taken off -- so the test can look for them
     * without repeating that derivation here.
     */
    offered: {
      container: { name: "e2e-cua", matchKey: "container:e2e-cua" },
      backup: { name: "e2e-nocturn", matchKey: "backup:e2e-nocturn" }
    },
    services: {
      up: { name: "E2E Base de dades", matchKey: "container:e2e-postgres" },
      down: { name: "E2E Panell antic", matchKey: "container:e2e-panell" },
      unknown: { name: "E2E Portal public", matchKey: "probe:e2e-portal" }
    },
    /**
     * The hosting provider, and the two answers a project row has to hold at the same time.
     *
     * `serving` is production up right now with a build that failed after it: the ordinary Friday
     * afternoon, and the reason the screen has two columns instead of one. `never` is a project
     * nobody has deployed, whose production is neither up nor down -- an answer that cannot be
     * produced by deploying anything, so it has to be seeded.
     */
    vercel: "Vercel E2E",
    projects: {
      serving: {
        externalId: "project:e2e-web",
        name: "E2E Web publica",
        domain: "e2e-client.example",
        failureRef: "fix/preus"
      },
      never: { externalId: "project:e2e-nova", name: "E2E Web nova" }
    }
  } as const;

  const connectorInstanceId = id(`${tenantId}:connector:n8n-e2e`);
  await database`
    insert into connector_instances (id, tenant_id, connector_type, name, status, config, health_status)
    values (
      ${connectorInstanceId}, ${tenantId}, 'n8n', ${infrastructureFixture.instance}, 'enabled',
      ${database.json({ baseUrl: infrastructureFixture.baseUrl })}, 'unknown'
    )
    on conflict (id) do update set status = excluded.status, config = excluded.config, updated_at = now()`;

  const workflows = [
    { entry: infrastructureFixture.fresh, active: true, minutesAgo: 2 },
    { entry: infrastructureFixture.stale, active: false, minutesAgo: 300 }
  ] as const;
  for (const workflow of workflows)
    await database`
      insert into connector_records (
        id, tenant_id, instance_id, operation, external_id, shape, data, first_seen_at, last_seen_at
      )
      values (
        ${id(`${tenantId}:record:${workflow.entry.externalId}`)}, ${tenantId}, ${connectorInstanceId},
        'pull_workflows', ${workflow.entry.externalId}, 'state',
        ${database.json({ name: workflow.entry.name, active: workflow.active, archived: false, tags: ["e2e"] })},
        now() - '2 days'::interval, now() - ${`${workflow.minutesAgo} minutes`}::interval
      )
      on conflict (tenant_id, instance_id, operation, external_id) do update
        set data = excluded.data, last_seen_at = excluded.last_seen_at`;

  const alertRuleId = id(`${tenantId}:infra-rule:workflow-failed`);
  await database`
    insert into infra_alert_rules (
      id, tenant_id, name, kind, instance_id, target_type, target_id, params, severity,
      freshness_seconds, opens_incident, enabled
    )
    values (
      ${alertRuleId}, ${tenantId}, ${infrastructureFixture.rule}, 'workflow_failed', ${connectorInstanceId},
      'instance', null, ${database.json({ withinMinutes: 60, minimumFailures: 1 })}, 'high', 900, false, true
    )
    on conflict (id) do update set enabled = true, severity = excluded.severity, updated_at = now()`;

  /**
   * One live alert, so the suite has something to acknowledge.
   *
   * Reset on every run, and for the same reason the tickets are: acknowledging is one way, and a
   * Playwright retry happens inside a run, long after this seed. The sweep would be the other way
   * to produce one, and it is not what this suite is testing.
   */
  await database`
    insert into infra_alert_events (
      id, tenant_id, rule_id, dedup_key, status, severity, summary, started_at, last_seen_at, occurrences
    )
    values (
      ${id(`${tenantId}:infra-alert:workflow-failed`)}, ${tenantId}, ${alertRuleId},
      ${infrastructureFixture.fresh.externalId}, 'firing', 'high',
      ${database.json({ workflowId: "e2e-fresh", failures: "2" })},
      now() - '30 minutes'::interval, now(), 2
    )
    on conflict (id) do update set
      status = 'firing',
      resolved_at = null,
      acknowledged_at = null,
      acknowledged_by_membership_id = null,
      last_seen_at = now(),
      occurrences = excluded.occurrences`;

  // The association the screen shows in the client column, so the suite reads one it did not
  // have to create first.
  await database`
    insert into infra_automation_links (id, tenant_id, instance_id, external_id, customer_id)
    values (
      ${id(`${tenantId}:infra-link:fresh`)}, ${tenantId}, ${connectorInstanceId},
      ${infrastructureFixture.fresh.externalId}, ${id(`${tenantId}:customer:${customers[0][1]}`)}
    )
    on conflict (tenant_id, instance_id, external_id) do update
      set customer_id = excluded.customer_id, updated_at = now()`;

  /**
   * The hosting provider, seeded in the state a pass would have left behind.
   *
   * The base is the provider's own and the only one the connector accepts, and nothing here
   * reaches it: no pass runs during the suite, and what the screen draws is these rows. The
   * failed deployment is a record of its own, because a build that broke is an event and the
   * production that is still serving is a state -- two claims, and the screen says both.
   */
  const vercelInstanceId = id(`${tenantId}:connector:vercel-e2e`);
  await database`
    insert into connector_instances (id, tenant_id, connector_type, name, status, config, health_status)
    values (
      ${vercelInstanceId}, ${tenantId}, 'vercel', ${infrastructureFixture.vercel}, 'enabled',
      ${database.json({ baseUrl: "https://api.vercel.com", includePreview: false, deploymentsWindowHours: 24 })},
      'unknown'
    )
    on conflict (id) do update set status = excluded.status, config = excluded.config, updated_at = now()`;

  const projectRecords = [
    {
      externalId: infrastructureFixture.projects.serving.externalId,
      data: {
        name: infrastructureFixture.projects.serving.name,
        framework: "nextjs",
        productionReady: true,
        productionState: "READY",
        productionDeployedAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
        productionAlias: infrastructureFixture.projects.serving.domain,
        createdAt: "2026-01-02T00:00:00.000Z"
      }
    },
    {
      externalId: infrastructureFixture.projects.never.externalId,
      data: {
        name: infrastructureFixture.projects.never.name,
        framework: null,
        productionReady: null,
        productionState: null,
        productionDeployedAt: null,
        productionAlias: null,
        createdAt: "2026-08-01T00:00:00.000Z"
      }
    }
  ] as const;
  for (const project of projectRecords)
    await database`
      insert into connector_records (
        id, tenant_id, instance_id, operation, external_id, shape, data, first_seen_at, last_seen_at
      )
      values (
        ${id(`${tenantId}:record:${project.externalId}`)}, ${tenantId}, ${vercelInstanceId},
        'pull_projects', ${project.externalId}, 'state', ${database.json(project.data)},
        now() - '2 days'::interval, now() - '2 minutes'::interval
      )
      on conflict (tenant_id, instance_id, operation, external_id) do update
        set data = excluded.data, last_seen_at = excluded.last_seen_at`;

  await database`
    insert into connector_records (
      id, tenant_id, instance_id, operation, external_id, shape, data, first_seen_at, last_seen_at
    )
    values (
      ${id(`${tenantId}:record:deployment:e2e-failed`)}, ${tenantId}, ${vercelInstanceId},
      'pull_deployments', 'deployment:e2e-failed', 'event',
      ${database.json({
        projectId: infrastructureFixture.projects.serving.externalId.slice("project:".length),
        project: infrastructureFixture.projects.serving.name,
        state: "ERROR",
        target: "production",
        createdAt: new Date(Date.now() - 40 * 60 * 1000).toISOString(),
        commitRef: infrastructureFixture.projects.serving.failureRef,
        commitSha: "e2e0001"
      })},
      now() - '1 hour'::interval, now() - '2 minutes'::interval
    )
    on conflict (tenant_id, instance_id, operation, external_id) do update
      set data = excluded.data, last_seen_at = excluded.last_seen_at`;

  /**
   * A Prometheus nobody has to reach either, and the inventory it is compared with.
   *
   * The base is a loopback address for the same reason the n8n one is: a fixture naming a real
   * host would be a fixture that could reach one. No pass runs during the suite -- what is seeded
   * is the state a pass would have left behind, which is the only way to seed a reading that
   * stopped moving and an operation that never ran.
   */
  const prometheusInstanceId = id(`${tenantId}:connector:prometheus-e2e`);
  await database`
    insert into connector_instances (id, tenant_id, connector_type, name, status, config, health_status)
    values (
      ${prometheusInstanceId}, ${tenantId}, 'prometheus', ${infrastructureFixture.collector}, 'enabled',
      ${database.json({
        baseUrl: "http://127.0.0.1:9090",
        hostLabels: [infrastructureFixture.host.hostname],
        containerJob: "cadvisor",
        probeJob: "blackbox"
      })},
      'unknown'
    )
    on conflict (id) do update set status = excluded.status, config = excluded.config, updated_at = now()`;

  /**
   * The machine the discovery test declares, taken away again.
   *
   * That test turns an undeclared label into a machine, and there is no way to undeclare one
   * from the screen. Left behind, the next run would find the label already declared and would
   * assert against a button that is correctly not there. The seed is the only thing that runs
   * between runs, so the seed is what puts the fixture back the way the test needs it.
   */
  await database`
    delete from infra_hosts
    where tenant_id = ${tenantId} and hostname = ${infrastructureFixture.undeclaredHostname}`;

  const hostId = id(`${tenantId}:infra-host:e2e`);
  await database`
    insert into infra_hosts (id, tenant_id, name, hostname, environment, notes)
    values (
      ${hostId}, ${tenantId}, ${infrastructureFixture.host.name}, ${infrastructureFixture.host.hostname},
      'production', 'Maquina de proves de la suite E2E.'
    )
    on conflict (id) do update set
      name = excluded.name, hostname = excluded.hostname, environment = excluded.environment, updated_at = now()`;

  const services = [
    { key: "up", kind: "container", expected: "up" },
    { key: "down", kind: "container", expected: "up" },
    { key: "unknown", kind: "http", expected: "up" }
  ] as const;
  for (const service of services) {
    const declared = infrastructureFixture.services[service.key];
    await database`
      insert into infra_services (id, tenant_id, host_id, name, kind, match_key, expected_state)
      values (
        ${id(`${tenantId}:infra-service:${service.key}`)}, ${tenantId}, ${hostId}, ${declared.name},
        ${service.kind}, ${declared.matchKey}, ${service.expected}
      )
      on conflict (id) do update set
        name = excluded.name, kind = excluded.kind, match_key = excluded.match_key, updated_at = now()`;
  }

  // The two the selector offers, taken back before every run. The suite declares them by ticking
  // and the product has no way to undeclare a service, so without this the second run finds them
  // already declared and there is nothing left to tick.
  await database`
    delete from infra_services
    where tenant_id = ${tenantId}
      and match_key = any(${database.array([
        infrastructureFixture.offered.container.matchKey,
        infrastructureFixture.offered.backup.matchKey
      ])})`;

  /**
   * The readings, and the passes they came from.
   *
   * Whether a figure still counts is measured against the cadence the connector declares --
   * `pull_host_metrics` every two minutes, `pull_container_state` every five, three passes of
   * grace -- so the ages here are chosen on that scale and not on the forty-five minutes an
   * automation is given. Two hours is far past every one of them.
   */
  const readings = [
    {
      operation: "pull_host_metrics",
      externalId: `host:${infrastructureFixture.host.hostname}`,
      minutesAgo: 1,
      data: {
        cpuBusyRatio: 0.21,
        memoryUsedRatio: 0.63,
        filesystemUsedRatio: 0.44,
        load1: 0.58,
        uptimeSeconds: 903_600
      }
    },
    {
      operation: "pull_container_state",
      externalId: infrastructureFixture.services.up.matchKey,
      minutesAgo: 2,
      data: { lastSeenAt: null, startedAt: null, memoryBytes: 412_000_000, cpuCores: 0.03 }
    },
    {
      operation: "pull_container_state",
      externalId: infrastructureFixture.services.down.matchKey,
      minutesAgo: 120,
      data: { lastSeenAt: null, startedAt: null, memoryBytes: 96_000_000, cpuCores: 0 }
    },
    // The machine the collector reads and nobody declared. It appears on no list but the
    // discovery's, which is the whole point of the discovery.
    {
      operation: "pull_host_metrics",
      externalId: `host:${infrastructureFixture.undeclaredHostname}`,
      minutesAgo: 1,
      data: { cpuBusyRatio: 0.08, memoryUsedRatio: 0.31, filesystemUsedRatio: 0.12, load1: 0.11 }
    },
    // And the two services in the same position, for the selector. The container carries the
    // label of the cAdvisor that saw it and the backup carries none: the screen has to say where
    // it read one and stay quiet about the other, and only a pair proves it does both.
    {
      operation: "pull_container_state",
      externalId: infrastructureFixture.offered.container.matchKey,
      minutesAgo: 3,
      data: { lastSeenAt: null, startedAt: null, memoryBytes: 128_000_000, cpuCores: 0.01, host: "cadvisor:8080" }
    },
    {
      operation: "pull_probe_state",
      externalId: infrastructureFixture.offered.backup.matchKey,
      minutesAgo: 4,
      data: { lastSuccessAt: null }
    }
  ] as const;
  for (const reading of readings)
    await database`
      insert into connector_records (
        id, tenant_id, instance_id, operation, external_id, shape, data, first_seen_at, last_seen_at
      )
      values (
        ${id(`${tenantId}:record:${reading.externalId}`)}, ${tenantId}, ${prometheusInstanceId},
        ${reading.operation}, ${reading.externalId}, 'state', ${database.json(reading.data)},
        now() - '2 days'::interval, now() - ${`${reading.minutesAgo} minutes`}::interval
      )
      on conflict (tenant_id, instance_id, operation, external_id) do update
        set data = excluded.data, last_seen_at = excluded.last_seen_at`;

  // Two operations passed just now and a third never did. Nothing is written for the probes on
  // purpose: an operation with no state of its own is what makes a service read as `unknown`
  // rather than as down, and that answer cannot be seeded any other way.
  for (const operation of ["pull_host_metrics", "pull_container_state"])
    await database`
      insert into connector_operation_state (id, tenant_id, instance_id, operation, last_run_at, last_success_at)
      values (
        ${id(`${tenantId}:operation-state:${operation}`)}, ${tenantId}, ${prometheusInstanceId},
        ${operation}, now(), now()
      )
      on conflict (tenant_id, instance_id, operation) do update
        set last_run_at = excluded.last_run_at, last_success_at = excluded.last_success_at, updated_at = now()`;

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
        customerReply: conversation.find((message) => message.visibility === "customer")!.body,
        commerce: commerceFixture,
        infrastructure: infrastructureFixture
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

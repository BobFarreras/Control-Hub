import { createHash, randomUUID } from "node:crypto";
import { createDatabaseClient, type DatabaseClient } from "@control-hub/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresMcpSessionRepository } from "./mcp-session-repository.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const adminUrl = process.env.TEST_DATABASE_ADMIN_URL;
if (process.env.CI && !(databaseUrl && adminUrl))
  throw new Error("TEST_DATABASE_URL and TEST_DATABASE_ADMIN_URL are required in CI");
const suite = databaseUrl && adminUrl ? describe : describe.skip;

const hash = (value: string) => createHash("sha256").update(value).digest("hex");

suite("PostgresMcpSessionRepository", () => {
  let database: DatabaseClient;
  let admin: DatabaseClient;
  let repository: PostgresMcpSessionRepository;

  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const userId = randomUUID();
  const otherUserId = randomUUID();
  const membershipA = randomUUID();
  const membershipB = randomUUID();
  const roleA = randomUUID();
  const accountA = randomUUID();
  const grantA = randomUUID();

  beforeAll(async () => {
    database = createDatabaseClient(databaseUrl!);
    admin = createDatabaseClient(adminUrl!);
    repository = new PostgresMcpSessionRepository(database);

    for (const [id, name] of [
      [userId, "Session Test"],
      [otherUserId, "Session Other"]
    ] as const) {
      await admin`insert into "user" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt")
        values (${id}, ${name}, ${`${id}@test.local`}, true, now(), now())`;
    }
    await admin`insert into tenants (id, slug, name) values
      (${tenantA}, ${`sess-${tenantA}`}, 'Session A'), (${tenantB}, ${`sess-${tenantB}`}, 'Session B')`;
    await admin`insert into memberships (id, tenant_id, user_id) values
      (${membershipA}, ${tenantA}, ${userId}), (${membershipB}, ${tenantB}, ${otherUserId})`;

    await admin`insert into roles (id, tenant_id, code, name) values (${roleA}, ${tenantA}, 'owner', 'Owner')`;
    await admin`insert into role_permissions (role_id, permission_code) values
      (${roleA}, 'customers:read'), (${roleA}, 'tickets:read')`;
    await admin`insert into membership_roles (membership_id, role_id) values (${membershipA}, ${roleA})`;

    // Narrower than its owner on purpose: the owner reads customers and tickets, the agent reads
    // customers. That gap is what the resolution has to preserve.
    await admin`
      insert into mcp_service_accounts (id, tenant_id, name, owner_membership_id, scopes, permissions,
        secret_hash, expires_at)
      values (${accountA}, ${tenantA}, 'Nightly agent', ${membershipA}, array['mcp:tools.list', 'crm.read'],
        array['customers:read'], ${hash(accountA)}, now() + interval '365 days')`;
    await admin`
      insert into mcp_grants (id, tenant_id, actor_type, actor_service_account_id, scopes, expires_at)
      values (${grantA}, ${tenantA}, 'service_account', ${accountA}, array['mcp:tools.list', 'crm.read'],
        now() + interval '90 days')`;
  });

  afterAll(async () => {
    // Two constraints make this teardown longer than a delete. An agent row restricts deleting the
    // membership it belongs to, and a tenant cascades to both tables in an order Postgres does not
    // promise, so the agents go first. And `audit_log` is append-only by trigger and pins its
    // tenant with `on delete restrict`, which is exactly the property the production code relies
    // on -- so the rows this suite wrote are removed with the trigger off, as admin, and the
    // protection is put back before anything else can notice it was gone.
    await admin`delete from mcp_service_accounts where tenant_id in (${tenantA}, ${tenantB})`;
    await admin`alter table audit_log disable trigger audit_log_append_only`;
    try {
      await admin`delete from audit_log where tenant_id in (${tenantA}, ${tenantB})`;
    } finally {
      await admin`alter table audit_log enable trigger audit_log_append_only`;
    }
    await admin`delete from tenants where id in (${tenantA}, ${tenantB})`;
    await admin`delete from "user" where id in (${userId}, ${otherUserId})`;
    await database.end({ timeout: 5 });
    await admin.end({ timeout: 5 });
  });

  it("resolves a person to the same permissions the REST surface would give them", async () => {
    const identity = await repository.resolveActor(
      { tenantId: tenantA },
      { actorType: "user", membershipId: membershipA, serviceAccountId: null }
    );
    expect(identity).toMatchObject({ membershipId: membershipA, userId, roles: ["owner"] });
    expect([...identity!.permissions].sort()).toEqual(["customers:read", "tickets:read"]);
  });

  it("gives an agent its own permissions and no roles at all", async () => {
    // The account is narrower than its owner. Reading the owner's permissions here would hand the
    // agent authority nobody granted it, which is the whole failure the cap exists to prevent.
    const identity = await repository.resolveActor(
      { tenantId: tenantA },
      { actorType: "service_account", membershipId: null, serviceAccountId: accountA }
    );
    expect(identity).toMatchObject({ membershipId: membershipA, userId, roles: [], permissions: ["customers:read"] });
  });

  it("stops resolving an agent the moment it is disabled", async () => {
    await admin`update mcp_service_accounts set disabled_at = now() where id = ${accountA}`;
    const identity = await repository.resolveActor(
      { tenantId: tenantA },
      { actorType: "service_account", membershipId: null, serviceAccountId: accountA }
    );
    expect(identity).toBeNull();
    await admin`update mcp_service_accounts set disabled_at = null where id = ${accountA}`;
  });

  it("refuses to resolve a membership that belongs to another tenant", async () => {
    // Not a null check but an isolation one: the row exists, and asking for it from the wrong
    // tenant has to come back empty rather than come back.
    const identity = await repository.resolveActor(
      { tenantId: tenantA },
      { actorType: "user", membershipId: membershipB, serviceAccountId: null }
    );
    expect(identity).toBeNull();
  });

  it("stops resolving a person whose membership was disabled", async () => {
    await admin`update memberships set status = 'disabled' where id = ${membershipA}`;
    const identity = await repository.resolveActor(
      { tenantId: tenantA },
      { actorType: "user", membershipId: membershipA, serviceAccountId: null }
    );
    expect(identity).toBeNull();
    await admin`update memberships set status = 'active' where id = ${membershipA}`;
  });

  it("writes a call into the same audit table as everything else, marked as MCP", async () => {
    await repository.recordToolCall(
      { tenantId: tenantA },
      {
        tool: "crm.customers.list",
        outcome: "success",
        code: null,
        items: 3,
        actorType: "service_account",
        actorId: accountA,
        userId,
        grantId: grantA,
        at: new Date()
      }
    );

    const [row] = await admin<
      Array<{ action: string; source: string; actorType: string; actorId: string; metadata: Record<string, unknown> }>
    >`
      select action, source, actor_type as "actorType", actor_id as "actorId", metadata
      from audit_log where tenant_id = ${tenantA} and target_id = 'crm.customers.list'`;

    expect(row).toMatchObject({
      action: "mcp.tool.called",
      source: "mcp",
      actorType: "service_account",
      actorId: accountA
    });
    // The count, not the rows. An audit table that mirrored the payload would be a second copy of
    // the data in a table nothing is allowed to delete from.
    expect(row!.metadata).toEqual({ grantId: grantA, items: 3 });
  });

  it("records a refusal with its code and no count", async () => {
    await repository.recordToolCall(
      { tenantId: tenantA },
      {
        tool: "usage.summary",
        outcome: "denied",
        code: "MCP_SCOPE_INSUFFICIENT",
        items: null,
        actorType: "user",
        actorId: membershipA,
        userId,
        grantId: grantA,
        at: new Date()
      }
    );

    const [row] = await admin<Array<{ outcome: string; metadata: Record<string, unknown> }>>`
      select outcome, metadata from audit_log where tenant_id = ${tenantA} and target_id = 'usage.summary'`;
    expect(row).toMatchObject({ outcome: "denied" });
    expect(row!.metadata).toEqual({ grantId: grantA, code: "MCP_SCOPE_INSUFFICIENT" });
  });
});

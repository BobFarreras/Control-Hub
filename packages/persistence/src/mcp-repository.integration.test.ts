import { createHash, randomUUID } from "node:crypto";
import { createDatabaseClient, type DatabaseClient } from "@control-hub/database";
import type { TenantContext } from "@control-hub/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresMcpOauthRepository } from "./mcp-repository.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const adminUrl = process.env.TEST_DATABASE_ADMIN_URL;
// Skipping locally is a convenience; skipping in CI would mean tenant isolation ships unproven.
if (process.env.CI && !(databaseUrl && adminUrl))
  throw new Error("TEST_DATABASE_URL and TEST_DATABASE_ADMIN_URL are required in CI");
const suite = databaseUrl && adminUrl ? describe : describe.skip;

const hash = (value: string) => createHash("sha256").update(value).digest("hex");

suite("PostgresMcpOauthRepository", () => {
  let database: DatabaseClient;
  let admin: DatabaseClient;
  let repository: PostgresMcpOauthRepository;

  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const userId = randomUUID();
  const membershipA = randomUUID();
  const membershipB = randomUUID();
  const clientA = randomUUID();
  const clientB = randomUUID();
  const grantA = randomUUID();
  const grantB = randomUUID();

  const context = (tenantId: string, membershipId: string): TenantContext => ({
    tenantId,
    userId,
    membershipId,
    roles: ["owner"],
    permissions: ["security:manage", "customers:read"],
    mfaEnabled: true
  });

  /** One live grant with one live token, for whichever tenant is asked for. */
  const seedGrant = async (
    tenantId: string,
    membershipId: string,
    clientRow: string,
    grantRow: string,
    token: string
  ) => {
    await admin`
      insert into mcp_clients (id, tenant_id, client_id, name, kind, redirect_uris, max_scopes, created_by_membership_id)
      values (${clientRow}, ${tenantId}, ${`client-${clientRow}`}, 'Test client', 'public',
        array['http://127.0.0.1/callback'], array['crm.read'], ${membershipId})`;
    await admin`
      insert into mcp_grants (id, tenant_id, client_id, actor_type, actor_membership_id, scopes, expires_at)
      values (${grantRow}, ${tenantId}, ${clientRow}, 'user', ${membershipId}, array['mcp:tools.list', 'crm.read'],
        now() + interval '90 days')`;
    await admin`
      insert into mcp_access_tokens (id, tenant_id, grant_id, token_hash, audience, scopes, expires_at)
      values (${randomUUID()}, ${tenantId}, ${grantRow}, ${hash(token)}, 'https://hub.test/mcp',
        array['mcp:tools.list', 'crm.read'], now() + interval '30 minutes')`;
  };

  beforeAll(async () => {
    database = createDatabaseClient(databaseUrl!);
    admin = createDatabaseClient(adminUrl!);
    repository = new PostgresMcpOauthRepository(database);
    await admin`insert into "user" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt")
      values (${userId}, 'MCP Test', ${`${userId}@test.local`}, true, now(), now())`;
    await admin`insert into tenants (id, slug, name) values
      (${tenantA}, ${`mcp-${tenantA}`}, 'MCP A'), (${tenantB}, ${`mcp-${tenantB}`}, 'MCP B')`;
    await admin`insert into memberships (id, tenant_id, user_id) values
      (${membershipA}, ${tenantA}, ${userId}), (${membershipB}, ${tenantB}, ${userId})`;
    await seedGrant(tenantA, membershipA, clientA, grantA, "token-for-a");
    await seedGrant(tenantB, membershipB, clientB, grantB, "token-for-b");
  });

  afterAll(async () => {
    await admin`delete from tenants where id in (${tenantA}, ${tenantB})`;
    await admin`delete from "user" where id = ${userId}`;
    await database.end({ timeout: 5 });
    await admin.end({ timeout: 5 });
  });

  it("resolves a bearer token to its tenant without being told which tenant to look in", async () => {
    // The whole reason the lookup is a security definer function: at this point in a request there
    // is no `app.tenant_id` to set, because deciding it is what this call is for.
    const resolved = await repository.resolveAccessToken(hash("token-for-a"));
    expect(resolved?.tenantId).toBe(tenantA);
    expect(resolved?.grantId).toBe(grantA);
    expect(resolved?.audience).toBe("https://hub.test/mcp");
    expect(resolved?.scopes).toEqual(["mcp:tools.list", "crm.read"]);
    expect(resolved?.actorType).toBe("user");
    expect(resolved?.actorMembershipId).toBe(membershipA);
    expect(resolved?.grantStatus).toBe("active");
    expect(resolved?.clientStatus).toBe("active");
  });

  it("answers nothing for a hash nobody issued", async () => {
    expect(await repository.resolveAccessToken(hash("never-issued"))).toBeNull();
  });

  it("hands back the other tenant's row only with the other tenant's hash", async () => {
    const a = await repository.resolveAccessToken(hash("token-for-a"));
    const b = await repository.resolveAccessToken(hash("token-for-b"));
    expect(a?.tenantId).toBe(tenantA);
    expect(b?.tenantId).toBe(tenantB);
    expect(a?.tokenId).not.toBe(b?.tokenId);
  });

  it("lists only this tenant's consents", async () => {
    const listed = await repository.listGrants(context(tenantA, membershipA));
    expect(listed.map((grant) => grant.id)).toEqual([grantA]);
    expect(listed[0]?.scopes).toEqual(["mcp:tools.list", "crm.read"]);
    expect(listed[0]?.clientName).toBe("Test client");
    expect(listed[0]?.lastUsedAt).toBeNull();
  });

  it("records that a token was used, and shows it on the grant", async () => {
    const resolved = await repository.resolveAccessToken(hash("token-for-a"));
    const at = new Date("2026-08-24T12:00:00.000Z");
    await repository.touchAccessToken(context(tenantA, membershipA), resolved!.tokenId, at);
    const [listed] = await repository.listGrants(context(tenantA, membershipA));
    expect(listed?.lastUsedAt).toEqual(at);
  });

  it("refuses to touch a token belonging to somebody else", async () => {
    const other = await repository.resolveAccessToken(hash("token-for-b"));
    await repository.touchAccessToken(context(tenantA, membershipA), other!.tokenId, new Date());
    // Tenant A's context cannot see tenant B's row, so the update matches nothing and B is intact.
    const untouched = await repository.resolveAccessToken(hash("token-for-b"));
    expect(untouched?.tenantId).toBe(tenantB);
    const [grantOfB] = await repository.listGrants(context(tenantB, membershipB));
    expect(grantOfB?.lastUsedAt).toBeNull();
  });

  it("kills the tokens of a grant the moment the grant is withdrawn", async () => {
    // A consent the screen calls withdrawn and a token that still works for half an hour is the
    // failure this transaction exists to prevent.
    expect(await repository.revokeGrant(context(tenantB, membershipB), grantB, new Date(), membershipB)).toBe(true);
    const resolved = await repository.resolveAccessToken(hash("token-for-b"));
    expect(resolved?.grantStatus).toBe("revoked");
    expect(resolved?.revokedAt).not.toBeNull();
    const [listed] = await repository.listGrants(context(tenantB, membershipB));
    expect(listed?.status).toBe("revoked");
  });

  it("cannot withdraw a consent that belongs to another tenant", async () => {
    expect(await repository.revokeGrant(context(tenantB, membershipB), grantA, new Date(), membershipB)).toBe(false);
    const stillLive = await repository.resolveAccessToken(hash("token-for-a"));
    expect(stillLive?.grantStatus).toBe("active");
    expect(stillLive?.revokedAt).toBeNull();
  });
});

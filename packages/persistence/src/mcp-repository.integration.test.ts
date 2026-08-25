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

  it("finds a client by the name it presents at /authorize, with no tenant to look in", async () => {
    const resolved = await repository.resolveClient(`client-${clientA}`);
    expect(resolved?.tenantId).toBe(tenantA);
    expect(resolved?.kind).toBe("public");
    // A public client holds no secret. A hash here would be a secret that is not one.
    expect(resolved?.secretHash).toBeNull();
    expect(resolved?.redirectUris).toEqual(["http://127.0.0.1/callback"]);
    expect(resolved?.maxScopes).toEqual(["crm.read"]);
    expect(await repository.resolveClient("client-nobody-registered")).toBeNull();
  });

  it("registers a client the owner can list, and only inside their own tenant", async () => {
    const secretHash = hash("a-secret-nobody-sees-again");
    const created = await repository.createClient(context(tenantA, membershipA), {
      name: "Claude Desktop",
      kind: "confidential",
      redirectUris: ["http://127.0.0.1/oauth/callback"],
      maxScopes: ["crm.read", "support.read"],
      secretHash
    });
    expect(created.clientId).toMatch(/^[a-z0-9-]{12,64}$/);
    const listedForA = await repository.listClients(context(tenantA, membershipA));
    expect(listedForA.map((client) => client.id)).toContain(created.id);
    // The listing carries no secret and no hash of one: the record has nowhere to put it.
    expect(JSON.stringify(listedForA)).not.toContain(secretHash);
    const listedForB = await repository.listClients(context(tenantB, membershipB));
    expect(listedForB.map((client) => client.id)).not.toContain(created.id);
    expect(await repository.deleteClient(context(tenantB, membershipB), created.id)).toBe(false);
    expect(await repository.deleteClient(context(tenantA, membershipA), created.id)).toBe(true);
  });

  it("exchanges an authorization code exactly once", async () => {
    const code = `code-${randomUUID()}`;
    await repository.createAuthorizationRequest(context(tenantA, membershipA), {
      clientId: clientA,
      membershipId: membershipA,
      codeHash: hash(code),
      scopes: ["mcp:tools.list", "crm.read"],
      codeChallenge: "y".repeat(43),
      redirectUri: "http://127.0.0.1:51763/callback",
      audience: "https://hub.test/mcp",
      expiresAt: new Date(Date.now() + 60_000)
    });
    const claimed = await repository.consumeAuthorizationCode(hash(code), "http://127.0.0.1:51763/callback");
    expect(claimed?.tenantId).toBe(tenantA);
    expect(claimed?.membershipId).toBe(membershipA);
    expect(claimed?.scopes).toEqual(["mcp:tools.list", "crm.read"]);
    expect(claimed?.codeChallenge).toBe("y".repeat(43));
    // The replay. The claim is the update, so the second exchange matches nothing at all.
    expect(await repository.consumeAuthorizationCode(hash(code), "http://127.0.0.1:51763/callback")).toBeNull();
  });

  it("refuses a code presented against a redirect it was not issued for", async () => {
    const code = `code-${randomUUID()}`;
    await repository.createAuthorizationRequest(context(tenantA, membershipA), {
      clientId: clientA,
      membershipId: membershipA,
      codeHash: hash(code),
      scopes: ["crm.read"],
      codeChallenge: "z".repeat(43),
      redirectUri: "http://127.0.0.1:51763/callback",
      audience: "https://hub.test/mcp",
      expiresAt: new Date(Date.now() + 60_000)
    });
    expect(await repository.consumeAuthorizationCode(hash(code), "http://127.0.0.1:51763/elsewhere")).toBeNull();
    // Refused, not consumed: the honest exchange still works afterwards.
    expect(await repository.consumeAuthorizationCode(hash(code), "http://127.0.0.1:51763/callback")).not.toBeNull();
  });

  it("refuses a code that has already expired", async () => {
    const code = `code-${randomUUID()}`;
    await repository.createAuthorizationRequest(context(tenantA, membershipA), {
      clientId: clientA,
      membershipId: membershipA,
      codeHash: hash(code),
      scopes: ["crm.read"],
      codeChallenge: "w".repeat(43),
      redirectUri: "http://127.0.0.1/cb",
      audience: "https://hub.test/mcp",
      expiresAt: new Date(Date.now() + 60_000)
    });
    // The row is aged rather than born expired: `expires_at > created_at` is a table constraint, so
    // a code that was never valid for an instant cannot exist, and the only expiry worth testing is
    // the one that arrives with time.
    await admin`
      update mcp_authorization_requests
      set created_at = now() - interval '10 minutes', expires_at = now() - interval '9 minutes'
      where code_hash = ${hash(code)}`;
    expect(await repository.consumeAuthorizationCode(hash(code), "http://127.0.0.1/cb")).toBeNull();
  });

  it("resolves a refresh token together with the grant it descends from", async () => {
    const token = `refresh-${randomUUID()}`;
    await repository.issueRefreshToken(context(tenantA, membershipA), {
      grantId: grantA,
      familyId: randomUUID(),
      tokenHash: hash(token),
      expiresAt: new Date(Date.now() + 86_400_000)
    });

    const resolved = await repository.resolveRefreshToken(hash(token));
    // The client and the scopes come back with the token because the next access token cannot be
    // minted without them, and reading them separately would let a revocation land in between.
    expect(resolved?.clientId).toBe(clientA);
    expect(resolved?.scopes).toEqual(["mcp:tools.list", "crm.read"]);
    expect(resolved?.grantStatus).toBe("active");
  });

  it("retires one access token and leaves the grant alone", async () => {
    const token = `access-${randomUUID()}`;
    const ctx = context(tenantA, membershipA);
    const tokenId = await repository.issueAccessToken(ctx, {
      grantId: grantA,
      tokenHash: hash(token),
      audience: "https://hub.test/mcp",
      scopes: ["crm.read"],
      expiresAt: new Date(Date.now() + 1_800_000)
    });

    expect(await repository.revokeAccessToken(ctx, tokenId, new Date())).toBe(true);
    // Revoking again changes nothing, which is what makes the endpoint safe to retry.
    expect(await repository.revokeAccessToken(ctx, tokenId, new Date())).toBe(false);
    const resolved = await repository.resolveAccessToken(hash(token));
    expect(resolved?.revokedAt).not.toBeNull();
    // The consent behind it is untouched: dropping the token in your hand is not withdrawing it.
    expect(resolved?.grantStatus).toBe("active");
  });

  it("retires a refresh token and mints its successor in one step", async () => {
    const family = randomUUID();
    const first = `refresh-${randomUUID()}`;
    const second = `refresh-${randomUUID()}`;
    const ctx = context(tenantA, membershipA);
    const later = () => new Date(Date.now() + 86_400_000);
    const firstId = await repository.issueRefreshToken(ctx, {
      grantId: grantA,
      familyId: family,
      tokenHash: hash(first),
      expiresAt: later()
    });
    const at = new Date();
    const secondId = await repository.rotateRefreshToken(ctx, {
      tokenId: firstId,
      grantId: grantA,
      familyId: family,
      tokenHash: hash(second),
      expiresAt: later(),
      at
    });
    expect(secondId).not.toBeNull();
    const spent = await repository.resolveRefreshToken(hash(first));
    expect(spent?.usedAt).not.toBeNull();
    expect(spent?.familyId).toBe(family);
    const fresh = await repository.resolveRefreshToken(hash(second));
    expect(fresh?.tokenId).toBe(secondId);
    expect(fresh?.usedAt).toBeNull();

    // A second rotation of the spent token loses rather than minting a third: the race has a winner.
    const again = await repository.rotateRefreshToken(ctx, {
      tokenId: firstId,
      grantId: grantA,
      familyId: family,
      tokenHash: hash(`refresh-${randomUUID()}`),
      expiresAt: later(),
      at
    });
    expect(again).toBeNull();

    // And when reuse is detected the whole lineage goes, the spent one and the live one alike.
    expect(await repository.revokeRefreshFamily(ctx, family, at)).toBe(2);
    expect((await repository.resolveRefreshToken(hash(second)))?.revokedAt).not.toBeNull();
  });

  it("keeps service accounts inside their tenant, and finds one by its secret", async () => {
    const secret = `service-${randomUUID()}`;
    const ctx = context(tenantA, membershipA);
    const account = await repository.createServiceAccount(ctx, {
      name: "Nightly report agent",
      ownerMembershipId: membershipA,
      scopes: ["crm.read"],
      permissions: ["customers:read"],
      secretHash: hash(secret),
      expiresAt: new Date(Date.now() + 86_400_000)
    });
    const resolved = await repository.resolveServiceAccount(hash(secret));
    expect(resolved?.id).toBe(account.id);
    expect(resolved?.tenantId).toBe(tenantA);
    expect(resolved?.disabledAt).toBeNull();

    expect(await repository.listServiceAccounts(context(tenantB, membershipB))).toEqual([]);
    expect(await repository.disableServiceAccount(context(tenantB, membershipB), account.id, new Date())).toBe(false);

    const rotated = `service-${randomUUID()}`;
    expect(
      await repository.rotateServiceAccountSecret(ctx, account.id, {
        secretHash: hash(rotated),
        at: new Date(),
        previousExpiresAt: new Date(Date.now() + 86_400_000)
      })
    ).toBe(true);
    // Both keys work during the window, and the resolution says which one was presented so an
    // agent nobody redeployed can be spotted before the window closes on it.
    expect((await repository.resolveServiceAccount(hash(rotated)))?.matchedPrevious).toBe(false);
    expect((await repository.resolveServiceAccount(hash(secret)))?.matchedPrevious).toBe(true);

    // Retiring ends the window at once, which is the answer to a compromise rather than to a
    // routine rotation.
    expect(await repository.retirePreviousSecret(ctx, account.id, new Date())).toBe(true);
    expect(await repository.resolveServiceAccount(hash(secret))).toBeNull();
    expect(await repository.retirePreviousSecret(ctx, account.id, new Date())).toBe(false);

    const at = new Date();
    expect(await repository.disableServiceAccount(ctx, account.id, at)).toBe(true);
    expect((await repository.resolveServiceAccount(hash(rotated)))?.disabledAt).toEqual(at);
  });
});

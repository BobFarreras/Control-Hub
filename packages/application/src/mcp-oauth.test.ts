import { mcpScopes, type McpScope, type TenantContext } from "@control-hub/domain";
import { beforeEach, describe, expect, it } from "vitest";
import {
  McpOauthError,
  McpOauthService,
  type McpAuthorizationCodeClaim,
  type McpClientResolution,
  type McpCrypto,
  type McpOauthRepository,
  type McpRefreshResolution,
  type McpServiceAccountResolution
} from "./mcp-oauth.js";

const issuer = "https://hub.test";
const now = new Date("2026-08-25T10:00:00.000Z");
const resource = `${issuer}/mcp`;
const tenantA = "11111111-1111-4111-8111-111111111111";
const tenantB = "22222222-2222-4222-8222-222222222222";

const context = (tenantId: string, permissions: string[]): TenantContext =>
  ({
    tenantId,
    userId: "user-1",
    membershipId: "membership-1",
    roles: ["owner"],
    permissions,
    mfaEnabled: true
  }) as TenantContext;

/**
 * Crypto that is legible instead of real.
 *
 * `sha256` prefixes rather than hashes so a test can assert what was stored and see at a glance
 * that it was not the credential itself. The one property that matters here is that the store
 * never receives the value the caller presented, and a prefix shows that as clearly as a digest.
 */
const fakeCrypto = (): McpCrypto => {
  let minted = 0;
  return {
    mintToken: () => `token-${++minted}`,
    sha256: (value) => `sha256:${value}`,
    pkceChallenge: (verifier) => `challenge:${verifier}`,
    matches: (a, b) => a === b
  };
};

type Recorded = {
  requests: Array<{ tenantId: string; codeHash: string; scopes: readonly McpScope[]; expiresAt: Date }>;
  grants: Array<{ tenantId: string; clientId: string | null; scopes: readonly McpScope[] }>;
  accessTokens: Array<{ tenantId: string; grantId: string; tokenHash: string; audience: string }>;
  refreshTokens: Array<{ tenantId: string; grantId: string; tokenHash: string }>;
  rotations: Array<{ tenantId: string; tokenId: string; familyId: string; tokenHash: string }>;
  revokedFamilies: string[];
  revokedAccessTokens: string[];
  createdClients: Array<{ name: string; kind: string; secretHash: string | null; maxScopes: readonly McpScope[] }>;
  createdAccounts: Array<{ name: string; ownerMembershipId: string; scopes: readonly McpScope[]; secretHash: string }>;
  rotatedSecrets: Array<{ id: string; secretHash: string; previousExpiresAt: Date }>;
  listedGrantsFor: string[];
  revokedGrants: Array<{ tenantId: string; grantId: string; at: Date; byMembershipId: string | null }>;
};

const client: McpClientResolution = {
  id: "client-row-1",
  tenantId: tenantA,
  name: "Claude Desktop",
  kind: "public",
  secretHash: null,
  redirectUris: ["http://127.0.0.1/callback"],
  maxScopes: ["crm.read", "support.read"],
  status: "active"
};

const claim: McpAuthorizationCodeClaim = {
  requestId: "request-1",
  tenantId: tenantA,
  clientId: "client-row-1",
  membershipId: "membership-1",
  scopes: ["mcp:tools.list", "crm.read"],
  codeChallenge: "challenge:verifier-1",
  audience: `${issuer}/mcp`
};

type Overrides = {
  client?: McpClientResolution | null;
  claim?: McpAuthorizationCodeClaim | null;
  refresh?: McpRefreshResolution | null;
  access?: { tokenId: string; tenantId: string } | null;
  /** Null stands for the rotation that lost the race: the store spent the token first. */
  rotation?: string | null;
  account?: McpServiceAccountResolution | null;
  /** False stands for the account that was not there, or belonged to another tenant. */
  rotatedAccount?: boolean;
  /** False stands for the consent that was already withdrawn, or was never this tenant's. */
  revokedGrant?: boolean;
};

const build = (overrides: Overrides = {}) => {
  const recorded: Recorded = {
    requests: [],
    grants: [],
    accessTokens: [],
    refreshTokens: [],
    rotations: [],
    revokedFamilies: [],
    revokedAccessTokens: [],
    createdClients: [],
    createdAccounts: [],
    rotatedSecrets: [],
    listedGrantsFor: [],
    revokedGrants: []
  };
  const repository = {
    resolveClient: (clientId: string) =>
      Promise.resolve(overrides.client === undefined ? (clientId === "public-app" ? client : null) : overrides.client),
    createAuthorizationRequest: (ctx: { tenantId: string }, input: Recorded["requests"][number]) => {
      recorded.requests.push({ ...input, tenantId: ctx.tenantId });
      return Promise.resolve();
    },
    consumeAuthorizationCode: () => Promise.resolve(overrides.claim === undefined ? claim : overrides.claim),
    createGrant: (ctx: { tenantId: string }, input: { clientId: string | null; scopes: readonly McpScope[] }) => {
      recorded.grants.push({ ...input, tenantId: ctx.tenantId });
      return Promise.resolve("grant-1");
    },
    issueAccessToken: (ctx: { tenantId: string }, input: Recorded["accessTokens"][number]) => {
      recorded.accessTokens.push({ ...input, tenantId: ctx.tenantId });
      return Promise.resolve("access-1");
    },
    issueRefreshToken: (ctx: { tenantId: string }, input: Recorded["refreshTokens"][number]) => {
      recorded.refreshTokens.push({ ...input, tenantId: ctx.tenantId });
      return Promise.resolve("refresh-1");
    },
    resolveRefreshToken: () => Promise.resolve(overrides.refresh ?? null),
    resolveAccessToken: () => Promise.resolve(overrides.access ?? null),
    rotateRefreshToken: (ctx: { tenantId: string }, input: Recorded["rotations"][number]) => {
      recorded.rotations.push({ ...input, tenantId: ctx.tenantId });
      return Promise.resolve(overrides.rotation === undefined ? "refresh-row-2" : overrides.rotation);
    },
    revokeRefreshFamily: (_ctx: { tenantId: string }, familyId: string) => {
      recorded.revokedFamilies.push(familyId);
      return Promise.resolve(1);
    },
    revokeAccessToken: (_ctx: { tenantId: string }, tokenId: string) => {
      recorded.revokedAccessTokens.push(tokenId);
      return Promise.resolve(true);
    },
    createClient: (_ctx: TenantContext, input: Recorded["createdClients"][number]) => {
      recorded.createdClients.push(input);
      // The hash is written but never projected back, exactly as the store does it: a record that
      // carried it would put the credential into every listing that renders one.
      const { secretHash: _secretHash, ...record } = input;
      return Promise.resolve({
        id: "client-row-9",
        clientId: "generated",
        ...record,
        status: "active",
        createdAt: now
      });
    },
    createServiceAccount: (_ctx: TenantContext, input: Recorded["createdAccounts"][number]) => {
      recorded.createdAccounts.push(input);
      return Promise.resolve({ id: "account-9", ...input, disabledAt: null, secretRotatedAt: null, createdAt: now });
    },
    resolveServiceAccount: () => Promise.resolve(overrides.account ?? null),
    rotateServiceAccountSecret: (
      _ctx: TenantContext,
      id: string,
      input: { secretHash: string; previousExpiresAt: Date }
    ) => {
      recorded.rotatedSecrets.push({ id, ...input });
      return Promise.resolve(overrides.rotatedAccount ?? true);
    },
    retirePreviousSecret: () => Promise.resolve(overrides.rotatedAccount ?? true),
    listGrants: (ctx: TenantContext) => {
      recorded.listedGrantsFor.push(ctx.tenantId);
      return Promise.resolve([]);
    },
    revokeGrant: (ctx: TenantContext, grantId: string, at: Date, byMembershipId: string | null) => {
      recorded.revokedGrants.push({ tenantId: ctx.tenantId, grantId, at, byMembershipId });
      return Promise.resolve(overrides.revokedGrant ?? true);
    }
  } as unknown as McpOauthRepository;
  const service = new McpOauthService({ repository, crypto: fakeCrypto(), issuer, clock: () => now });
  return { service, recorded };
};

const codeOf = async (service: McpOauthService) =>
  service.approveAuthorization(context(tenantA, ["customers:read"]), {
    clientId: "public-app",
    redirectUri: "http://127.0.0.1:51763/callback",
    scopes: ["crm.read"],
    codeChallenge: "a".repeat(43),
    codeChallengeMethod: "S256",
    resource
  });

const denialOf = async (run: () => Promise<unknown>) => {
  const error = await run().catch((thrown: unknown) => thrown);
  expect(error).toBeInstanceOf(McpOauthError);
  return (error as McpOauthError).code;
};

describe("what the metadata documents say", () => {
  const { service } = build();

  it("names the issuer and the one resource this server protects", () => {
    // RFC 9728. The audience is derived from the validated origin, never from a request header,
    // which is why there is no argument to pass here.
    expect(service.protectedResourceMetadata()).toEqual({
      resource: "https://hub.test/mcp",
      authorization_servers: ["https://hub.test"],
      // Compared against the domain list rather than a copy of it, so a scope added there and
      // forgotten here shows up as a failure instead of as a document that under-reports.
      scopes_supported: [...mcpScopes],
      bearer_methods_supported: ["header"]
    });
  });

  it("advertises S256 and nothing else", () => {
    // Advertising `plain` would be advertising a downgrade. OAuth 2.1 removed it, and a client
    // that reads this document must not find it offered.
    const metadata = service.authorizationServerMetadata();
    expect(metadata.code_challenge_methods_supported).toEqual(["S256"]);
    expect(metadata.grant_types_supported).toEqual(["authorization_code", "refresh_token"]);
    expect(metadata.authorization_endpoint).toBe("https://hub.test/api/v1/mcp/oauth/authorize");
    expect(metadata.token_endpoint).toBe("https://hub.test/api/v1/mcp/oauth/token");
    expect(metadata.revocation_endpoint).toBe("https://hub.test/api/v1/mcp/oauth/revoke");
  });
});

describe("approving a consent", () => {
  it("mints a code, stores only its hash, and gives it a minute to live", async () => {
    const { service, recorded } = build();
    const approval = await codeOf(service);

    expect(approval.code).toBe("chm_ac_token-1");
    expect(recorded.requests).toHaveLength(1);
    const [request] = recorded.requests;
    expect(request!.codeHash).toBe("sha256:chm_ac_token-1");
    expect(request!.tenantId).toBe(tenantA);
    expect(request!.expiresAt).toEqual(new Date("2026-08-25T10:01:00.000Z"));
    // `mcp:tools.list` rides along without being asked for: a client that cannot list is a client
    // that cannot find anything to call.
    expect(request!.scopes).toEqual(["mcp:tools.list", "crm.read"]);
  });

  it("refuses a client this tenant does not have", async () => {
    const { service } = build({ client: null });
    expect(await denialOf(() => codeOf(service))).toBe("MCP_CLIENT_UNKNOWN");
  });

  it("gives a client of another tenant the same answer as one that does not exist", async () => {
    // Distinguishing the two would turn the authorize endpoint into a directory of which client ids
    // exist elsewhere in the installation.
    const { service } = build({ client: { ...client, tenantId: tenantB } });
    expect(await denialOf(() => codeOf(service))).toBe("MCP_CLIENT_UNKNOWN");
  });

  it("refuses a suspended client without deleting anything", async () => {
    const { service } = build({ client: { ...client, status: "suspended" } });
    expect(await denialOf(() => codeOf(service))).toBe("MCP_CLIENT_SUSPENDED");
  });

  it("refuses a redirect the client was not registered for", async () => {
    const { service } = build();
    const denial = await denialOf(() =>
      service.approveAuthorization(context(tenantA, ["customers:read"]), {
        clientId: "public-app",
        redirectUri: "https://evil.test/callback",
        scopes: ["crm.read"],
        codeChallenge: "a".repeat(43),
        codeChallengeMethod: "S256",
        resource
      })
    );
    expect(denial).toBe("MCP_REDIRECT_URI_MISMATCH");
  });

  it("refuses a challenge that is not S256, and one that is too short to be one", async () => {
    const { service } = build();
    const approve = (codeChallenge: string, codeChallengeMethod: string) =>
      service.approveAuthorization(context(tenantA, ["customers:read"]), {
        clientId: "public-app",
        redirectUri: "http://127.0.0.1:51763/callback",
        scopes: ["crm.read"],
        codeChallenge,
        codeChallengeMethod,
        resource
      });
    expect(await denialOf(() => approve("a".repeat(43), "plain"))).toBe("MCP_PKCE_INVALID");
    expect(await denialOf(() => approve("short", "S256"))).toBe("MCP_PKCE_INVALID");
  });

  it("refuses a scope the approver's own permissions do not back", async () => {
    const { service } = build();
    const denial = await denialOf(() =>
      service.approveAuthorization(context(tenantA, ["customers:read"]), {
        clientId: "public-app",
        redirectUri: "http://127.0.0.1:51763/callback",
        scopes: ["support.read"],
        codeChallenge: "a".repeat(43),
        codeChallengeMethod: "S256",
        resource
      })
    );
    expect(denial).toBe("MCP_SCOPE_UNAVAILABLE");
  });
});

describe("exchanging a code for tokens", () => {
  const exchange = (service: McpOauthService, overrides: Record<string, string> = {}) =>
    service.exchangeCode({
      clientId: "public-app",
      code: "code-1",
      codeVerifier: "verifier-1",
      redirectUri: "http://127.0.0.1:51763/callback",
      resource,
      ...overrides
    });

  it("issues an access token and a refresh token, and reports the granted scopes", async () => {
    const { service, recorded } = build();
    const issued = await exchange(service);

    expect(issued).toEqual({
      accessToken: "chm_at_token-1",
      refreshToken: "chm_rt_token-2",
      tokenType: "Bearer",
      expiresIn: 1800,
      scope: "mcp:tools.list crm.read"
    });
    expect(recorded.grants).toHaveLength(1);
    expect(recorded.grants[0]).toMatchObject({ tenantId: tenantA, clientId: "client-row-1", scopes: claim.scopes });
  });

  it("hands the store hashes and keeps the tokens to itself", async () => {
    const { service, recorded } = build();
    await exchange(service);

    expect(recorded.accessTokens[0]!.tokenHash).toBe("sha256:chm_at_token-1");
    expect(recorded.refreshTokens[0]!.tokenHash).toBe("sha256:chm_rt_token-2");
    // The audience is stamped on the token at issue, so the resource server compares against a
    // value that was decided here rather than one a caller can suggest later.
    expect(recorded.accessTokens[0]!.audience).toBe("https://hub.test/mcp");
  });

  it("refuses a verifier that does not produce the challenge that was committed to", async () => {
    const { service } = build();
    expect(await denialOf(() => exchange(service, { codeVerifier: "other-verifier" }))).toBe("MCP_PKCE_INVALID");
  });

  it("refuses a code that was issued to a different client", async () => {
    const { service } = build({ claim: { ...claim, clientId: "another-client-row" } });
    expect(await denialOf(() => exchange(service))).toBe("MCP_CODE_INVALID");
  });

  it("refuses a code the store no longer has", async () => {
    // Which covers both halves of single use: a code already exchanged and a code that never
    // existed come back from the store the same way, and are refused the same way.
    const { service } = build({ claim: null });
    expect(await denialOf(() => exchange(service))).toBe("MCP_CODE_INVALID");
  });

  it("makes a confidential client prove itself, and lets it through when it does", async () => {
    const confidential = { ...client, kind: "confidential" as const, secretHash: "sha256:right-secret" };
    const wrong = build({ client: confidential });
    expect(await denialOf(() => exchange(wrong.service, { clientSecret: "wrong-secret" }))).toBe(
      "MCP_CLIENT_AUTH_FAILED"
    );
    const missing = build({ client: confidential });
    expect(await denialOf(() => exchange(missing.service))).toBe("MCP_CLIENT_AUTH_FAILED");
    const right = build({ client: confidential });
    await expect(exchange(right.service, { clientSecret: "right-secret" })).resolves.toMatchObject({
      tokenType: "Bearer"
    });
  });

  it("refuses a public client that presents a secret", async () => {
    // A public client holds no secret, so one arriving means either a misconfigured client or
    // somebody probing. Ignoring it quietly would hide both.
    const { service } = build();
    expect(await denialOf(() => exchange(service, { clientSecret: "anything" }))).toBe("MCP_CLIENT_AUTH_FAILED");
  });
});

describe("the tenant the token endpoint acts in", () => {
  let recorded: Recorded;

  beforeEach(async () => {
    const built = build();
    recorded = built.recorded;
    await built.service.exchangeCode({
      clientId: "public-app",
      code: "code-1",
      codeVerifier: "verifier-1",
      redirectUri: "http://127.0.0.1:51763/callback",
      resource
    });
  });

  it("writes every row in the tenant the code resolved to, and no other", () => {
    // There is no session at the token endpoint. The only tenant it may act in is the one the
    // code itself named, which is why nothing here reads a tenant from the request.
    expect(recorded.grants.every((row) => row.tenantId === tenantA)).toBe(true);
    expect(recorded.accessTokens.every((row) => row.tenantId === tenantA)).toBe(true);
    expect(recorded.refreshTokens.every((row) => row.tenantId === tenantA)).toBe(true);
  });
});

describe("refreshing a token", () => {
  const live = {
    tokenId: "refresh-row-1",
    tenantId: tenantA,
    grantId: "grant-1",
    clientId: "client-row-1",
    scopes: ["mcp:tools.list", "crm.read"] as readonly McpScope[],
    familyId: "grant-1",
    usedAt: null,
    expiresAt: new Date("2026-09-24T10:00:00.000Z"),
    revokedAt: null,
    grantStatus: "active" as const
  };

  const refresh = (service: McpOauthService, token = "refresh-1") =>
    service.refresh({ clientId: "public-app", refreshToken: token, resource });

  it("mints a new pair and keeps the consent it descends from", async () => {
    const { service, recorded } = build({ refresh: live });
    const issued = await refresh(service);

    expect(issued.tokenType).toBe("Bearer");
    expect(issued.scope).toBe("mcp:tools.list crm.read");
    // No new grant: refreshing is not consenting again. The scopes come from the grant that
    // already exists, so a refresh can never widen what was approved.
    expect(recorded.grants).toHaveLength(0);
    expect(recorded.accessTokens[0]!.grantId).toBe("grant-1");
    expect(recorded.rotations[0]).toMatchObject({ tokenId: "refresh-row-1", familyId: "grant-1" });
  });

  it("burns the whole family when a spent token comes back", async () => {
    // Somebody holds a copy. Which of the two holders is the thief is not knowable, so the lineage
    // goes -- including the token the honest client is using right now.
    const { service, recorded } = build({ refresh: { ...live, usedAt: new Date("2026-08-25T09:00:00.000Z") } });
    expect(await denialOf(() => refresh(service))).toBe("MCP_REFRESH_REUSED");
    expect(recorded.revokedFamilies).toEqual(["grant-1"]);
    expect(recorded.accessTokens).toHaveLength(0);
  });

  it("refuses a revoked token, an expired one and a dead grant without touching the family", async () => {
    const cases = [
      [{ revokedAt: now }, "MCP_REFRESH_INVALID"],
      [{ expiresAt: now }, "MCP_REFRESH_INVALID"],
      [{ grantStatus: "revoked" as const }, "MCP_GRANT_REVOKED"]
    ] as const;
    for (const [patch, code] of cases) {
      const { service, recorded } = build({ refresh: { ...live, ...patch } });
      expect(await denialOf(() => refresh(service)), code).toBe(code);
      expect(recorded.revokedFamilies).toEqual([]);
    }
  });

  it("refuses a token the store does not know", async () => {
    const { service } = build({ refresh: null });
    expect(await denialOf(() => refresh(service))).toBe("MCP_REFRESH_INVALID");
  });

  it("refuses a token issued to a different client", async () => {
    // RFC 6749 section 6. Without this check any registered client could refresh any other
    // client's token, and the client identity on the grant would mean nothing.
    const { service } = build({ refresh: { ...live, clientId: "another-client-row" } });
    expect(await denialOf(() => refresh(service))).toBe("MCP_REFRESH_INVALID");
  });

  it("loses the race rather than rotating twice", async () => {
    // The store spends the old token conditionally, so a second concurrent refresh gets nothing
    // back. Answering it with a fresh pair would leave two live lineages for one consent.
    const { service } = build({ refresh: live, rotation: null });
    expect(await denialOf(() => refresh(service))).toBe("MCP_REFRESH_INVALID");
  });
});

describe("revoking a token", () => {
  const live = {
    tokenId: "refresh-row-1",
    tenantId: tenantA,
    grantId: "grant-1",
    clientId: "client-row-1",
    scopes: ["mcp:tools.list"] as readonly McpScope[],
    familyId: "grant-1",
    usedAt: null,
    expiresAt: new Date("2026-09-24T10:00:00.000Z"),
    revokedAt: null,
    grantStatus: "active" as const
  };

  it("retires the access token it was handed", async () => {
    const { service, recorded } = build({ access: { tokenId: "access-row-1", tenantId: tenantA } });
    await service.revokeToken({ clientId: "public-app", token: "access-1" });
    expect(recorded.revokedAccessTokens).toEqual(["access-row-1"]);
    expect(recorded.revokedFamilies).toEqual([]);
  });

  it("retires the whole lineage when handed a refresh token", async () => {
    // RFC 7009 asks the server to revoke what the token descends from where it can. For a refresh
    // token that is the family: leaving its successors alive would revoke nothing in practice.
    const { service, recorded } = build({ refresh: live });
    await service.revokeToken({ clientId: "public-app", token: "refresh-1" });
    expect(recorded.revokedFamilies).toEqual(["grant-1"]);
  });

  it("says nothing about a token it does not recognise", async () => {
    // RFC 7009 section 2.2: an unknown token is a successful revocation. Answering otherwise turns
    // the endpoint into an oracle for which tokens exist.
    const { service, recorded } = build({ access: null, refresh: null });
    await expect(service.revokeToken({ clientId: "public-app", token: "nothing" })).resolves.toBeUndefined();
    expect(recorded.revokedAccessTokens).toEqual([]);
    expect(recorded.revokedFamilies).toEqual([]);
  });

  it("refuses to revoke a token belonging to another client", async () => {
    const { service, recorded } = build({ refresh: { ...live, clientId: "another-client-row" } });
    expect(await denialOf(() => service.revokeToken({ clientId: "public-app", token: "refresh-1" }))).toBe(
      "MCP_REFRESH_INVALID"
    );
    expect(recorded.revokedFamilies).toEqual([]);
  });
});

describe("what a credential says about itself", () => {
  it("prefixes every kind so a secret scanner can recognise it", async () => {
    // The prefix is part of the value, so it is inside the hash too. A token pasted into a commit
    // trips gitleaks before a human notices, which is the whole reason it is there.
    const { service } = build();
    const approval = await codeOf(service);
    expect(approval.code.startsWith("chm_ac_")).toBe(true);

    const issued = await build().service.exchangeCode({
      clientId: "public-app",
      code: "code-1",
      codeVerifier: "verifier-1",
      redirectUri: "http://127.0.0.1:51763/callback",
      resource
    });
    expect(issued.accessToken.startsWith("chm_at_")).toBe(true);
    expect(issued.refreshToken.startsWith("chm_rt_")).toBe(true);
  });
});

describe("which resource the client asked for", () => {
  const approve = (service: McpOauthService, value: string | undefined) =>
    service.approveAuthorization(context(tenantA, ["customers:read"]), {
      clientId: "public-app",
      redirectUri: "http://127.0.0.1:51763/callback",
      scopes: ["crm.read"],
      codeChallenge: "a".repeat(43),
      codeChallengeMethod: "S256",
      resource: value
    });

  it("refuses a request that names another resource", async () => {
    // RFC 8707. The day there is a second resource, a request that meant one of them must not turn
    // out to have silently meant the other all along.
    const { service } = build();
    expect(await denialOf(() => approve(service, "https://hub.test/other"))).toBe("MCP_AUDIENCE_INVALID");
  });

  it("refuses a request that names none", async () => {
    const { service } = build();
    expect(await denialOf(() => approve(service, undefined))).toBe("MCP_REQUEST_INVALID");
  });

  it("asks the same of the token endpoint and of the refresh", async () => {
    const exchange = build();
    expect(
      await denialOf(() =>
        exchange.service.exchangeCode({
          clientId: "public-app",
          code: "code-1",
          codeVerifier: "verifier-1",
          redirectUri: "http://127.0.0.1:51763/callback",
          resource: undefined
        })
      )
    ).toBe("MCP_REQUEST_INVALID");

    const refresh = build();
    expect(
      await denialOf(() =>
        refresh.service.refresh({
          clientId: "public-app",
          refreshToken: "chm_rt_x",
          resource: "https://elsewhere.test"
        })
      )
    ).toBe("MCP_AUDIENCE_INVALID");
  });
});

describe("registering a client", () => {
  const owner = () => context(tenantA, ["security:manage", "customers:read"]);
  const register = (service: McpOauthService, overrides: Record<string, unknown> = {}) =>
    service.registerClient(owner(), {
      name: "  Claude Desktop  ",
      kind: "public",
      redirectUris: ["http://127.0.0.1/callback"],
      maxScopes: ["crm.read"],
      ...overrides
    });

  it("trims the name and hands a public client no secret at all", async () => {
    const { service, recorded } = build();
    const registered = await register(service);
    expect(registered.secret).toBeNull();
    expect(recorded.createdClients[0]).toMatchObject({ name: "Claude Desktop", secretHash: null });
  });

  it("gives a confidential client its secret once, and keeps only the hash", async () => {
    // The value is returned here and nowhere else. An operator who loses it rotates the client
    // instead of looking it up, which is what makes the store safe to back up.
    const { service, recorded } = build();
    const registered = await register(service, { kind: "confidential" });
    expect(registered.secret).toBe("chm_sa_token-1");
    expect(recorded.createdClients[0]!.secretHash).toBe("sha256:chm_sa_token-1");
    expect(JSON.stringify(registered.client)).not.toContain("chm_sa_");
  });

  it("refuses an address that could not be matched back later", async () => {
    const { service } = build();
    expect(await denialOf(() => register(service, { redirectUris: ["http://agent.example.com/cb"] }))).toBe(
      "MCP_REDIRECT_URI_MISMATCH"
    );
    expect(await denialOf(() => register(service, { redirectUris: [] }))).toBe("MCP_REQUEST_INVALID");
  });

  it("refuses a name that is only spaces", async () => {
    const { service } = build();
    expect(await denialOf(() => register(service, { name: "   " }))).toBe("MCP_REQUEST_INVALID");
  });

  it("refuses a ceiling that names something that is not a scope", async () => {
    const { service } = build();
    expect(await denialOf(() => register(service, { maxScopes: ["everything"] }))).toBe("MCP_SCOPE_UNAVAILABLE");
  });

  it("refuses a client whose only ceiling is listing, because it could call nothing", async () => {
    // `mcp:tools.list` is never negotiated, so recording it as a ceiling would suggest it could be
    // withheld -- and a client with nothing else can discover tools it may not call.
    const { service } = build();
    expect(await denialOf(() => register(service, { maxScopes: ["mcp:tools.list"] }))).toBe("MCP_SCOPE_UNAVAILABLE");
  });
});

describe("creating a service account", () => {
  const owner = (permissions: string[]) => context(tenantA, permissions);
  const create = (service: McpOauthService, permissions: string[], overrides: Record<string, unknown> = {}) =>
    service.createServiceAccount(owner(permissions), {
      name: "Nightly report agent",
      scopes: ["crm.read"],
      permissions: ["customers:read"],
      ...overrides
    });

  it("returns the secret once and stores its hash", async () => {
    const { service, recorded } = build();
    const created = await create(service, ["security:manage", "customers:read"]);
    expect(created.secret).toBe("chm_sa_token-1");
    expect(recorded.createdAccounts[0]!.secretHash).toBe("sha256:chm_sa_token-1");
    expect(recorded.createdAccounts[0]!.scopes).toEqual(["mcp:tools.list", "crm.read"]);
  });

  it("refuses to grant an agent a permission the creator does not have", async () => {
    // Otherwise somebody who cannot read customers could leave behind an agent that can, and the
    // permission would outlive the membership that was supposed to justify it.
    const { service } = build();
    const denial = await denialOf(() => create(service, ["security:manage"], { permissions: ["customers:read"] }));
    expect(denial).toBe("MCP_SCOPE_UNAVAILABLE");
  });

  it("refuses a scope the agent's own permissions would not back", async () => {
    const { service } = build();
    const denial = await denialOf(() =>
      create(service, ["security:manage", "customers:read", "tickets:read"], {
        permissions: ["customers:read"],
        scopes: ["support.read"]
      })
    );
    expect(denial).toBe("MCP_SCOPE_UNAVAILABLE");
  });
});

describe("logging in as a service account", () => {
  const account = {
    id: "account-1",
    tenantId: tenantA,
    scopes: ["mcp:tools.list", "crm.read"] as readonly McpScope[],
    permissions: ["customers:read"],
    expiresAt: new Date("2027-08-25T10:00:00.000Z"),
    disabledAt: null,
    matchedPrevious: false
  };
  const login = (service: McpOauthService) => service.authenticateServiceAccount({ secret: "chm_sa_x", resource });

  it("issues one access token and deliberately no refresh token", async () => {
    const { service, recorded } = build({ account });
    const issued = await login(service);

    expect(issued).toEqual({
      accessToken: "chm_at_token-1",
      tokenType: "Bearer",
      expiresIn: 1800,
      scope: "mcp:tools.list crm.read",
      usedPreviousSecret: false
    });
    expect(recorded.refreshTokens).toHaveLength(0);
    // The grant names no client, because there was none. A placeholder would be a row the consent
    // screen then has to explain.
    expect(recorded.grants[0]).toMatchObject({ clientId: null, tenantId: tenantA });
  });

  it("says when the secret presented was the rotated-away one", async () => {
    // It still works -- that is what the window is for -- but an agent nobody redeployed is about
    // to stop working, and this is the only moment anybody could notice.
    const { service } = build({ account: { ...account, matchedPrevious: true } });
    await expect(login(service)).resolves.toMatchObject({ usedPreviousSecret: true });
  });

  it("gives unknown, disabled and expired the same answer", async () => {
    // Which of the three it was is exactly what somebody probing secrets would like to learn.
    for (const patch of [null, { ...account, disabledAt: now }, { ...account, expiresAt: now }]) {
      const { service } = build({ account: patch });
      expect(await denialOf(() => login(service))).toBe("MCP_CLIENT_AUTH_FAILED");
    }
  });

  it("re-checks the scopes against the permissions at every login", async () => {
    // A permission taken off the account has to narrow the next token, not the one after somebody
    // remembers to reissue it.
    const { service } = build({ account: { ...account, permissions: [] } });
    expect(await denialOf(() => login(service))).toBe("MCP_SCOPE_UNAVAILABLE");
  });

  it("asks for the resource like every other way in", async () => {
    const { service } = build({ account });
    expect(await denialOf(() => service.authenticateServiceAccount({ secret: "chm_sa_x", resource: undefined }))).toBe(
      "MCP_REQUEST_INVALID"
    );
  });
});

describe("rotating a service account secret", () => {
  it("keeps the old key alive for a day and says so in the window it writes", async () => {
    const { service, recorded } = build();
    const secret = await service.rotateServiceAccountSecret(context(tenantA, ["security:manage"]), "account-1");

    expect(secret).toBe("chm_sa_token-1");
    expect(recorded.rotatedSecrets[0]).toMatchObject({
      secretHash: "sha256:chm_sa_token-1",
      previousExpiresAt: new Date("2026-08-26T10:00:00.000Z")
    });
  });

  it("refuses to report success for an account that was not there", async () => {
    const { service } = build({ rotatedAccount: false });
    expect(
      await denialOf(() => service.rotateServiceAccountSecret(context(tenantA, ["security:manage"]), "missing"))
    ).toBe("MCP_REQUEST_INVALID");
  });
});

describe("what the consent screen is told about a request", () => {
  const request = {
    clientId: "public-app",
    redirectUri: "http://127.0.0.1:51763/callback",
    scopes: ["crm.read"],
    codeChallenge: "a".repeat(43),
    codeChallengeMethod: "S256",
    resource
  };

  it("names the client from the row, never from the request that carried it here", async () => {
    // Everything else on that screen arrives through a query string the client controls. If the
    // name did too, the consent page would be a phishing page we host ourselves.
    const { service } = build();
    await expect(service.describeAuthorization(context(tenantA, ["customers:read"]), request)).resolves.toMatchObject({
      clientName: "Claude Desktop",
      clientKind: "public"
    });
  });

  it("shows what would be granted, not what the client may ask for", async () => {
    // The client asked for nothing in particular, and its ceiling allows two scopes. What comes
    // back is the one the person's own permissions can actually back, plus listing -- which is
    // never negotiated because it unlocks no data. Showing the ceiling instead would have somebody
    // approve a sentence that is not true.
    const { service } = build();
    const description = await service.describeAuthorization(context(tenantA, ["customers:read"]), {
      ...request,
      scopes: []
    });
    expect(description.scopes).toEqual(["mcp:tools.list", "crm.read"]);
  });

  it("says when the consent would lapse", async () => {
    // Ninety days. A screen that omits it is asking somebody to approve something open-ended.
    const { service } = build();
    const description = await service.describeAuthorization(context(tenantA, ["customers:read"]), request);
    expect(description.grantExpiresAt).toEqual(new Date("2026-11-23T10:00:00.000Z"));
  });

  it("refuses to describe anything the approval would refuse", async () => {
    // The screen and the approval run the same checks in the same order, so a request that can be
    // rendered is one that can be approved. Anything else ends as a person pressing approve and
    // being told no, with nothing on the screen explaining which answer was the real one.
    const { service } = build();
    const person = context(tenantA, ["customers:read"]);
    const cases = [
      [{ ...request, resource: undefined }, "MCP_REQUEST_INVALID"],
      [{ ...request, clientId: "unknown" }, "MCP_CLIENT_UNKNOWN"],
      [{ ...request, codeChallengeMethod: "plain" }, "MCP_PKCE_INVALID"],
      [{ ...request, redirectUri: "https://evil.example/callback" }, "MCP_REDIRECT_URI_MISMATCH"],
      [{ ...request, scopes: ["usage.read"] }, "MCP_SCOPE_UNAVAILABLE"]
    ] as const;
    for (const [input, code] of cases) {
      expect(await denialOf(() => service.describeAuthorization(person, input)), code).toBe(code);
    }
  });

  it("does not write anything down", async () => {
    // Describing is a read. A request that somebody looked at and closed must leave no code, no
    // grant and no row behind it.
    const { service, recorded } = build();
    await service.describeAuthorization(context(tenantA, ["customers:read"]), request);
    expect(recorded.requests).toEqual([]);
    expect(recorded.grants).toEqual([]);
  });
});

describe("the consents a tenant can see and withdraw", () => {
  it("reads the grants through the tenant, never through a list of ids", async () => {
    // The scope goes to the store and the store filters. A service that fetched everything and
    // filtered afterwards would be one bug away from returning another tenant's consents, and no
    // test of the result could tell the difference.
    const { service, recorded } = build();
    await service.listGrants(context(tenantB, ["security:manage"]));
    expect(recorded.listedGrantsFor).toEqual([tenantB]);
  });

  it("records who withdrew the consent, and when", async () => {
    // A consent that vanished with nobody's name against it is one no review can explain later,
    // and the moment is the service clock rather than the store's, so the audit row and the
    // revocation cannot disagree about when it happened.
    const { service, recorded } = build();
    await expect(service.revokeGrant(context(tenantA, ["security:manage"]), "grant-7")).resolves.toBe(true);
    expect(recorded.revokedGrants).toEqual([
      { tenantId: tenantA, grantId: "grant-7", at: now, byMembershipId: "membership-1" }
    ]);
  });

  it("says plainly when there was no such consent to withdraw", async () => {
    // False rather than an error: a grant already withdrawn, or one belonging to another tenant,
    // are the same non-event to the screen, and both leave the caller nothing to retry.
    const { service } = build({ revokedGrant: false });
    await expect(service.revokeGrant(context(tenantA, ["security:manage"]), "missing")).resolves.toBe(false);
  });
});

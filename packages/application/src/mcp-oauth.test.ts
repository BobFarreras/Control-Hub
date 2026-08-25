import { mcpScopes, type McpScope, type TenantContext } from "@control-hub/domain";
import { beforeEach, describe, expect, it } from "vitest";
import {
  McpOauthError,
  McpOauthService,
  type McpAuthorizationCodeClaim,
  type McpClientResolution,
  type McpCrypto,
  type McpOauthRepository
} from "./mcp-oauth.js";

const issuer = "https://hub.test";
const now = new Date("2026-08-25T10:00:00.000Z");
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
  grants: Array<{ tenantId: string; clientId: string; scopes: readonly McpScope[] }>;
  accessTokens: Array<{ tenantId: string; grantId: string; tokenHash: string; audience: string }>;
  refreshTokens: Array<{ tenantId: string; grantId: string; tokenHash: string }>;
};

const client: McpClientResolution = {
  id: "client-row-1",
  tenantId: tenantA,
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

const build = (overrides: { client?: McpClientResolution | null; claim?: McpAuthorizationCodeClaim | null } = {}) => {
  const recorded: Recorded = { requests: [], grants: [], accessTokens: [], refreshTokens: [] };
  const repository = {
    resolveClient: (clientId: string) =>
      Promise.resolve(overrides.client === undefined ? (clientId === "public-app" ? client : null) : overrides.client),
    createAuthorizationRequest: (ctx: { tenantId: string }, input: Recorded["requests"][number]) => {
      recorded.requests.push({ ...input, tenantId: ctx.tenantId });
      return Promise.resolve();
    },
    consumeAuthorizationCode: () => Promise.resolve(overrides.claim === undefined ? claim : overrides.claim),
    createGrant: (ctx: { tenantId: string }, input: { clientId: string; scopes: readonly McpScope[] }) => {
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
    codeChallengeMethod: "S256"
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

    expect(approval.code).toBe("token-1");
    expect(recorded.requests).toHaveLength(1);
    const [request] = recorded.requests;
    expect(request!.codeHash).toBe("sha256:token-1");
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
        codeChallengeMethod: "S256"
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
        codeChallengeMethod
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
        codeChallengeMethod: "S256"
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
      ...overrides
    });

  it("issues an access token and a refresh token, and reports the granted scopes", async () => {
    const { service, recorded } = build();
    const issued = await exchange(service);

    expect(issued).toEqual({
      accessToken: "token-1",
      refreshToken: "token-2",
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

    expect(recorded.accessTokens[0]!.tokenHash).toBe("sha256:token-1");
    expect(recorded.refreshTokens[0]!.tokenHash).toBe("sha256:token-2");
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
      redirectUri: "http://127.0.0.1:51763/callback"
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

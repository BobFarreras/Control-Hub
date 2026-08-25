/**
 * The port the MCP resource server reads its credentials through.
 *
 * A bearer token arrives naming no tenant, so the first read of every MCP request is the one read
 * that cannot be inside a tenant yet. `resolveAccessToken` is that read, and it is deliberately the
 * only one shaped that way: everything it returns is what the domain needs to decide, and nothing
 * it returns is a credential. The decision is still `verifyMcpToken` and `authoriseMcpToolCall`,
 * which know nothing about databases.
 *
 * Hashing lives on the other side of this port. A caller hands over the SHA-256 of the token it was
 * given; the token itself never reaches the application layer, and no method here accepts one.
 *
 * Specification: `docs/specifications/mcp-and-client-portal.md`.
 */

import {
  matchesRegisteredRedirect,
  mcpExpiry,
  mcpLifetimes,
  mcpScopes,
  negotiateMcpScopes,
  refreshTokenVerdict,
  type McpGrantStatus,
  type McpDenialCode,
  type McpOauthDenialCode,
  type McpScope,
  type TenantContext
} from "@control-hub/domain";

/**
 * Everything one bearer token resolves to, gathered in a single read.
 *
 * One read rather than three because the three would be a token, a grant and a client observed at
 * three different moments, and a revocation landing between them would produce an answer that was
 * never true of any instant.
 */
export type McpAccessTokenResolution = {
  readonly tokenId: string;
  readonly tenantId: string;
  readonly grantId: string;
  readonly audience: string;
  readonly scopes: readonly McpScope[];
  readonly expiresAt: Date;
  readonly revokedAt: Date | null;
  readonly grantStatus: McpGrantStatus;
  readonly grantExpiresAt: Date;
  readonly grantRevokedAt: Date | null;
  readonly actorType: "user" | "service_account";
  readonly actorMembershipId: string | null;
  readonly actorServiceAccountId: string | null;
  /** A suspended client makes every grant it holds unusable without deleting any of them. */
  readonly clientStatus: "active" | "suspended";
};

/** One consent, as the person who gave it would want to see it listed back. */
export type McpGrantRecord = {
  readonly id: string;
  readonly clientId: string;
  readonly clientName: string;
  readonly actorType: "user" | "service_account";
  readonly actorMembershipId: string | null;
  readonly actorServiceAccountId: string | null;
  readonly scopes: readonly McpScope[];
  readonly status: McpGrantStatus;
  readonly consentedAt: Date;
  readonly expiresAt: Date;
  readonly revokedAt: Date | null;
  /** When this grant was last used, so a consent nobody exercises is visible as such. */
  readonly lastUsedAt: Date | null;
};

/** A registered client, as `/authorize` finds it: by name, before any tenant is known. */
export type McpClientResolution = {
  readonly id: string;
  readonly tenantId: string;
  readonly kind: "public" | "confidential";
  /** Null for a public client, which proves itself with PKCE and holds no secret. */
  readonly secretHash: string | null;
  readonly redirectUris: readonly string[];
  readonly maxScopes: readonly McpScope[];
  readonly status: "active" | "suspended";
};

/** A registered client as the owner sees it listed. No secret, not even its hash. */
export type McpClientRecord = {
  readonly id: string;
  readonly clientId: string;
  readonly name: string;
  readonly kind: "public" | "confidential";
  readonly redirectUris: readonly string[];
  readonly maxScopes: readonly McpScope[];
  readonly status: "active" | "suspended";
  readonly createdAt: Date;
};

/** What an authorization code turns into, once, when it is exchanged. */
export type McpAuthorizationCodeClaim = {
  readonly requestId: string;
  readonly tenantId: string;
  readonly clientId: string;
  readonly membershipId: string;
  readonly scopes: readonly McpScope[];
  /** The challenge the client committed to. The verifier is checked against it by the caller. */
  readonly codeChallenge: string;
  readonly audience: string;
};

export type McpRefreshResolution = {
  readonly tokenId: string;
  readonly tenantId: string;
  readonly grantId: string;
  /** The client the grant was issued to, so a token presented by another one is refused. */
  readonly clientId: string;
  /** The scopes of the grant, which is what the next access token is minted with. */
  readonly scopes: readonly McpScope[];
  readonly familyId: string;
  readonly usedAt: Date | null;
  readonly expiresAt: Date;
  readonly revokedAt: Date | null;
  readonly grantStatus: McpGrantStatus;
};

export type McpServiceAccountResolution = {
  readonly id: string;
  readonly tenantId: string;
  readonly scopes: readonly McpScope[];
  readonly permissions: readonly string[];
  readonly expiresAt: Date;
  readonly disabledAt: Date | null;
};

export type McpServiceAccountRecord = {
  readonly id: string;
  readonly name: string;
  readonly ownerMembershipId: string;
  readonly scopes: readonly McpScope[];
  readonly permissions: readonly string[];
  readonly expiresAt: Date;
  readonly disabledAt: Date | null;
  readonly secretRotatedAt: Date | null;
  readonly createdAt: Date;
};

/**
 * A tenant to write in, and nothing else.
 *
 * The token endpoint and the resource server both act without a session: one holds a code, the
 * other a bearer, and neither has a person behind it. Giving those methods a `TenantContext` would
 * mean inventing roles, permissions and an MFA flag that nobody granted, so they take the one fact
 * that is real -- the tenant the credential resolved to -- and RLS does the rest.
 */
export type McpTenantScope = { readonly tenantId: string };

export type McpOauthRepository = {
  /**
   * The pre-tenant read. Takes a hash, never a token, and returns null for a hash nobody knows --
   * an unknown token and a revoked one are the same answer to the caller by design.
   */
  resolveAccessToken(tokenHash: string): Promise<McpAccessTokenResolution | null>;

  /** The other pre-tenant reads, for the same reason and through the same kind of function. */
  resolveClient(clientId: string): Promise<McpClientResolution | null>;
  resolveRefreshToken(tokenHash: string): Promise<McpRefreshResolution | null>;
  resolveServiceAccount(secretHash: string): Promise<McpServiceAccountResolution | null>;

  /**
   * Claims an authorization code, once.
   *
   * The claim is the read: a second exchange of the same code finds it already consumed and gets
   * nothing back. Reading first and marking after would leave a window two requests both pass.
   */
  consumeAuthorizationCode(codeHash: string, redirectUri: string): Promise<McpAuthorizationCodeClaim | null>;

  createClient(
    context: TenantContext,
    input: {
      readonly name: string;
      readonly kind: "public" | "confidential";
      readonly redirectUris: readonly string[];
      readonly maxScopes: readonly McpScope[];
      /** Already hashed by the caller. Null for a public client. */
      readonly secretHash: string | null;
    }
  ): Promise<McpClientRecord>;
  listClients(context: TenantContext): Promise<readonly McpClientRecord[]>;
  deleteClient(context: TenantContext, clientId: string): Promise<boolean>;

  createAuthorizationRequest(
    context: TenantContext,
    input: {
      readonly clientId: string;
      readonly membershipId: string;
      readonly codeHash: string;
      readonly scopes: readonly McpScope[];
      readonly codeChallenge: string;
      readonly redirectUri: string;
      readonly audience: string;
      readonly expiresAt: Date;
    }
  ): Promise<void>;

  createGrant(
    scope: McpTenantScope,
    input: {
      readonly clientId: string;
      readonly actorType: "user" | "service_account";
      readonly actorMembershipId: string | null;
      readonly actorServiceAccountId: string | null;
      readonly scopes: readonly McpScope[];
      readonly expiresAt: Date;
    }
  ): Promise<string>;

  issueAccessToken(
    scope: McpTenantScope,
    input: {
      readonly grantId: string;
      readonly tokenHash: string;
      readonly audience: string;
      readonly scopes: readonly McpScope[];
      readonly expiresAt: Date;
    }
  ): Promise<string>;

  issueRefreshToken(
    scope: McpTenantScope,
    input: {
      readonly grantId: string;
      readonly familyId: string;
      readonly tokenHash: string;
      readonly expiresAt: Date;
    }
  ): Promise<string>;

  /**
   * Retires one refresh token and issues its successor in the same transaction.
   *
   * Two calls would leave an instant where the old token is spent and the new one does not exist
   * yet, and a client that failed there would have nothing left to present. Returns null when the
   * old token was already spent, so a race loses rather than rotates twice.
   */
  rotateRefreshToken(
    scope: McpTenantScope,
    input: {
      readonly tokenId: string;
      readonly grantId: string;
      readonly familyId: string;
      readonly tokenHash: string;
      readonly expiresAt: Date;
      readonly at: Date;
    }
  ): Promise<string | null>;

  /** Revokes an entire lineage, which is what reuse detection asks for. */
  revokeRefreshFamily(scope: McpTenantScope, familyId: string, at: Date): Promise<number>;

  /**
   * Retires one access token, for RFC 7009.
   *
   * Narrower than `revokeGrant` on purpose: a client asking to drop the token in its hand is not
   * asking to withdraw the consent behind it, and treating the two the same would log somebody out
   * of an agent they never told to stop.
   */
  revokeAccessToken(scope: McpTenantScope, tokenId: string, at: Date): Promise<boolean>;

  createServiceAccount(
    context: TenantContext,
    input: {
      readonly name: string;
      readonly ownerMembershipId: string;
      readonly scopes: readonly McpScope[];
      readonly permissions: readonly string[];
      readonly secretHash: string;
      readonly expiresAt: Date;
    }
  ): Promise<McpServiceAccountRecord>;
  listServiceAccounts(context: TenantContext): Promise<readonly McpServiceAccountRecord[]>;
  rotateServiceAccountSecret(
    context: TenantContext,
    serviceAccountId: string,
    secretHash: string,
    at: Date
  ): Promise<boolean>;
  disableServiceAccount(context: TenantContext, serviceAccountId: string, at: Date): Promise<boolean>;

  /**
   * Records that a token was accepted. Best-effort and deliberately separate from the read: a
   * failure to write it must never turn a valid call into a denied one.
   */
  touchAccessToken(scope: McpTenantScope, tokenId: string, at: Date): Promise<void>;

  listGrants(context: TenantContext): Promise<readonly McpGrantRecord[]>;

  /**
   * Withdraws a consent and everything issued under it, in one transaction.
   *
   * Revoking a grant while leaving its access tokens alive would mean a consent the screen shows as
   * withdrawn and a token that still works for up to half an hour. The two have to move together.
   */
  revokeGrant(context: TenantContext, grantId: string, at: Date, byMembershipId: string | null): Promise<boolean>;
};

/**
 * The primitives the flow needs, as a port.
 *
 * Declared here so the use case depends on the operation rather than on `node:crypto`, exactly as
 * `CredentialSealer` and `IngressCrypto` do. It is also the only reason this module may hold a
 * token at all: hashing happens here, and what leaves for the store is already a digest.
 */
export type McpCrypto = {
  /** 256 bits of CSPRNG, URL-safe. Codes, access tokens and refresh tokens all come from here. */
  mintToken(): string;
  /** Hex SHA-256. What the store keeps instead of the credential. */
  sha256(value: string): string;
  /** The S256 transform of RFC 7636: base64url of the SHA-256 of the verifier. */
  pkceChallenge(verifier: string): string;
  /** Constant time. A `===` on a secret is the leak, however short the comparison looks. */
  matches(a: string, b: string): boolean;
};

export class McpOauthError extends Error {
  constructor(public readonly code: McpOauthDenialCode | McpDenialCode) {
    super(code);
  }
}

/**
 * The prefix each kind of credential carries.
 *
 * A secret scanner can only stop what it recognises, so every credential this server mints says
 * what it is in its first characters: `chm_at_` an access token, `chm_rt_` a refresh token,
 * `chm_sa_` a service account secret, `chm_ac_` an authorization code. The prefix is part of the
 * value, so it is inside the hash as well, and a token pasted into a commit trips gitleaks before
 * a human notices.
 */
const mcpTokenPrefixes = {
  accessToken: "chm_at_",
  refreshToken: "chm_rt_",
  serviceAccount: "chm_sa_",
  code: "chm_ac_"
} as const;
type McpTokenKind = keyof typeof mcpTokenPrefixes;

/** What a client receives from the token endpoint. The only moment these values exist in the clear. */
export type McpTokenIssue = {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly tokenType: "Bearer";
  readonly expiresIn: number;
  /** Space delimited, as RFC 6749 asks, so a client can see what it actually got. */
  readonly scope: string;
};

/** RFC 9728. What this server protects, and who authorises access to it. */
export type McpProtectedResourceMetadata = {
  readonly resource: string;
  readonly authorization_servers: readonly string[];
  readonly scopes_supported: readonly string[];
  readonly bearer_methods_supported: readonly string[];
};

/** RFC 8414, trimmed to what this server actually does. Nothing here is aspirational. */
export type McpAuthorizationServerMetadata = {
  readonly issuer: string;
  readonly authorization_endpoint: string;
  readonly token_endpoint: string;
  readonly revocation_endpoint: string;
  readonly scopes_supported: readonly string[];
  readonly response_types_supported: readonly string[];
  readonly grant_types_supported: readonly string[];
  readonly code_challenge_methods_supported: readonly string[];
  readonly token_endpoint_auth_methods_supported: readonly string[];
};

/**
 * The OAuth 2.1 flow, as use cases.
 *
 * Every rule it applies is either in the domain (`negotiateMcpScopes`, `matchesRegisteredRedirect`,
 * `mcpExpiry`) or in the store (single-use codes, rotation). What lives here is the order the two
 * are consulted in, and the crypto that neither may hold.
 *
 * The issuer comes from validated installation configuration and is never derived from a request
 * header, which is why no method takes one: a `Host` the caller controls must not get to decide
 * which audience a token is minted for.
 */
export class McpOauthService {
  private readonly repository: McpOauthRepository;
  private readonly crypto: McpCrypto;
  private readonly issuer: string;
  private readonly clock: () => Date;

  constructor(deps: { repository: McpOauthRepository; crypto: McpCrypto; issuer: string; clock?: () => Date }) {
    this.repository = deps.repository;
    this.crypto = deps.crypto;
    this.issuer = deps.issuer.replace(/\/+$/, "");
    this.clock = deps.clock ?? (() => new Date());
  }

  private mint(kind: McpTokenKind): string {
    return `${mcpTokenPrefixes[kind]}${this.crypto.mintToken()}`;
  }

  /**
   * The `resource` of RFC 8707, checked against the one resource this server has.
   *
   * A client that asks for a different audience is refused rather than quietly given a token for
   * ours: the day there is a second resource, the request that meant one of them must not have
   * silently meant the other all along.
   */
  private requireResource(resource: string | undefined): void {
    if (resource === undefined) throw new McpOauthError("MCP_REQUEST_INVALID");
    if (resource !== this.audience) throw new McpOauthError("MCP_AUDIENCE_INVALID");
  }

  /** The one resource this server protects. Compared exactly, so it is built in exactly one place. */
  get audience(): string {
    return `${this.issuer}/mcp`;
  }

  protectedResourceMetadata(): McpProtectedResourceMetadata {
    return {
      resource: this.audience,
      authorization_servers: [this.issuer],
      scopes_supported: [...mcpScopes],
      bearer_methods_supported: ["header"]
    };
  }

  authorizationServerMetadata(): McpAuthorizationServerMetadata {
    return {
      issuer: this.issuer,
      authorization_endpoint: `${this.issuer}/api/v1/mcp/oauth/authorize`,
      token_endpoint: `${this.issuer}/api/v1/mcp/oauth/token`,
      revocation_endpoint: `${this.issuer}/api/v1/mcp/oauth/revoke`,
      scopes_supported: [...mcpScopes],
      response_types_supported: ["code"],
      // No implicit, no password, no client credentials. A grant type that is neither advertised
      // nor implemented is one fewer flow to keep safe.
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none", "client_secret_post"]
    };
  }

  /**
   * Turns an approved consent into an authorization code.
   *
   * The caller has already established who is approving and that their second factor is fresh.
   * What this decides is whether the client, the redirect, the challenge and the scopes hold up.
   */
  async approveAuthorization(
    context: TenantContext,
    input: {
      readonly clientId: string;
      readonly redirectUri: string;
      readonly scopes: readonly string[];
      readonly codeChallenge: string;
      readonly codeChallengeMethod: string;
      /** RFC 8707. Required: a client that names no resource has not asked for this one. */
      readonly resource: string | undefined;
    }
  ): Promise<{ code: string; expiresAt: Date }> {
    this.requireResource(input.resource);
    const client = await this.requireClient(input.clientId, context.tenantId);
    // OAuth 2.1 has no `plain`, and a challenge shorter than 43 characters is not the base64url
    // SHA-256 of anything. Both are refused before the redirect is even looked at.
    if (input.codeChallengeMethod !== "S256") throw new McpOauthError("MCP_PKCE_INVALID");
    if (input.codeChallenge.length < 43 || input.codeChallenge.length > 128)
      throw new McpOauthError("MCP_PKCE_INVALID");
    if (!matchesRegisteredRedirect(input.redirectUri, client.redirectUris))
      throw new McpOauthError("MCP_REDIRECT_URI_MISMATCH");

    const verdict = negotiateMcpScopes({
      requested: input.scopes,
      clientMax: client.maxScopes,
      actorPermissions: context.permissions
    });
    if ("code" in verdict) throw new McpOauthError(verdict.code);

    const code = this.mint("code");
    const expiresAt = mcpExpiry("authorizationCode", this.clock());
    await this.repository.createAuthorizationRequest(context, {
      clientId: client.id,
      membershipId: context.membershipId,
      codeHash: this.crypto.sha256(code),
      scopes: verdict.granted,
      codeChallenge: input.codeChallenge,
      redirectUri: input.redirectUri,
      audience: this.audience,
      expiresAt
    });
    return { code, expiresAt };
  }

  /**
   * Exchanges a code for tokens, once.
   *
   * The client is authenticated before the code is claimed, so a wrong secret cannot burn somebody
   * else's code on its way to being refused.
   */
  async exchangeCode(input: {
    readonly clientId: string;
    readonly clientSecret?: string;
    readonly code: string;
    readonly codeVerifier: string;
    readonly redirectUri: string;
    readonly resource: string | undefined;
  }): Promise<McpTokenIssue> {
    this.requireResource(input.resource);
    const client = await this.requireClient(input.clientId);
    this.authenticateClient(client, input.clientSecret);

    const claim = await this.repository.consumeAuthorizationCode(this.crypto.sha256(input.code), input.redirectUri);
    // The store refuses an unknown code, a consumed one, an expired one and a mismatched redirect
    // all by returning nothing. The client learns only that the code did not work.
    if (!claim) throw new McpOauthError("MCP_CODE_INVALID");
    if (claim.clientId !== client.id) throw new McpOauthError("MCP_CODE_INVALID");
    if (!this.crypto.matches(this.crypto.pkceChallenge(input.codeVerifier), claim.codeChallenge))
      throw new McpOauthError("MCP_PKCE_INVALID");

    return this.issueTokens(
      { tenantId: claim.tenantId },
      {
        clientId: client.id,
        actorType: "user",
        actorMembershipId: claim.membershipId,
        actorServiceAccountId: null,
        scopes: claim.scopes
      }
    );
  }

  /**
   * Trades a refresh token for the next pair, under the consent that already exists.
   *
   * No grant is created here. The scopes come from the grant the token descends from, so a refresh
   * can never widen what somebody approved, and a consent that has since been withdrawn stops the
   * lineage rather than quietly renewing it.
   */
  async refresh(input: {
    readonly clientId: string;
    readonly clientSecret?: string;
    readonly refreshToken: string;
    readonly resource: string | undefined;
  }): Promise<McpTokenIssue> {
    this.requireResource(input.resource);
    const client = await this.requireClient(input.clientId);
    this.authenticateClient(client, input.clientSecret);

    const record = await this.repository.resolveRefreshToken(this.crypto.sha256(input.refreshToken));
    if (!record) throw new McpOauthError("MCP_REFRESH_INVALID");
    // RFC 6749 section 6. Without this, any registered client could refresh any other client's
    // token and the client recorded on the grant would mean nothing.
    if (record.clientId !== client.id) throw new McpOauthError("MCP_REFRESH_INVALID");

    const scope: McpTenantScope = { tenantId: record.tenantId };
    const now = this.clock();
    const verdict = refreshTokenVerdict(record, now);
    if (verdict.action === "revoke_family") {
      await this.repository.revokeRefreshFamily(scope, record.familyId, now);
      throw new McpOauthError(verdict.code);
    }
    if (verdict.action === "deny") throw new McpOauthError(verdict.code);

    const refreshToken = this.mint("refreshToken");
    const rotated = await this.repository.rotateRefreshToken(scope, {
      tokenId: record.tokenId,
      grantId: record.grantId,
      familyId: record.familyId,
      tokenHash: this.crypto.sha256(refreshToken),
      expiresAt: mcpExpiry("refreshToken", now),
      at: now
    });
    // The store spends the old token conditionally, so a concurrent refresh that got there first
    // leaves nothing to rotate. Minting a pair anyway would put two live lineages on one consent.
    if (rotated === null) throw new McpOauthError("MCP_REFRESH_INVALID");

    const accessToken = this.mint("accessToken");
    await this.repository.issueAccessToken(scope, {
      grantId: record.grantId,
      tokenHash: this.crypto.sha256(accessToken),
      audience: this.audience,
      scopes: record.scopes,
      expiresAt: mcpExpiry("accessToken", now)
    });

    return {
      accessToken,
      refreshToken,
      tokenType: "Bearer",
      expiresIn: mcpLifetimes.accessToken,
      scope: record.scopes.join(" ")
    };
  }

  /**
   * RFC 7009. Retires whatever the client handed over, and says nothing about what it was.
   *
   * An unknown token is a successful revocation, because answering otherwise would turn this
   * endpoint into an oracle for which tokens exist. The two kinds are not treated alike: an access
   * token dies alone, while a refresh token takes its family, since leaving the successors alive
   * would revoke nothing in practice.
   */
  async revokeToken(input: {
    readonly clientId: string;
    readonly clientSecret?: string;
    readonly token: string;
  }): Promise<void> {
    const client = await this.requireClient(input.clientId);
    this.authenticateClient(client, input.clientSecret);
    const hash = this.crypto.sha256(input.token);
    const now = this.clock();

    const access = await this.repository.resolveAccessToken(hash);
    if (access) {
      // No client check here, and deliberately so: the blast radius is the token presented, which
      // the caller already holds. Refusing would protect nothing that possession does not already
      // give away.
      await this.repository.revokeAccessToken({ tenantId: access.tenantId }, access.tokenId, now);
      return;
    }

    const refresh = await this.repository.resolveRefreshToken(hash);
    if (!refresh) return;
    // Here the check earns its place: revoking a family reaches tokens other holders are using.
    if (refresh.clientId !== client.id) throw new McpOauthError("MCP_REFRESH_INVALID");
    await this.repository.revokeRefreshFamily({ tenantId: refresh.tenantId }, refresh.familyId, now);
  }

  private async requireClient(clientId: string, tenantId?: string): Promise<McpClientResolution> {
    const client = await this.repository.resolveClient(clientId);
    // A client belonging to another tenant is answered exactly like one that does not exist.
    // Telling the two apart would turn this endpoint into a directory of the installation.
    if (!client || (tenantId !== undefined && client.tenantId !== tenantId))
      throw new McpOauthError("MCP_CLIENT_UNKNOWN");
    if (client.status !== "active") throw new McpOauthError("MCP_CLIENT_SUSPENDED");
    return client;
  }

  private authenticateClient(client: McpClientResolution, secret: string | undefined): void {
    if (client.kind === "public") {
      // A public client holds no secret, so one arriving is either a misconfigured client or
      // somebody probing. Ignoring it quietly would hide both.
      if (secret !== undefined) throw new McpOauthError("MCP_CLIENT_AUTH_FAILED");
      return;
    }
    if (secret === undefined || client.secretHash === null) throw new McpOauthError("MCP_CLIENT_AUTH_FAILED");
    if (!this.crypto.matches(this.crypto.sha256(secret), client.secretHash))
      throw new McpOauthError("MCP_CLIENT_AUTH_FAILED");
  }

  private async issueTokens(
    scope: McpTenantScope,
    grant: {
      readonly clientId: string;
      readonly actorType: "user" | "service_account";
      readonly actorMembershipId: string | null;
      readonly actorServiceAccountId: string | null;
      readonly scopes: readonly McpScope[];
    }
  ): Promise<McpTokenIssue> {
    const now = this.clock();
    const grantId = await this.repository.createGrant(scope, { ...grant, expiresAt: mcpExpiry("grant", now) });

    const accessToken = this.mint("accessToken");
    await this.repository.issueAccessToken(scope, {
      grantId,
      tokenHash: this.crypto.sha256(accessToken),
      audience: this.audience,
      scopes: grant.scopes,
      expiresAt: mcpExpiry("accessToken", now)
    });

    const refreshToken = this.mint("refreshToken");
    // The family is named after the grant it descends from. A lineage of rotated refresh tokens is
    // exactly the set issued under one consent, so there is no second identifier to keep in step.
    await this.repository.issueRefreshToken(scope, {
      grantId,
      familyId: grantId,
      tokenHash: this.crypto.sha256(refreshToken),
      expiresAt: mcpExpiry("refreshToken", now)
    });

    return {
      accessToken,
      refreshToken,
      tokenType: "Bearer",
      expiresIn: mcpLifetimes.accessToken,
      scope: grant.scopes.join(" ")
    };
  }
}

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

import type { McpGrantStatus, McpScope, TenantContext } from "@control-hub/domain";

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
    context: TenantContext,
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
    context: TenantContext,
    input: {
      readonly grantId: string;
      readonly tokenHash: string;
      readonly audience: string;
      readonly scopes: readonly McpScope[];
      readonly expiresAt: Date;
    }
  ): Promise<string>;

  issueRefreshToken(
    context: TenantContext,
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
    context: TenantContext,
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
  revokeRefreshFamily(context: TenantContext, familyId: string, at: Date): Promise<number>;

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
  touchAccessToken(context: TenantContext, tokenId: string, at: Date): Promise<void>;

  listGrants(context: TenantContext): Promise<readonly McpGrantRecord[]>;

  /**
   * Withdraws a consent and everything issued under it, in one transaction.
   *
   * Revoking a grant while leaving its access tokens alive would mean a consent the screen shows as
   * withdrawn and a token that still works for up to half an hour. The two have to move together.
   */
  revokeGrant(context: TenantContext, grantId: string, at: Date, byMembershipId: string | null): Promise<boolean>;
};

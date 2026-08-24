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

export type McpOauthRepository = {
  /**
   * The pre-tenant read. Takes a hash, never a token, and returns null for a hash nobody knows --
   * an unknown token and a revoked one are the same answer to the caller by design.
   */
  resolveAccessToken(tokenHash: string): Promise<McpAccessTokenResolution | null>;

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

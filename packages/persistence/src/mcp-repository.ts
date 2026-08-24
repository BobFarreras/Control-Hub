import type { McpAccessTokenResolution, McpGrantRecord, McpOauthRepository } from "@control-hub/application";
import { withTenant, type DatabaseClient } from "@control-hub/database";
import type { McpGrantStatus, McpScope, TenantContext } from "@control-hub/domain";

/**
 * The MCP credential store.
 *
 * Every method but one runs inside `withTenant`, and the exception is the point of the class: an
 * opaque bearer names no tenant, so the read that turns it into one cannot already be scoped to it.
 * That read goes through `lookup_mcp_access_token`, the security definer function of migration
 * `0049`, which is why the application role can perform it at all -- and why it is the only place in
 * this file where row level security is not doing the work.
 *
 * No method here takes a token. They take the SHA-256 of one, computed by the caller, so a token
 * cannot reach a query log or a stack trace through this layer.
 */
export class PostgresMcpOauthRepository implements McpOauthRepository {
  constructor(private readonly database: DatabaseClient) {}

  async resolveAccessToken(tokenHash: string): Promise<McpAccessTokenResolution | null> {
    const [row] = await this.database<
      Array<{
        tokenId: string;
        tenantId: string;
        grantId: string;
        audience: string;
        scopes: string[];
        expiresAt: Date;
        revokedAt: Date | null;
        grantStatus: string;
        grantExpiresAt: Date;
        grantRevokedAt: Date | null;
        actorType: string;
        actorMembershipId: string | null;
        actorServiceAccountId: string | null;
        clientStatus: string;
      }>
    >`
      select token_id as "tokenId", tenant_id as "tenantId", grant_id as "grantId", audience, scopes,
             expires_at as "expiresAt", revoked_at as "revokedAt",
             grant_status as "grantStatus", grant_expires_at as "grantExpiresAt",
             grant_revoked_at as "grantRevokedAt", actor_type as "actorType",
             actor_membership_id as "actorMembershipId",
             actor_service_account_id as "actorServiceAccountId", client_status as "clientStatus"
      from lookup_mcp_access_token(${tokenHash})`;
    if (!row) return null;
    return {
      tokenId: row.tokenId,
      tenantId: row.tenantId,
      grantId: row.grantId,
      audience: row.audience,
      scopes: row.scopes as McpScope[],
      expiresAt: row.expiresAt,
      revokedAt: row.revokedAt,
      grantStatus: row.grantStatus as McpGrantStatus,
      grantExpiresAt: row.grantExpiresAt,
      grantRevokedAt: row.grantRevokedAt,
      actorType: row.actorType as "user" | "service_account",
      actorMembershipId: row.actorMembershipId,
      actorServiceAccountId: row.actorServiceAccountId,
      clientStatus: row.clientStatus as "active" | "suspended"
    };
  }

  touchAccessToken(context: TenantContext, tokenId: string, at: Date): Promise<void> {
    return withTenant(this.database, context.tenantId, async (tx) => {
      // `greatest` because two concurrent calls of the same token would otherwise let the slower
      // one write the earlier time and make the token look less recently used than it is.
      await tx`
        update mcp_access_tokens
        set last_used_at = greatest(coalesce(last_used_at, '-infinity'), ${at})
        where tenant_id = ${context.tenantId} and id = ${tokenId}`;
    });
  }

  listGrants(context: TenantContext): Promise<readonly McpGrantRecord[]> {
    return withTenant(this.database, context.tenantId, async (tx) => {
      const rows = await tx<
        Array<{
          id: string;
          clientId: string;
          clientName: string;
          actorType: string;
          actorMembershipId: string | null;
          actorServiceAccountId: string | null;
          scopes: string[];
          status: string;
          consentedAt: Date;
          expiresAt: Date;
          revokedAt: Date | null;
          lastUsedAt: Date | null;
        }>
      >`
        select g.id, g.client_id as "clientId", c.name as "clientName", g.actor_type as "actorType",
               g.actor_membership_id as "actorMembershipId",
               g.actor_service_account_id as "actorServiceAccountId",
               g.scopes, g.status, g.consented_at as "consentedAt", g.expires_at as "expiresAt",
               g.revoked_at as "revokedAt",
               (select max(t.last_used_at) from mcp_access_tokens t
                 where t.tenant_id = g.tenant_id and t.grant_id = g.id) as "lastUsedAt"
        from mcp_grants g
        join mcp_clients c on c.tenant_id = g.tenant_id and c.id = g.client_id
        where g.tenant_id = ${context.tenantId}
        order by g.consented_at desc, g.id`;
      return rows.map((row) => ({
        id: row.id,
        clientId: row.clientId,
        clientName: row.clientName,
        actorType: row.actorType as "user" | "service_account",
        actorMembershipId: row.actorMembershipId,
        actorServiceAccountId: row.actorServiceAccountId,
        scopes: row.scopes as McpScope[],
        status: row.status as McpGrantStatus,
        consentedAt: row.consentedAt,
        expiresAt: row.expiresAt,
        revokedAt: row.revokedAt,
        lastUsedAt: row.lastUsedAt
      }));
    });
  }

  revokeGrant(context: TenantContext, grantId: string, at: Date, byMembershipId: string | null): Promise<boolean> {
    return withTenant(this.database, context.tenantId, async (tx) => {
      const revoked = await tx<{ id: string }[]>`
        update mcp_grants
        set status = 'revoked', revoked_at = ${at}, revoked_by_membership_id = ${byMembershipId}
        where tenant_id = ${context.tenantId} and id = ${grantId} and status <> 'revoked'
        returning id`;
      if (revoked.length === 0) return false;
      // Same transaction as the grant. Revoking the consent and leaving its tokens alive would
      // mean a screen saying "withdrawn" and a token that still answers for another half hour.
      await tx`
        update mcp_access_tokens set revoked_at = ${at}
        where tenant_id = ${context.tenantId} and grant_id = ${grantId} and revoked_at is null`;
      await tx`
        update mcp_refresh_tokens set revoked_at = ${at}
        where tenant_id = ${context.tenantId} and grant_id = ${grantId} and revoked_at is null`;
      return true;
    });
  }
}

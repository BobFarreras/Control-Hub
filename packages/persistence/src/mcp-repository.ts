import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type {
  McpAccessTokenResolution,
  McpAuthorizationCodeClaim,
  McpClientRecord,
  McpClientResolution,
  McpCrypto,
  McpGrantRecord,
  McpOauthRepository,
  McpRefreshResolution,
  McpServiceAccountRecord,
  McpServiceAccountResolution,
  McpTenantScope
} from "@control-hub/application";
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
        clientStatus: string | null;
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
      clientStatus: row.clientStatus as "active" | "suspended" | null
    };
  }

  touchAccessToken(scope: McpTenantScope, tokenId: string, at: Date): Promise<void> {
    return withTenant(this.database, scope.tenantId, async (tx) => {
      // `greatest` because two concurrent calls of the same token would otherwise let the slower
      // one write the earlier time and make the token look less recently used than it is.
      await tx`
        update mcp_access_tokens
        set last_used_at = greatest(coalesce(last_used_at, '-infinity'), ${at})
        where tenant_id = ${scope.tenantId} and id = ${tokenId}`;
    });
  }

  listGrants(context: TenantContext): Promise<readonly McpGrantRecord[]> {
    return withTenant(this.database, context.tenantId, async (tx) => {
      const rows = await tx<
        Array<{
          id: string;
          clientId: string | null;
          clientName: string | null;
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
        -- Left, because a service account grant names no client. An inner join here would hide
        -- exactly the grants nobody is watching.
        left join mcp_clients c on c.tenant_id = g.tenant_id and c.id = g.client_id
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

  async resolveClient(clientId: string): Promise<McpClientResolution | null> {
    const [row] = await this.database<
      Array<{
        id: string;
        // Null for a client that registered itself and has not been claimed by a tenant yet.
        tenantId: string | null;
        name: string;
        kind: string;
        secretHash: string | null;
        redirectUris: string[];
        maxScopes: string[];
        status: string;
      }>
    >`
      select id, tenant_id as "tenantId", name, kind, secret_hash as "secretHash",
             redirect_uris as "redirectUris", max_scopes as "maxScopes", status
      from lookup_mcp_client(${clientId})`;
    if (!row) return null;
    return {
      id: row.id,
      tenantId: row.tenantId,
      name: row.name,
      kind: row.kind as "public" | "confidential",
      secretHash: row.secretHash,
      redirectUris: row.redirectUris,
      maxScopes: row.maxScopes as McpScope[],
      status: row.status as "active" | "suspended"
    };
  }

  /**
   * A client registering itself, before anybody has signed in (RFC 7591).
   *
   * Outside `withTenant` because there is no tenant to be inside: the row is written with none,
   * and the isolation policy would refuse an insert whose `tenant_id` does not match a session
   * that does not exist. `register_mcp_client` is the definer function of migration `0058`, which
   * is what lets the application role write a row nobody owns -- and, on its way in, sweep the
   * unclaimed rows older than a day.
   *
   * Both identifiers are minted here rather than in the database for the same reason `createClient`
   * mints them: the public one is quoted back at `/authorize` and must say nothing about anyone.
   */
  async registerSelfClient(input: {
    name: string;
    redirectUris: readonly string[];
    maxScopes: readonly McpScope[];
  }): Promise<{ id: string; clientId: string }> {
    const id = randomUUID();
    const clientId = randomUUID();
    await this.database`
      select register_mcp_client(
        ${id}, ${clientId}, ${input.name},
        ${this.database.array([...input.redirectUris])}, ${this.database.array([...input.maxScopes])}
      )`;
    return { id, clientId };
  }

  /**
   * The first tenant to authorize an unclaimed client takes it.
   *
   * False means it was not this call's to take: either it never existed, or somebody else claimed
   * it first. The caller decides which, by looking again -- this method deliberately does not, so
   * that the answer it gives is only ever about what this statement did.
   */
  async claimClient(clientId: string, tenantId: string): Promise<boolean> {
    const [row] = await this.database<Array<{ claimed: boolean }>>`
      select claim_mcp_client(${clientId}, ${tenantId}) as claimed`;
    return row?.claimed === true;
  }

  async resolveRefreshToken(tokenHash: string): Promise<McpRefreshResolution | null> {
    const [row] = await this.database<
      Array<{
        tokenId: string;
        tenantId: string;
        grantId: string;
        clientId: string;
        familyId: string;
        scopes: string[];
        usedAt: Date | null;
        expiresAt: Date;
        revokedAt: Date | null;
        grantStatus: string;
      }>
    >`
      select token_id as "tokenId", tenant_id as "tenantId", grant_id as "grantId",
             client_id as "clientId", family_id as "familyId", scopes, used_at as "usedAt",
             expires_at as "expiresAt", revoked_at as "revokedAt", grant_status as "grantStatus"
      from lookup_mcp_refresh_token(${tokenHash})`;
    if (!row) return null;
    return { ...row, scopes: row.scopes as McpScope[], grantStatus: row.grantStatus as McpGrantStatus };
  }

  async resolveServiceAccount(secretHash: string): Promise<McpServiceAccountResolution | null> {
    const [row] = await this.database<
      Array<{
        id: string;
        tenantId: string;
        scopes: string[];
        permissions: string[];
        expiresAt: Date;
        disabledAt: Date | null;
        matchedPrevious: boolean;
      }>
    >`
      select id, tenant_id as "tenantId", scopes, permissions, expires_at as "expiresAt",
             disabled_at as "disabledAt", matched_previous as "matchedPrevious"
      from lookup_mcp_service_account(${secretHash})`;
    if (!row) return null;
    return { ...row, scopes: row.scopes as McpScope[] };
  }

  async consumeAuthorizationCode(codeHash: string, redirectUri: string): Promise<McpAuthorizationCodeClaim | null> {
    // The claim happens inside the function: it is the update that consumes the row, so a second
    // exchange matches nothing rather than racing this one.
    const [row] = await this.database<
      Array<{
        requestId: string;
        tenantId: string;
        clientId: string;
        membershipId: string;
        scopes: string[];
        codeChallenge: string;
        audience: string;
      }>
    >`
      select request_id as "requestId", tenant_id as "tenantId", client_id as "clientId",
             membership_id as "membershipId", scopes, code_challenge as "codeChallenge", audience
      from consume_mcp_authorization_code(${codeHash}, ${redirectUri})`;
    if (!row) return null;
    return { ...row, scopes: row.scopes as McpScope[] };
  }

  createClient(
    context: TenantContext,
    input: {
      name: string;
      kind: "public" | "confidential";
      redirectUris: readonly string[];
      maxScopes: readonly McpScope[];
      secretHash: string | null;
    }
  ): Promise<McpClientRecord> {
    return withTenant(this.database, context.tenantId, async (tx) => {
      const id = randomUUID();
      // The public identifier is a fresh UUID rather than anything derived from the name: it is
      // shown to a client and quoted back at `/authorize`, so it must say nothing about the tenant.
      const clientId = randomUUID();
      const [row] = await tx<{ createdAt: Date }[]>`
        insert into mcp_clients (
          id, tenant_id, client_id, name, kind, secret_hash, redirect_uris, max_scopes,
          created_by_membership_id
        )
        values (
          ${id}, ${context.tenantId}, ${clientId}, ${input.name}, ${input.kind}, ${input.secretHash},
          ${tx.array([...input.redirectUris])}, ${tx.array([...input.maxScopes])},
          ${context.membershipId}
        )
        returning created_at as "createdAt"`;
      return {
        id,
        clientId,
        name: input.name,
        kind: input.kind,
        redirectUris: input.redirectUris,
        maxScopes: input.maxScopes,
        status: "active" as const,
        createdAt: row!.createdAt
      };
    });
  }

  listClients(context: TenantContext): Promise<readonly McpClientRecord[]> {
    return withTenant(this.database, context.tenantId, async (tx) => {
      // `secret_hash` is not in the projection and must never be: a listing is the one place a
      // hash would travel to a screen for no reason at all.
      const rows = await tx<
        Array<{
          id: string;
          clientId: string;
          name: string;
          kind: string;
          redirectUris: string[];
          maxScopes: string[];
          status: string;
          createdAt: Date;
        }>
      >`
        select id, client_id as "clientId", name, kind, redirect_uris as "redirectUris",
               max_scopes as "maxScopes", status, created_at as "createdAt"
        from mcp_clients where tenant_id = ${context.tenantId}
        order by created_at desc, id`;
      return rows.map((row) => ({
        ...row,
        kind: row.kind as "public" | "confidential",
        maxScopes: row.maxScopes as McpScope[],
        status: row.status as "active" | "suspended"
      }));
    });
  }

  deleteClient(context: TenantContext, clientId: string): Promise<boolean> {
    return withTenant(this.database, context.tenantId, async (tx) => {
      const deleted = await tx<{ id: string }[]>`
        delete from mcp_clients where tenant_id = ${context.tenantId} and id = ${clientId} returning id`;
      return deleted.length > 0;
    });
  }

  createAuthorizationRequest(
    context: TenantContext,
    input: {
      clientId: string;
      membershipId: string;
      codeHash: string;
      scopes: readonly McpScope[];
      codeChallenge: string;
      redirectUri: string;
      audience: string;
      expiresAt: Date;
    }
  ): Promise<void> {
    return withTenant(this.database, context.tenantId, async (tx) => {
      await tx`
        insert into mcp_authorization_requests (
          id, tenant_id, client_id, membership_id, code_hash, scopes, code_challenge,
          code_challenge_method, redirect_uri, audience, expires_at
        )
        values (
          ${randomUUID()}, ${context.tenantId}, ${input.clientId}, ${input.membershipId},
          ${input.codeHash}, ${tx.array([...input.scopes])}, ${input.codeChallenge},
          'S256', ${input.redirectUri}, ${input.audience}, ${input.expiresAt}
        )`;
    });
  }

  createGrant(
    scope: McpTenantScope,
    input: {
      clientId: string | null;
      actorType: "user" | "service_account";
      actorMembershipId: string | null;
      actorServiceAccountId: string | null;
      scopes: readonly McpScope[];
      expiresAt: Date;
    }
  ): Promise<string> {
    return withTenant(this.database, scope.tenantId, async (tx) => {
      const id = randomUUID();
      await tx`
        insert into mcp_grants (
          id, tenant_id, client_id, actor_type, actor_membership_id, actor_service_account_id,
          scopes, expires_at
        )
        values (
          ${id}, ${scope.tenantId}, ${input.clientId}, ${input.actorType},
          ${input.actorMembershipId}, ${input.actorServiceAccountId},
          ${tx.array([...input.scopes])}, ${input.expiresAt}
        )`;
      return id;
    });
  }

  issueAccessToken(
    scope: McpTenantScope,
    input: { grantId: string; tokenHash: string; audience: string; scopes: readonly McpScope[]; expiresAt: Date }
  ): Promise<string> {
    return withTenant(this.database, scope.tenantId, async (tx) => {
      const id = randomUUID();
      await tx`
        insert into mcp_access_tokens (id, tenant_id, grant_id, token_hash, audience, scopes, expires_at)
        values (${id}, ${scope.tenantId}, ${input.grantId}, ${input.tokenHash}, ${input.audience},
          ${tx.array([...input.scopes])}, ${input.expiresAt})`;
      return id;
    });
  }

  issueRefreshToken(
    scope: McpTenantScope,
    input: { grantId: string; familyId: string; tokenHash: string; expiresAt: Date }
  ): Promise<string> {
    return withTenant(this.database, scope.tenantId, async (tx) => {
      const id = randomUUID();
      await tx`
        insert into mcp_refresh_tokens (id, tenant_id, grant_id, family_id, token_hash, expires_at)
        values (${id}, ${scope.tenantId}, ${input.grantId}, ${input.familyId}, ${input.tokenHash},
          ${input.expiresAt})`;
      return id;
    });
  }

  rotateRefreshToken(
    scope: McpTenantScope,
    input: {
      tokenId: string;
      grantId: string;
      familyId: string;
      tokenHash: string;
      expiresAt: Date;
      at: Date;
    }
  ): Promise<string | null> {
    return withTenant(this.database, scope.tenantId, async (tx) => {
      // Spending the old token is the lock. `used_at is null` in the predicate means two requests
      // racing the same refresh produce one successor and one loser, not two live lineages.
      const spent = await tx<{ id: string }[]>`
        update mcp_refresh_tokens set used_at = ${input.at}
        where tenant_id = ${scope.tenantId} and id = ${input.tokenId} and used_at is null
        returning id`;
      if (spent.length === 0) return null;
      const id = randomUUID();
      await tx`
        insert into mcp_refresh_tokens (id, tenant_id, grant_id, family_id, token_hash, expires_at)
        values (${id}, ${scope.tenantId}, ${input.grantId}, ${input.familyId}, ${input.tokenHash},
          ${input.expiresAt})`;
      await tx`
        update mcp_refresh_tokens set replaced_by_id = ${id}
        where tenant_id = ${scope.tenantId} and id = ${input.tokenId}`;
      return id;
    });
  }

  revokeAccessToken(scope: McpTenantScope, tokenId: string, at: Date): Promise<boolean> {
    return withTenant(this.database, scope.tenantId, async (tx) => {
      const revoked = await tx<{ id: string }[]>`
        update mcp_access_tokens set revoked_at = ${at}
        where tenant_id = ${scope.tenantId} and id = ${tokenId} and revoked_at is null
        returning id`;
      return revoked.length > 0;
    });
  }

  revokeRefreshFamily(scope: McpTenantScope, familyId: string, at: Date): Promise<number> {
    return withTenant(this.database, scope.tenantId, async (tx) => {
      const revoked = await tx<{ id: string }[]>`
        update mcp_refresh_tokens set revoked_at = ${at}
        where tenant_id = ${scope.tenantId} and family_id = ${familyId} and revoked_at is null
        returning id`;
      return revoked.length;
    });
  }

  createServiceAccount(
    context: TenantContext,
    input: {
      name: string;
      ownerMembershipId: string;
      scopes: readonly McpScope[];
      permissions: readonly string[];
      secretHash: string;
      expiresAt: Date;
    }
  ): Promise<McpServiceAccountRecord> {
    return withTenant(this.database, context.tenantId, async (tx) => {
      const id = randomUUID();
      const [row] = await tx<{ createdAt: Date }[]>`
        insert into mcp_service_accounts (
          id, tenant_id, name, owner_membership_id, scopes, permissions, secret_hash, expires_at
        )
        values (
          ${id}, ${context.tenantId}, ${input.name}, ${input.ownerMembershipId},
          ${tx.array([...input.scopes])}, ${tx.array([...input.permissions])},
          ${input.secretHash}, ${input.expiresAt}
        )
        returning created_at as "createdAt"`;
      return {
        id,
        name: input.name,
        ownerMembershipId: input.ownerMembershipId,
        scopes: input.scopes,
        permissions: input.permissions,
        expiresAt: input.expiresAt,
        disabledAt: null,
        secretRotatedAt: null,
        createdAt: row!.createdAt
      };
    });
  }

  listServiceAccounts(context: TenantContext): Promise<readonly McpServiceAccountRecord[]> {
    return withTenant(this.database, context.tenantId, async (tx) => {
      const rows = await tx<
        Array<{
          id: string;
          name: string;
          ownerMembershipId: string;
          scopes: string[];
          permissions: string[];
          expiresAt: Date;
          disabledAt: Date | null;
          secretRotatedAt: Date | null;
          createdAt: Date;
        }>
      >`
        select id, name, owner_membership_id as "ownerMembershipId", scopes, permissions,
               expires_at as "expiresAt", disabled_at as "disabledAt",
               secret_rotated_at as "secretRotatedAt", created_at as "createdAt"
        from mcp_service_accounts where tenant_id = ${context.tenantId}
        order by created_at desc, id`;
      return rows.map((row) => ({ ...row, scopes: row.scopes as McpScope[] }));
    });
  }

  rotateServiceAccountSecret(
    context: TenantContext,
    serviceAccountId: string,
    input: { secretHash: string; at: Date; previousExpiresAt: Date }
  ): Promise<boolean> {
    return withTenant(this.database, context.tenantId, async (tx) => {
      // The secret being replaced becomes the previous one, with an expiry. Rotating twice inside
      // the window therefore drops the oldest key rather than accumulating live secrets.
      const rotated = await tx<{ id: string }[]>`
        update mcp_service_accounts
        set previous_secret_hash = secret_hash,
            previous_secret_expires_at = ${input.previousExpiresAt},
            secret_hash = ${input.secretHash},
            secret_rotated_at = ${input.at},
            updated_at = now()
        where tenant_id = ${context.tenantId} and id = ${serviceAccountId} and disabled_at is null
        returning id`;
      return rotated.length > 0;
    });
  }

  retirePreviousSecret(context: TenantContext, serviceAccountId: string, at: Date): Promise<boolean> {
    return withTenant(this.database, context.tenantId, async (tx) => {
      const retired = await tx<{ id: string }[]>`
        update mcp_service_accounts
        set previous_secret_hash = null, previous_secret_expires_at = null, updated_at = ${at}
        where tenant_id = ${context.tenantId} and id = ${serviceAccountId}
          and previous_secret_hash is not null
        returning id`;
      return retired.length > 0;
    });
  }

  disableServiceAccount(context: TenantContext, serviceAccountId: string, at: Date): Promise<boolean> {
    return withTenant(this.database, context.tenantId, async (tx) => {
      const disabled = await tx<{ id: string }[]>`
        update mcp_service_accounts set disabled_at = ${at}, updated_at = now()
        where tenant_id = ${context.tenantId} and id = ${serviceAccountId} and disabled_at is null
        returning id`;
      if (disabled.length === 0) return false;
      // Disabling the account has to reach the grants it holds, or an agent keeps calling with a
      // token minted before somebody decided it should stop.
      await tx`
        update mcp_grants set status = 'revoked', revoked_at = ${at}
        where tenant_id = ${context.tenantId} and actor_service_account_id = ${serviceAccountId}
          and status = 'active'`;
      await tx`
        update mcp_access_tokens t set revoked_at = ${at}
        from mcp_grants g
        where g.tenant_id = t.tenant_id and g.id = t.grant_id
          and t.tenant_id = ${context.tenantId}
          and g.actor_service_account_id = ${serviceAccountId} and t.revoked_at is null`;
      return true;
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

/**
 * The crypto the OAuth flow runs on, beside the store that holds what it produces.
 *
 * It lives in this layer for the same reason `IngressCrypto` has an implementation next to its
 * repository (ADR-0008): the use case is allowed to depend on the operation, not on `node:crypto`.
 * Nothing here is configurable. A knob on a token length or a digest is a knob somebody can turn
 * the wrong way.
 */
export class NodeMcpCrypto implements McpCrypto {
  /** 256 bits, base64url, 43 characters. Long enough that guessing is not a strategy. */
  mintToken(): string {
    return randomBytes(32).toString("base64url");
  }

  sha256(value: string): string {
    return createHash("sha256").update(value).digest("hex");
  }

  /** RFC 7636 S256: the digest is base64url, not hex, because that is what the client sends. */
  pkceChallenge(verifier: string): string {
    return createHash("sha256").update(verifier).digest("base64url");
  }

  matches(a: string, b: string): boolean {
    const left = Buffer.from(a, "utf8");
    const right = Buffer.from(b, "utf8");
    // Everything compared here is a digest of fixed width, so an early return on length reveals
    // nothing an attacker did not already know. `timingSafeEqual` throws on a mismatch, so the
    // check has to happen before it rather than inside it.
    if (left.length !== right.length) return false;
    return timingSafeEqual(left, right);
  }
}

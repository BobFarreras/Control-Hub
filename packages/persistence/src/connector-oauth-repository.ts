import { randomUUID } from "node:crypto";
import type {
  ConnectorOAuthRepository,
  CredentialEnvelope,
  OAuthExchangeAttempt,
  OAuthGrantRecord,
  OAuthProvider
} from "@control-hub/application";
import { withTenant, type DatabaseClient } from "@control-hub/database";
import type { TenantContext } from "@control-hub/domain";

export class PostgresConnectorOAuthRepository implements ConnectorOAuthRepository {
  constructor(private readonly database: DatabaseClient) {}

  async createAttempt(context: TenantContext, input: Parameters<ConnectorOAuthRepository["createAttempt"]>[1]) {
    await withTenant(this.database, context.tenantId, async (tx) => {
      await tx`insert into connector_oauth_attempts
        (id, tenant_id, instance_id, provider, state_hash, actor_membership_id, redirect_path, scopes,
         verifier_key_id, verifier_nonce, verifier_ciphertext, expires_at)
        values (${input.id}, ${context.tenantId}, ${input.instanceId}, ${input.provider}, ${input.stateHash},
          ${context.membershipId}, ${input.redirectPath}, ${input.scopes as string[]}, ${input.verifier.keyId},
          ${input.verifier.nonce}, ${input.verifier.ciphertext}, ${input.expiresAt})`;
    });
  }

  async claimState(stateHash: string, provider: OAuthProvider, now: Date) {
    const [attempt] = await this.database<{ id: string; tenantId: string; instanceId: string; redirectPath: string }[]>`
      select id, tenant_id as "tenantId", instance_id as "instanceId", redirect_path as "redirectPath"
      from claim_connector_oauth_state(${stateHash}, ${provider}, ${now})`;
    return attempt ?? null;
  }

  async receiveCode(input: Parameters<ConnectorOAuthRepository["receiveCode"]>[0]) {
    await withTenant(this.database, input.tenantId, async (tx) => {
      const rows = await tx`update connector_oauth_attempts set status = 'received', code_key_id = ${input.code.keyId},
        code_nonce = ${input.code.nonce}, code_ciphertext = ${input.code.ciphertext}, updated_at = ${input.now}
        where tenant_id = ${input.tenantId} and id = ${input.attemptId} and status = 'failed'
        returning id`;
      if (rows.length !== 1) throw new Error("OAUTH_STATE_INVALID");
      await tx`insert into connector_oauth_outbox (attempt_id, tenant_id) values (${input.attemptId}, ${input.tenantId})`;
    });
  }

  async cancel(input: Parameters<ConnectorOAuthRepository["cancel"]>[0]) {
    await withTenant(this.database, input.tenantId, async (tx) => {
      await tx`update connector_oauth_attempts set status = 'canceled', updated_at = ${input.now}
        where tenant_id = ${input.tenantId} and id = ${input.attemptId} and status = 'failed'`;
    });
  }

  async grant(context: TenantContext, instanceId: string): Promise<OAuthGrantRecord | null> {
    return withTenant(this.database, context.tenantId, async (tx) => {
      const [grant] = await tx<OAuthGrantRecord[]>`select provider, scopes, status, expires_at as "expiresAt",
        last_refreshed_at as "lastRefreshedAt" from connector_oauth_grants
        where tenant_id = ${context.tenantId} and instance_id = ${instanceId}`;
      return grant ?? null;
    });
  }

  async pendingOutbox(context: TenantContext): Promise<string[]> {
    return withTenant(this.database, context.tenantId, async (tx) =>
      (
        await tx<{ attemptId: string }[]>`select attempt_id as "attemptId" from connector_oauth_outbox
        where tenant_id = ${context.tenantId} and published_at is null and available_at <= now()
        order by available_at, attempt_id limit 100`
      ).map((row) => row.attemptId)
    );
  }

  async markPublished(context: TenantContext, attemptId: string): Promise<void> {
    await withTenant(this.database, context.tenantId, async (tx) => {
      await tx`update connector_oauth_outbox set published_at = now(), attempts = attempts + 1
        where tenant_id = ${context.tenantId} and attempt_id = ${attemptId} and published_at is null`;
    });
  }

  async exchangeAttempt(context: TenantContext, attemptId: string): Promise<OAuthExchangeAttempt | null> {
    return withTenant(this.database, context.tenantId, async (tx) => {
      const [row] = await tx<
        (Omit<OAuthExchangeAttempt, "verifier" | "code"> & {
          verifierKeyId: string;
          verifierNonce: Uint8Array;
          verifierCiphertext: Uint8Array;
          codeKeyId: string;
          codeNonce: Uint8Array;
          codeCiphertext: Uint8Array;
        })[]
      >`select id, tenant_id as "tenantId", instance_id as "instanceId", provider, scopes,
        verifier_key_id as "verifierKeyId", verifier_nonce as "verifierNonce",
        verifier_ciphertext as "verifierCiphertext", code_key_id as "codeKeyId",
        code_nonce as "codeNonce", code_ciphertext as "codeCiphertext"
        from connector_oauth_attempts where tenant_id = ${context.tenantId} and id = ${attemptId} and status = 'received'`;
      return row
        ? {
            id: row.id,
            tenantId: row.tenantId,
            instanceId: row.instanceId,
            provider: row.provider,
            scopes: row.scopes,
            verifier: { keyId: row.verifierKeyId, nonce: row.verifierNonce, ciphertext: row.verifierCiphertext },
            code: { keyId: row.codeKeyId, nonce: row.codeNonce, ciphertext: row.codeCiphertext }
          }
        : null;
    });
  }

  async completeExchange(
    context: TenantContext,
    input: {
      attemptId: string;
      instanceId: string;
      provider: OAuthProvider;
      scopes: readonly string[];
      access: CredentialEnvelope;
      refresh?: CredentialEnvelope;
      expiresAt: Date | null;
      now: Date;
    }
  ): Promise<void> {
    await withTenant(this.database, context.tenantId, async (tx) => {
      const [existing] = await tx<{ refreshId: string | null }[]>`select refresh_credential_id as "refreshId"
        from connector_oauth_grants where tenant_id = ${context.tenantId} and instance_id = ${input.instanceId}
        for update`;
      await tx`update connector_credentials set revoked_at = ${input.now}, updated_at = ${input.now}
        where tenant_id = ${context.tenantId} and instance_id = ${input.instanceId}
          and kind = 'oauth_access_token' and revoked_at is null`;
      const accessId = randomUUID();
      await tx`insert into connector_credentials (id, tenant_id, instance_id, kind, slot, key_id, nonce, ciphertext, expires_at)
        values (${accessId}, ${context.tenantId}, ${input.instanceId}, 'oauth_access_token', 'primary',
          ${input.access.keyId}, ${input.access.nonce}, ${input.access.ciphertext}, ${input.expiresAt})`;
      let refreshId: string | null = existing?.refreshId ?? null;
      if (input.refresh) {
        if (existing?.refreshId) {
          await tx`update connector_credentials set revoked_at = ${input.now}, updated_at = ${input.now}
            where tenant_id = ${context.tenantId} and id = ${existing.refreshId}`;
        }
        refreshId = randomUUID();
        await tx`insert into connector_credentials (id, tenant_id, instance_id, kind, slot, key_id, nonce, ciphertext)
          values (${refreshId}, ${context.tenantId}, ${input.instanceId}, 'oauth_refresh_token', 'primary',
            ${input.refresh.keyId}, ${input.refresh.nonce}, ${input.refresh.ciphertext})`;
      }
      await tx`insert into connector_oauth_grants (id, tenant_id, instance_id, provider, scopes, status,
        access_credential_id, refresh_credential_id, expires_at, last_refreshed_at)
        values (${randomUUID()}, ${context.tenantId}, ${input.instanceId}, ${input.provider}, ${input.scopes as string[]},
          'active', ${accessId}, ${refreshId}, ${input.expiresAt}, ${input.now})
        on conflict (tenant_id, instance_id) do update set provider = excluded.provider, scopes = excluded.scopes,
          status = 'active', access_credential_id = excluded.access_credential_id,
          refresh_credential_id = coalesce(excluded.refresh_credential_id, connector_oauth_grants.refresh_credential_id),
          expires_at = excluded.expires_at, last_refreshed_at = excluded.last_refreshed_at,
          version = connector_oauth_grants.version + 1, updated_at = excluded.last_refreshed_at`;
      await tx`update connector_oauth_attempts set status = 'exchanged', code_key_id = null, code_nonce = null,
        code_ciphertext = null, verifier_ciphertext = decode(repeat('00', 17), 'hex'), updated_at = ${input.now}
        where tenant_id = ${context.tenantId} and id = ${input.attemptId} and status = 'received'`;
    });
  }

  async acquireRefresh(
    context: TenantContext,
    instanceId: string,
    now: Date
  ): Promise<{
    provider: OAuthProvider;
    version: number;
    refresh: CredentialEnvelope;
    scopes: readonly string[];
  } | null> {
    return withTenant(this.database, context.tenantId, async (tx) => {
      const [grant] = await tx<
        {
          provider: OAuthProvider;
          version: number;
          scopes: string[];
          keyId: string;
          nonce: Uint8Array;
          ciphertext: Uint8Array;
        }[]
      >`
        update connector_oauth_grants g set refresh_lease_until = ${new Date(now.getTime() + 60_000)}, updated_at = ${now}
        from connector_credentials c
        where g.tenant_id = ${context.tenantId} and g.instance_id = ${instanceId} and g.status = 'active'
          and g.expires_at <= ${new Date(now.getTime() + 5 * 60_000)}
          and (g.refresh_lease_until is null or g.refresh_lease_until < ${now})
          and c.tenant_id = g.tenant_id and c.id = g.refresh_credential_id and c.revoked_at is null
        returning g.provider, g.version, g.scopes, c.key_id as "keyId", c.nonce, c.ciphertext`;
      return grant
        ? {
            provider: grant.provider,
            version: grant.version,
            scopes: grant.scopes,
            refresh: { keyId: grant.keyId, nonce: grant.nonce, ciphertext: grant.ciphertext }
          }
        : null;
    });
  }

  async completeRefresh(
    context: TenantContext,
    input: {
      instanceId: string;
      version: number;
      access: CredentialEnvelope;
      refresh?: CredentialEnvelope;
      expiresAt: Date;
      now: Date;
    }
  ): Promise<boolean> {
    return withTenant(this.database, context.tenantId, async (tx) => {
      const [locked] = await tx<{ accessId: string; refreshId: string | null }[]>`
        select access_credential_id as "accessId", refresh_credential_id as "refreshId"
        from connector_oauth_grants where tenant_id = ${context.tenantId} and instance_id = ${input.instanceId}
          and version = ${input.version} and status = 'active' for update`;
      if (!locked) return false;
      const accessId = randomUUID();
      await tx`insert into connector_credentials (id, tenant_id, instance_id, kind, slot, key_id, nonce, ciphertext, expires_at)
        values (${accessId}, ${context.tenantId}, ${input.instanceId}, 'oauth_access_token', 'secondary',
          ${input.access.keyId}, ${input.access.nonce}, ${input.access.ciphertext}, ${input.expiresAt})`;
      let refreshId = locked.refreshId;
      if (input.refresh) {
        refreshId = randomUUID();
        await tx`insert into connector_credentials (id, tenant_id, instance_id, kind, slot, key_id, nonce, ciphertext)
          values (${refreshId}, ${context.tenantId}, ${input.instanceId}, 'oauth_refresh_token', 'secondary',
            ${input.refresh.keyId}, ${input.refresh.nonce}, ${input.refresh.ciphertext})`;
      }
      await tx`update connector_credentials set revoked_at = ${input.now}, updated_at = ${input.now}
        where tenant_id = ${context.tenantId} and id = ${locked.accessId}`;
      if (input.refresh && locked.refreshId) {
        await tx`update connector_credentials set revoked_at = ${input.now}, updated_at = ${input.now}
          where tenant_id = ${context.tenantId} and id = ${locked.refreshId}`;
      }
      await tx`update connector_credentials set slot = 'primary', rotated_at = ${input.now}, updated_at = ${input.now}
        where tenant_id = ${context.tenantId} and id = ${accessId}`;
      if (input.refresh) {
        await tx`update connector_credentials set slot = 'primary', rotated_at = ${input.now}, updated_at = ${input.now}
          where tenant_id = ${context.tenantId} and id = ${refreshId}`;
      }
      await tx`update connector_oauth_grants set access_credential_id = ${accessId}, refresh_credential_id = ${refreshId},
        expires_at = ${input.expiresAt}, last_refreshed_at = ${input.now}, refresh_lease_until = null,
        version = version + 1, updated_at = ${input.now}
        where tenant_id = ${context.tenantId} and instance_id = ${input.instanceId} and version = ${input.version}`;
      return true;
    });
  }

  async requireReauthorization(context: TenantContext, instanceId: string, now: Date): Promise<void> {
    await withTenant(this.database, context.tenantId, async (tx) => {
      await tx`update connector_oauth_grants set status = 'reauthorization_required', refresh_lease_until = null,
        updated_at = ${now} where tenant_id = ${context.tenantId} and instance_id = ${instanceId}`;
    });
  }
}

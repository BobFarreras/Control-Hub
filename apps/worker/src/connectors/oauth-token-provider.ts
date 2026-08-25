import type { ConnectorSecretReader } from "@control-hub/application";
import type { OAuthClients } from "@control-hub/config";
import type { TenantContext } from "@control-hub/domain";
import { type CredentialVault, type PostgresConnectorOAuthRepository } from "@control-hub/persistence";

export class OAuthTokenProvider {
  constructor(
    private readonly repository: PostgresConnectorOAuthRepository,
    private readonly vault: CredentialVault,
    private readonly clients: OAuthClients,
    private readonly secrets: ConnectorSecretReader
  ) {}

  async accessToken(context: TenantContext, instanceId: string): Promise<string | null> {
    const now = new Date();
    const lease = await this.repository.acquireRefresh(context, instanceId, now);
    if (lease) await this.refresh(context, instanceId, lease, now);
    return this.secrets.open(context, instanceId, "oauth_access_token");
  }

  private async refresh(
    context: TenantContext,
    instanceId: string,
    lease: Awaited<ReturnType<PostgresConnectorOAuthRepository["acquireRefresh"]>> & {},
    now: Date
  ) {
    const client = this.clients[lease.provider];
    if (!client) throw new Error("OAUTH_PROVIDER_NOT_CONFIGURED");
    const refreshToken = this.vault.open(lease.refresh, {
      tenantId: context.tenantId,
      instanceId,
      purpose: "oauth_refresh_token"
    });
    const endpoint =
      lease.provider === "google"
        ? "https://oauth2.googleapis.com/token"
        : "https://login.microsoftonline.com/common/oauth2/v2.0/token";
    const response = await fetch(endpoint, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams({
        client_id: client.clientId,
        client_secret: client.clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
        scope: lease.scopes.join(" ")
      })
    });
    const text = await response.text();
    if (Buffer.byteLength(text) > 64 * 1024) throw new Error("OAUTH_RESPONSE_TOO_LARGE");
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new Error("OAUTH_RESPONSE_INVALID");
    }
    if (!response.ok) {
      if (payload.error === "invalid_grant") {
        await this.repository.requireReauthorization(context, instanceId, now);
        throw new Error("OAUTH_REAUTHORIZATION_REQUIRED");
      }
      throw new Error(
        response.status === 429 || response.status >= 500 ? "OAUTH_REFRESH_TRANSIENT" : "OAUTH_REFRESH_FAILED"
      );
    }
    const access = field(payload.access_token, 16, 16_384);
    const rotatedRefresh = payload.refresh_token === undefined ? null : field(payload.refresh_token, 16, 16_384);
    const expiresIn = typeof payload.expires_in === "number" ? payload.expires_in : Number(payload.expires_in);
    if (!Number.isFinite(expiresIn) || expiresIn < 60 || expiresIn > 86_400) throw new Error("OAUTH_RESPONSE_INVALID");
    const expiresAt = new Date(now.getTime() + expiresIn * 1000);
    await this.repository.completeRefresh(context, {
      instanceId,
      version: lease.version,
      access: this.vault.seal(access, { tenantId: context.tenantId, instanceId, purpose: "oauth_access_token" }),
      ...(rotatedRefresh
        ? {
            refresh: this.vault.seal(rotatedRefresh, {
              tenantId: context.tenantId,
              instanceId,
              purpose: "oauth_refresh_token"
            })
          }
        : {}),
      expiresAt,
      now
    });
  }
}

function field(value: unknown, min: number, max: number) {
  if (typeof value !== "string" || value.length < min || value.length > max) throw new Error("OAUTH_RESPONSE_INVALID");
  return value;
}

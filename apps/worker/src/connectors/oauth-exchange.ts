import type { OAuthClients } from "@control-hub/config";
import type { TenantContext } from "@control-hub/domain";
import { type CredentialVault, type PostgresConnectorOAuthRepository } from "@control-hub/persistence";

export const connectorOAuthExchangeJobName = "connector-oauth-exchange";

export async function exchangeConnectorOAuthCode(options: {
  repository: PostgresConnectorOAuthRepository;
  vault: CredentialVault;
  clients: OAuthClients;
  appOrigin: string;
  context: TenantContext;
  attemptId: string;
  connectorType: string;
}) {
  const attempt = await options.repository.exchangeAttempt(options.context, options.attemptId);
  if (!attempt) return { status: "already_processed" as const };
  const client = options.clients[attempt.provider];
  if (!client) throw new Error("OAUTH_PROVIDER_NOT_CONFIGURED");
  const verifier = options.vault.open(attempt.verifier, {
    tenantId: attempt.tenantId,
    instanceId: attempt.instanceId,
    purpose: `oauth-pkce:${attempt.id}`
  });
  const code = options.vault.open(attempt.code, {
    tenantId: attempt.tenantId,
    instanceId: attempt.instanceId,
    purpose: `oauth-code:${attempt.id}`
  });
  const endpoint =
    attempt.provider === "google"
      ? "https://oauth2.googleapis.com/token"
      : "https://login.microsoftonline.com/common/oauth2/v2.0/token";
  const redirectUri = `${new URL(options.appOrigin).origin}/api/v1/integrations/oauth/callback/${options.connectorType}`;
  const body = new URLSearchParams({
    client_id: client.clientId,
    client_secret: client.clientSecret,
    code,
    code_verifier: verifier,
    grant_type: "authorization_code",
    redirect_uri: redirectUri
  });
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body,
    signal: AbortSignal.timeout(15_000),
    redirect: "error"
  });
  const payload = await boundedJson(response, 64 * 1024);
  if (!response.ok)
    throw new Error(
      response.status >= 500 || response.status === 429 ? "OAUTH_EXCHANGE_TRANSIENT" : "OAUTH_EXCHANGE_FAILED"
    );
  const accessToken = stringField(payload, "access_token", 16, 16_384);
  const refreshToken = optionalStringField(payload, "refresh_token", 16, 16_384);
  const expiresIn = numberField(payload, "expires_in", 60, 86_400);
  const now = new Date();
  await options.repository.completeExchange(options.context, {
    attemptId: attempt.id,
    instanceId: attempt.instanceId,
    provider: attempt.provider,
    scopes: attempt.scopes,
    access: options.vault.seal(accessToken, {
      tenantId: attempt.tenantId,
      instanceId: attempt.instanceId,
      purpose: "oauth_access_token"
    }),
    ...(refreshToken
      ? {
          refresh: options.vault.seal(refreshToken, {
            tenantId: attempt.tenantId,
            instanceId: attempt.instanceId,
            purpose: "oauth_refresh_token"
          })
        }
      : {}),
    expiresAt: new Date(now.getTime() + expiresIn * 1000),
    now
  });
  return { status: "exchanged" as const };
}

async function boundedJson(response: Response, limit: number): Promise<Record<string, unknown>> {
  const text = await response.text();
  if (Buffer.byteLength(text) > limit) throw new Error("OAUTH_RESPONSE_TOO_LARGE");
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    return parsed as Record<string, unknown>;
  } catch {
    throw new Error("OAUTH_RESPONSE_INVALID");
  }
}
function stringField(value: Record<string, unknown>, key: string, min: number, max: number) {
  const field = value[key];
  if (typeof field !== "string" || field.length < min || field.length > max) throw new Error("OAUTH_RESPONSE_INVALID");
  return field;
}
function optionalStringField(value: Record<string, unknown>, key: string, min: number, max: number) {
  return value[key] === undefined ? null : stringField(value, key, min, max);
}
function numberField(value: Record<string, unknown>, key: string, min: number, max: number) {
  const field = value[key];
  if (typeof field !== "number" || !Number.isFinite(field) || field < min || field > max)
    throw new Error("OAUTH_RESPONSE_INVALID");
  return field;
}

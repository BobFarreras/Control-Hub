import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { ConnectorRegistry } from "@control-hub/connectors";
import { hasPermission, type TenantContext } from "@control-hub/domain";
import type { ConnectorRepository, CredentialEnvelope, CredentialSealer } from "./connectors.js";

export type OAuthProvider = "google" | "microsoft";
export type OAuthClientIds = Readonly<Partial<Record<OAuthProvider, string>>>;

export class ConnectorOAuthError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}

export type OAuthGrantRecord = {
  provider: OAuthProvider;
  scopes: readonly string[];
  status: "active" | "reauthorization_required" | "revoked";
  expiresAt: Date | null;
  lastRefreshedAt: Date | null;
};

export type OAuthExchangeAttempt = {
  id: string;
  tenantId: string;
  instanceId: string;
  provider: OAuthProvider;
  scopes: readonly string[];
  verifier: CredentialEnvelope;
  code: CredentialEnvelope;
};

export interface ConnectorOAuthRepository {
  createAttempt(
    context: TenantContext,
    input: {
      id: string;
      instanceId: string;
      provider: OAuthProvider;
      stateHash: string;
      redirectPath: string;
      scopes: readonly string[];
      verifier: CredentialEnvelope;
      expiresAt: Date;
    }
  ): Promise<void>;
  claimState(
    stateHash: string,
    provider: OAuthProvider,
    now: Date
  ): Promise<{ id: string; tenantId: string; instanceId: string; redirectPath: string } | null>;
  receiveCode(input: { tenantId: string; attemptId: string; code: CredentialEnvelope; now: Date }): Promise<void>;
  cancel(input: { tenantId: string; attemptId: string; now: Date }): Promise<void>;
  grant(context: TenantContext, instanceId: string): Promise<OAuthGrantRecord | null>;
}

export class ConnectorOAuthService {
  constructor(
    private readonly instances: ConnectorRepository,
    private readonly repository: ConnectorOAuthRepository,
    private readonly registry: ConnectorRegistry,
    private readonly sealer: CredentialSealer,
    private readonly clientIds: OAuthClientIds
  ) {}

  async begin(
    context: TenantContext,
    instanceId: string,
    appOrigin: string,
    locale: "ca" | "es" | "en",
    now = new Date()
  ) {
    if (!hasPermission(context, "integrations:manage")) throw new ConnectorOAuthError("FORBIDDEN");
    if (!context.mfaEnabled) throw new ConnectorOAuthError("MFA_REQUIRED");
    const instance = await this.instances.getInstance(context, instanceId);
    if (!instance) throw new ConnectorOAuthError("INSTANCE_NOT_FOUND");
    const declaration = this.registry.require(instance.connectorType).capabilities.oauth;
    if (!declaration) throw new ConnectorOAuthError("OAUTH_NOT_DECLARED");
    const clientId = this.clientIds[declaration.provider];
    if (!clientId) throw new ConnectorOAuthError("OAUTH_PROVIDER_NOT_CONFIGURED");

    const id = randomUUID();
    const state = randomBytes(32).toString("base64url");
    const verifier = randomBytes(48).toString("base64url");
    const stateHash = digest(state);
    const redirectPath = `/${locale}/integrations/${instanceId}?oauth=connected`;
    const callback = `${new URL(appOrigin).origin}/api/v1/integrations/oauth/callback/${instance.connectorType}`;
    await this.repository.createAttempt(context, {
      id,
      instanceId,
      provider: declaration.provider,
      stateHash,
      redirectPath,
      scopes: declaration.scopes,
      verifier: this.sealer.seal(verifier, { tenantId: context.tenantId, instanceId, purpose: `oauth-pkce:${id}` }),
      expiresAt: new Date(now.getTime() + 10 * 60_000)
    });
    const url = new URL(declaration.authorizationUrl);
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", callback);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", declaration.scopes.join(" "));
    url.searchParams.set("state", state);
    url.searchParams.set("code_challenge", createHash("sha256").update(verifier).digest("base64url"));
    url.searchParams.set("code_challenge_method", "S256");
    if (declaration.provider === "google") {
      url.searchParams.set("access_type", "offline");
      url.searchParams.set("prompt", "consent");
    }
    return { authorizationUrl: url.toString(), expiresAt: new Date(now.getTime() + 10 * 60_000) };
  }

  async callback(input: { connectorType: string; state: string; code?: string; error?: string }, now = new Date()) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(input.state)) throw new ConnectorOAuthError("OAUTH_STATE_INVALID");
    const connector = this.registry.find(input.connectorType);
    const provider = connector?.capabilities.oauth?.provider;
    if (!provider) throw new ConnectorOAuthError("OAUTH_STATE_INVALID");
    const attempt = await this.repository.claimState(digest(input.state), provider, now);
    if (!attempt) throw new ConnectorOAuthError("OAUTH_STATE_INVALID");
    if (input.error) {
      await this.repository.cancel({ tenantId: attempt.tenantId, attemptId: attempt.id, now });
      return { redirectPath: attempt.redirectPath.replace("oauth=connected", "oauth=canceled") };
    }
    if (!input.code || input.code.length > 8_192) throw new ConnectorOAuthError("OAUTH_STATE_INVALID");
    const code = this.sealer.seal(input.code, {
      tenantId: attempt.tenantId,
      instanceId: attempt.instanceId,
      purpose: `oauth-code:${attempt.id}`
    });
    await this.repository.receiveCode({ tenantId: attempt.tenantId, attemptId: attempt.id, code, now });
    return { redirectPath: attempt.redirectPath };
  }

  getGrant(context: TenantContext, instanceId: string) {
    if (!hasPermission(context, "integrations:read")) throw new ConnectorOAuthError("FORBIDDEN");
    return this.repository.grant(context, instanceId);
  }
}

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

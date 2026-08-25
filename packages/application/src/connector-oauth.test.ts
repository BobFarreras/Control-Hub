import { createHash } from "node:crypto";
import { connectorRegistry } from "@control-hub/connectors";
import type { TenantContext } from "@control-hub/domain";
import { describe, expect, it } from "vitest";
import { ConnectorOAuthError, ConnectorOAuthService, type ConnectorOAuthRepository } from "./connector-oauth.js";
import type { ConnectorRepository, CredentialAad, CredentialEnvelope } from "./connectors.js";

const instanceId = "33333333-3333-4333-8333-333333333333";
const context: TenantContext = {
  tenantId: "11111111-1111-4111-8111-111111111111",
  membershipId: "membership",
  userId: "user",
  roles: ["owner"],
  permissions: ["integrations:read", "integrations:manage"],
  mfaEnabled: true
};

function fixture() {
  let attempt: Parameters<ConnectorOAuthRepository["createAttempt"]>[1] | null = null;
  let claimed = false;
  const received: CredentialEnvelope[] = [];
  const repository: ConnectorOAuthRepository = {
    createAttempt(_context, input) {
      attempt = input;
      return Promise.resolve();
    },
    claimState(hash, provider, now) {
      if (
        !attempt ||
        claimed ||
        attempt.stateHash !== hash ||
        attempt.provider !== provider ||
        attempt.expiresAt <= now
      ) {
        return Promise.resolve(null);
      }
      claimed = true;
      return Promise.resolve({
        id: attempt.id,
        tenantId: context.tenantId,
        instanceId,
        redirectPath: attempt.redirectPath
      });
    },
    receiveCode(input) {
      received.push(input.code);
      return Promise.resolve();
    },
    cancel() {
      return Promise.resolve();
    },
    grant() {
      return Promise.resolve(null);
    }
  };
  const sealed: { plaintext: string; aad: CredentialAad }[] = [];
  const service = new ConnectorOAuthService(
    {
      getInstance: () => Promise.resolve({ connectorType: "gmail" })
    } as unknown as ConnectorRepository,
    repository,
    connectorRegistry,
    {
      seal(plaintext, aad) {
        sealed.push({ plaintext, aad });
        return { keyId: "key", nonce: Buffer.alloc(12), ciphertext: Buffer.from("ciphertext-and-tag") };
      },
      open() {
        throw new Error("not used");
      }
    },
    { google: "google-client" }
  );
  return { service, sealed, received, attempt: () => attempt };
}

describe("ConnectorOAuthService", () => {
  it("binds a one-use state and PKCE challenge to the tenant attempt without storing plaintext", async () => {
    const { service, sealed, received, attempt } = fixture();
    const started = await service.begin(context, instanceId, "https://hub.example/path", "ca", new Date(0));
    const url = new URL(started.authorizationUrl);
    const state = url.searchParams.get("state")!;
    const verifier = sealed[0]!.plaintext;

    expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(attempt()?.stateHash).toBe(createHash("sha256").update(state).digest("hex"));
    expect(attempt()?.stateHash).not.toContain(state);
    expect(url.searchParams.get("code_challenge")).toBe(createHash("sha256").update(verifier).digest("base64url"));
    expect(url.searchParams.get("redirect_uri")).toBe("https://hub.example/api/v1/integrations/oauth/callback/gmail");

    await expect(
      service.callback({ connectorType: "gmail", state, code: "authorization-code" }, new Date(1))
    ).resolves.toEqual({ redirectPath: `/ca/integrations/${instanceId}?oauth=connected` });
    expect(received).toHaveLength(1);
    expect(sealed[1]?.aad.purpose).toMatch(/^oauth-code:/);
    await expect(
      service.callback({ connectorType: "gmail", state, code: "replay" }, new Date(2))
    ).rejects.toMatchObject({ code: "OAUTH_STATE_INVALID" });
  });

  it("requires MFA and an installation client before creating an attempt", async () => {
    const { service } = fixture();
    await expect(
      service.begin({ ...context, mfaEnabled: false }, instanceId, "https://hub.example", "en")
    ).rejects.toBeInstanceOf(ConnectorOAuthError);
    const missingClient = new ConnectorOAuthService(
      { getInstance: () => Promise.resolve({ connectorType: "gmail" }) } as unknown as ConnectorRepository,
      {} as ConnectorOAuthRepository,
      connectorRegistry,
      {} as never,
      {}
    );
    await expect(missingClient.begin(context, instanceId, "https://hub.example", "en")).rejects.toMatchObject({
      code: "OAUTH_PROVIDER_NOT_CONFIGURED"
    });
  });
});

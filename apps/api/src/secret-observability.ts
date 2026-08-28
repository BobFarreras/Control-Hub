import type { ApiEnvironment } from "@control-hub/config";

export const secretSources = ["environment", "file", "external_manager", "not_observed", "not_applicable"] as const;
export type SecretSource = (typeof secretSources)[number];
export type SecretHealth = "available" | "warning" | "not_observed" | "not_applicable";

export type SecretObservation = {
  name: string;
  source: SecretSource;
  configured: boolean | null;
  consumers: string[];
  loadedAt: string | null;
  lastRotatedAt: null;
  version: string | null;
  health: SecretHealth;
};

export type SecretProviderObservation = {
  kind: "environment" | "runtime_files" | "bitwarden";
  health: SecretHealth;
  checkedAt: string;
};

function sourceOf(raw: NodeJS.ProcessEnv, variable: string, provider: SecretProviderObservation["kind"]): SecretSource {
  if (raw[`${variable}_FILE`]) return provider === "bitwarden" ? "external_manager" : "file";
  if (raw[variable]) return "environment";
  return "not_observed";
}

function observed(
  name: string,
  consumers: string[],
  source: SecretSource,
  configured: boolean | null,
  loadedAt: string,
  version: string | null = null
): SecretObservation {
  return {
    name,
    source,
    configured,
    consumers,
    loadedAt: configured ? loadedAt : null,
    lastRotatedAt: null,
    version,
    health:
      source === "environment"
        ? "warning"
        : source === "not_observed"
          ? "not_observed"
          : configured
            ? "available"
            : "warning"
  };
}

/**
 * Builds the safe boot snapshot exposed to an Owner.
 *
 * It reads only presence and source variable names. It never hashes a value: a digest of a
 * low-entropy password is an offline oracle, not harmless metadata. Worker-only secrets are
 * inferred from the provider client ID because production deliberately does not mount them in the
 * API. Their health stays `not_observed`; only the worker can prove that it loaded them.
 */
export function platformSecretSnapshot(
  raw: NodeJS.ProcessEnv,
  environment: ApiEnvironment,
  loadedAt = new Date().toISOString()
): { provider: SecretProviderObservation; secrets: SecretObservation[] } {
  const provider = environment.SECRETS_PROVIDER;
  const providerObservation: SecretProviderObservation = {
    kind: provider,
    health: provider === "bitwarden" ? "not_observed" : provider === "environment" ? "warning" : "available",
    checkedAt: loadedAt
  };
  const runtime = (name: string, consumers: string[], configured = true, version: string | null = null) =>
    observed(name, consumers, sourceOf(raw, name, provider), configured, loadedAt, version);
  const workerOnly = (name: string, configured: boolean) =>
    observed(
      name,
      ["worker"],
      provider === "bitwarden" && configured ? "external_manager" : "not_observed",
      configured ? true : null,
      loadedAt
    );

  return {
    provider: providerObservation,
    secrets: [
      runtime("DATABASE_URL", ["api", "worker"]),
      runtime("REDIS_URL", ["api", "worker"]),
      runtime("BETTER_AUTH_SECRET", ["api"]),
      runtime(
        "CONNECTOR_KEY_RING",
        ["api", "worker"],
        environment.connectorKeyRing !== null,
        environment.connectorKeyRing?.activeKeyId ?? null
      ),
      workerOnly("GOOGLE_OAUTH_CLIENT_SECRET", Boolean(environment.oauthClientIds.google)),
      workerOnly("MICROSOFT_OAUTH_CLIENT_SECRET", Boolean(environment.oauthClientIds.microsoft)),
      // A relay that authenticates nothing is a configuration, not a missing secret: Mailpit in
      // development and a relay on the same trusted network both work that way. Reporting either as
      // `not_observed` would leave an Owner a permanent row they can never resolve.
      environment.SMTP_PASSWORD === undefined
        ? {
            name: "SMTP_PASSWORD",
            source: "not_applicable" as const,
            configured: false,
            consumers: ["api"],
            loadedAt: null,
            lastRotatedAt: null,
            version: null,
            health: "not_applicable" as const
          }
        : runtime("SMTP_PASSWORD", ["api"])
    ]
  };
}

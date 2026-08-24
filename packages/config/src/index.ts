import { z } from "zod";
import { parseEgressAllowlist, type AllowedDestination } from "./egress-allowlist.js";
import { isFeatureEnabled, parseFeatureFlags } from "./flags.js";
import { parseKeyRing, type KeyRing } from "./key-ring.js";

const baseSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  DATABASE_URL: z.url().startsWith("postgres"),
  REDIS_URL: z.url().startsWith("redis"),
  APP_ORIGIN: z.url().default("http://localhost:3001"),
  BETTER_AUTH_SECRET: z.string().min(32),
  SMTP_HOST: z.string().min(1).default("127.0.0.1"),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(1025),
  SMTP_SECURE: z.stringbool().default(false),
  SMTP_FROM: z.email().default("control-hub@localhost.test"),
  WEBAUTHN_RP_ID: z.string().min(1).default("localhost"),
  WEBAUTHN_ORIGIN: z.url().default("http://localhost:3001"),
  // Comma-separated names from the registry in ./flags.ts. Empty means every flag is off.
  CONTROL_HUB_FLAGS: z.string().default(""),
  // The connector key ring, as JSON. Injected as a Docker secret; never in a versioned .env.
  // Its shape is validated by ./key-ring.ts. See docs/adr/0008-connector-credential-vault.md.
  CONNECTOR_KEY_RING: z.string().optional(),
  // Comma-separated origins a connector may reach besides the public internet, for services this
  // installation runs itself. Administrative: no tenant can add one. Parsed by ./egress-allowlist.ts.
  CONNECTOR_INTERNAL_ALLOWLIST: z.string().optional(),
  GOOGLE_OAUTH_CLIENT_ID: z.string().min(1).optional(),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().min(8).optional(),
  MICROSOFT_OAUTH_CLIENT_ID: z.string().min(1).optional(),
  MICROSOFT_OAUTH_CLIENT_SECRET: z.string().min(8).optional()
});

export const apiEnvironmentSchema = baseSchema.extend({
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  API_HOST: z.string().min(1).default("127.0.0.1")
});

export const workerEnvironmentSchema = baseSchema;

/**
 * `connectorKeyRing` is resolved at boot rather than at the first credential.
 *
 * A ring that is present but malformed is refused whether the flag is on or off: a typo in a
 * secret must fail on the day it is deployed, not on the day somebody enables connectors.
 *
 * A ring that is simply absent is null, and the process still starts. That is the specification's
 * choice and it is the right one operationally: an installation without a ring cannot seal a
 * credential, but it can still run everything else, and taking the whole API down over an
 * optional capability would be a worse failure than the one it prevents. What must not happen is
 * silence — `connectorKeyRingWarning` gives the composition root the line to log, and the
 * credential routes are not registered without a ring.
 *
 * The raw `CONNECTOR_KEY_RING` string does not survive parsing: it is dropped from the type, so
 * the only handle anybody has on the keys is a `KeyRing`, which refuses to print itself. An
 * environment object reaches a log sooner or later, and this is what makes that harmless.
 */
type ConnectorEnvironment = {
  connectorKeyRing: KeyRing | null;
  connectorEgressAllowlist: readonly AllowedDestination[];
};

type OAuthRawKeys =
  | "GOOGLE_OAUTH_CLIENT_ID"
  | "GOOGLE_OAUTH_CLIENT_SECRET"
  | "MICROSOFT_OAUTH_CLIENT_ID"
  | "MICROSOFT_OAUTH_CLIENT_SECRET";
export type OAuthProvider = "google" | "microsoft";
export type OAuthClientIds = Readonly<Partial<Record<OAuthProvider, string>>>;
export type OAuthClients = Readonly<Partial<Record<OAuthProvider, { clientId: string; clientSecret: string }>>>;
export type ApiEnvironment = Omit<z.infer<typeof apiEnvironmentSchema>, "CONNECTOR_KEY_RING" | OAuthRawKeys> &
  ConnectorEnvironment & { oauthClientIds: OAuthClientIds };
export type WorkerEnvironment = Omit<z.infer<typeof workerEnvironmentSchema>, "CONNECTOR_KEY_RING" | OAuthRawKeys> &
  ConnectorEnvironment & { oauthClients: OAuthClients };

function resolveConnectorKeyRing(source: { CONNECTOR_KEY_RING?: string | undefined }): KeyRing | null {
  const raw = source.CONNECTOR_KEY_RING?.trim();
  return raw ? parseKeyRing(raw) : null;
}

/**
 * What to log at boot when connectors are on and there is no ring, or null when there is nothing
 * to say. Returned rather than logged because this package is a leaf: it has no logger, and
 * giving it one would make every consumer depend on ours.
 */
export function connectorKeyRingWarning(environment: {
  CONTROL_HUB_FLAGS: string;
  connectorKeyRing: KeyRing | null;
}): string | null {
  if (environment.connectorKeyRing) return null;
  if (!isFeatureEnabled(parseFeatureFlags(environment.CONTROL_HUB_FLAGS), "connectors")) return null;
  return "connectors are enabled but CONNECTOR_KEY_RING is unset: credentials cannot be stored or read";
}

export function parseApiEnvironment(source: NodeJS.ProcessEnv): ApiEnvironment {
  const {
    CONNECTOR_KEY_RING,
    GOOGLE_OAUTH_CLIENT_ID,
    GOOGLE_OAUTH_CLIENT_SECRET: _googleSecret,
    MICROSOFT_OAUTH_CLIENT_ID,
    MICROSOFT_OAUTH_CLIENT_SECRET: _microsoftSecret,
    ...environment
  } = apiEnvironmentSchema.parse(source);
  return {
    ...environment,
    connectorKeyRing: resolveConnectorKeyRing({ CONNECTOR_KEY_RING }),
    connectorEgressAllowlist: parseEgressAllowlist(environment.CONNECTOR_INTERNAL_ALLOWLIST),
    oauthClientIds: {
      ...(GOOGLE_OAUTH_CLIENT_ID ? { google: GOOGLE_OAUTH_CLIENT_ID } : {}),
      ...(MICROSOFT_OAUTH_CLIENT_ID ? { microsoft: MICROSOFT_OAUTH_CLIENT_ID } : {})
    }
  };
}

export function parseWorkerEnvironment(source: NodeJS.ProcessEnv): WorkerEnvironment {
  const {
    CONNECTOR_KEY_RING,
    GOOGLE_OAUTH_CLIENT_ID,
    GOOGLE_OAUTH_CLIENT_SECRET,
    MICROSOFT_OAUTH_CLIENT_ID,
    MICROSOFT_OAUTH_CLIENT_SECRET,
    ...environment
  } = workerEnvironmentSchema.parse(source);
  if (Boolean(GOOGLE_OAUTH_CLIENT_ID) !== Boolean(GOOGLE_OAUTH_CLIENT_SECRET)) {
    throw new Error("GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET must be configured together");
  }
  if (Boolean(MICROSOFT_OAUTH_CLIENT_ID) !== Boolean(MICROSOFT_OAUTH_CLIENT_SECRET)) {
    throw new Error("MICROSOFT_OAUTH_CLIENT_ID and MICROSOFT_OAUTH_CLIENT_SECRET must be configured together");
  }
  return {
    ...environment,
    connectorKeyRing: resolveConnectorKeyRing({ CONNECTOR_KEY_RING }),
    connectorEgressAllowlist: parseEgressAllowlist(environment.CONNECTOR_INTERNAL_ALLOWLIST),
    oauthClients: {
      ...(GOOGLE_OAUTH_CLIENT_ID && GOOGLE_OAUTH_CLIENT_SECRET
        ? { google: { clientId: GOOGLE_OAUTH_CLIENT_ID, clientSecret: GOOGLE_OAUTH_CLIENT_SECRET } }
        : {}),
      ...(MICROSOFT_OAUTH_CLIENT_ID && MICROSOFT_OAUTH_CLIENT_SECRET
        ? { microsoft: { clientId: MICROSOFT_OAUTH_CLIENT_ID, clientSecret: MICROSOFT_OAUTH_CLIENT_SECRET } }
        : {})
    }
  };
}

export * from "./egress-allowlist.js";
export * from "./flags.js";
export * from "./key-ring.js";

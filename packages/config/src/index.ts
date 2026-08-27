import { z } from "zod";
import { parseEgressAllowlist, type AllowedDestination } from "./egress-allowlist.js";
import { isFeatureEnabled, parseFeatureFlags } from "./flags.js";
import { parseKeyRing, type KeyRing } from "./key-ring.js";
import { resolveSecretFiles } from "./secret-file.js";

const apiSecretVariables = [
  "DATABASE_URL",
  "REDIS_URL",
  "BETTER_AUTH_SECRET",
  "CONNECTOR_KEY_RING",
  "SMTP_PASSWORD"
] as const;
const workerSecretVariables = [
  ...apiSecretVariables,
  "GOOGLE_OAUTH_CLIENT_SECRET",
  "MICROSOFT_OAUTH_CLIENT_SECRET"
] as const;

/** An optional value where a variable present but empty means the same thing as an absent one. */
const blankAsUnset = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().min(1).optional()
);

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
  // Both or neither, checked below. A relay that wants no credentials -- Mailpit in development,
  // a relay on the same network in production -- leaves both unset and the transport authenticates
  // nothing, which is the only way an unauthenticated relay was ever meant to be configured.
  //
  // Blank counts as unset, and has to: `SMTP_USER=` in a `.env` and an unset variable interpolated
  // by compose both arrive as an empty string, and refusing to boot over one is refusing to boot
  // over a line somebody left in place, which is not what either of them meant.
  SMTP_USER: blankAsUnset,
  SMTP_PASSWORD: blankAsUnset,
  SECRETS_PROVIDER: z.enum(["environment", "runtime_files", "bitwarden"]).default("environment"),
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
  API_HOST: z.string().min(1).default("127.0.0.1"),
  /**
   * The public origin an MCP client reaches this API at, and therefore the OAuth issuer.
   *
   * Neither `APP_ORIGIN` (the web app, a different origin) nor `API_INTERNAL_URL` (reachable only
   * from inside the deployment) can stand in for it. It has to be configured because the
   * alternative is reading the `Host` header, and a token whose audience a caller can choose is
   * exactly the confused-deputy hole the audience exists to close.
   *
   * An origin and nothing more: RFC 8414 section 2 makes the issuer both the place the metadata
   * document is fetched from and the string a client compares against, and a path or a trailing
   * slash makes a comparison that is only ever string equality ambiguous.
   */
  MCP_ISSUER: z
    .url()
    .refine((value) => {
      const url = new URL(value);
      return url.pathname === "/" && url.search === "" && url.hash === "";
    }, "MCP_ISSUER must be a bare origin, with no path, query or fragment")
    .transform((value) => value.replace(/\/$/, ""))
    .optional()
});

export const workerEnvironmentSchema = baseSchema.extend({
  /**
   * Whether this installation may look for a newer version once a day.
   *
   * On by default and switchable off, which is the third of the three conditions
   * `docs/specifications/deployment.md` (D5) attaches to checking at all. It lives on the worker
   * schema alone because the worker is the only process that asks -- the browser never does, and
   * a variable the API also read would suggest otherwise.
   *
   * `docs/runbooks/installation.md` says what the request contains and where it goes, so that
   * turning it off is a decision somebody can make on the facts rather than on suspicion.
   */
  CONTROL_HUB_UPDATE_CHECK: z.stringbool().default(true)
});

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

function hideProperties<T extends object>(target: T, properties: readonly (keyof T)[]): T {
  for (const property of properties) {
    const value = target[property];
    Object.defineProperty(target, property, { configurable: false, enumerable: false, value, writable: false });
  }
  return target;
}

function oauthClient(clientId: string, clientSecret: string): { clientId: string; clientSecret: string } {
  return hideProperties({ clientId, clientSecret }, ["clientSecret"]);
}

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

/**
 * What to log at boot when MCP is on and nobody said what this server is called.
 *
 * Returned rather than logged for the same reason as the key ring above: this package is a leaf
 * and has no logger. And it warns rather than throwing, for the same reason too -- taking the
 * whole API down over one optional capability is a worse failure than not declaring its routes.
 */
export function mcpIssuerWarning(environment: {
  CONTROL_HUB_FLAGS: string;
  MCP_ISSUER?: string | undefined;
}): string | null {
  if (environment.MCP_ISSUER) return null;
  if (!isFeatureEnabled(parseFeatureFlags(environment.CONTROL_HUB_FLAGS), "mcp")) return null;
  return "mcp is enabled but MCP_ISSUER is unset: the MCP routes are not declared";
}

export function parseApiEnvironment(source: NodeJS.ProcessEnv): ApiEnvironment {
  const {
    CONNECTOR_KEY_RING,
    GOOGLE_OAUTH_CLIENT_ID,
    GOOGLE_OAUTH_CLIENT_SECRET: _googleSecret,
    MICROSOFT_OAUTH_CLIENT_ID,
    MICROSOFT_OAUTH_CLIENT_SECRET: _microsoftSecret,
    ...environment
  } = apiEnvironmentSchema.parse(resolveSecretFiles(source, apiSecretVariables, { environment: source.NODE_ENV }));
  if (Boolean(environment.SMTP_USER) !== Boolean(environment.SMTP_PASSWORD)) {
    throw new Error("SMTP_USER and SMTP_PASSWORD must be configured together");
  }
  return hideProperties(
    {
      ...environment,
      connectorKeyRing: resolveConnectorKeyRing({ CONNECTOR_KEY_RING }),
      connectorEgressAllowlist: parseEgressAllowlist(environment.CONNECTOR_INTERNAL_ALLOWLIST),
      oauthClientIds: {
        ...(GOOGLE_OAUTH_CLIENT_ID ? { google: GOOGLE_OAUTH_CLIENT_ID } : {}),
        ...(MICROSOFT_OAUTH_CLIENT_ID ? { microsoft: MICROSOFT_OAUTH_CLIENT_ID } : {})
      }
    },
    ["DATABASE_URL", "REDIS_URL", "BETTER_AUTH_SECRET", "SMTP_PASSWORD"]
  );
}

export function parseWorkerEnvironment(source: NodeJS.ProcessEnv): WorkerEnvironment {
  const {
    CONNECTOR_KEY_RING,
    GOOGLE_OAUTH_CLIENT_ID,
    GOOGLE_OAUTH_CLIENT_SECRET,
    MICROSOFT_OAUTH_CLIENT_ID,
    MICROSOFT_OAUTH_CLIENT_SECRET,
    ...environment
  } = workerEnvironmentSchema.parse(
    resolveSecretFiles(source, workerSecretVariables, { environment: source.NODE_ENV })
  );
  if (Boolean(GOOGLE_OAUTH_CLIENT_ID) !== Boolean(GOOGLE_OAUTH_CLIENT_SECRET)) {
    throw new Error("GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET must be configured together");
  }
  if (Boolean(MICROSOFT_OAUTH_CLIENT_ID) !== Boolean(MICROSOFT_OAUTH_CLIENT_SECRET)) {
    throw new Error("MICROSOFT_OAUTH_CLIENT_ID and MICROSOFT_OAUTH_CLIENT_SECRET must be configured together");
  }
  return hideProperties(
    {
      ...environment,
      connectorKeyRing: resolveConnectorKeyRing({ CONNECTOR_KEY_RING }),
      connectorEgressAllowlist: parseEgressAllowlist(environment.CONNECTOR_INTERNAL_ALLOWLIST),
      oauthClients: {
        ...(GOOGLE_OAUTH_CLIENT_ID && GOOGLE_OAUTH_CLIENT_SECRET
          ? { google: oauthClient(GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET) }
          : {}),
        ...(MICROSOFT_OAUTH_CLIENT_ID && MICROSOFT_OAUTH_CLIENT_SECRET
          ? { microsoft: oauthClient(MICROSOFT_OAUTH_CLIENT_ID, MICROSOFT_OAUTH_CLIENT_SECRET) }
          : {})
      }
    },
    ["DATABASE_URL", "REDIS_URL", "BETTER_AUTH_SECRET"]
  );
}

export * from "./egress-allowlist.js";
export * from "./flags.js";
export * from "./key-ring.js";
export * from "./secret-file.js";

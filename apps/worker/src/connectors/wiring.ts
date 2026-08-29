import type { ConnectorRepository, SupportMailboxIngestor } from "@control-hub/application";
import { ConnectorSecretReader } from "@control-hub/application";
import type { AllowedDestination, KeyRing } from "@control-hub/config";
import { urlToAllowedDestination } from "@control-hub/config";
import { connectorRegistry } from "@control-hub/connectors";
import type { HttpPort, SecretsPort } from "@control-hub/connectors";
import { CredentialVault } from "@control-hub/persistence";
import type { UsageRecordIngestor } from "../usage/ingestion.js";
import type { CircuitStore } from "./circuit-store.js";
import { createGuardedHttp } from "./guarded-fetch.js";
import { createImapMailbox } from "./imap-mailbox.js";
import type { OAuthTokenProvider } from "./oauth-token-provider.js";
import { ConnectorRuntime, type RuntimeLogger } from "./runtime.js";

/**
 * Assembling the connector runtime, in one place so the shape of the dependency graph is visible
 * rather than spread across the file that starts a worker.
 *
 * Returns null when this installation has no key ring. That is not a degraded mode with a broken
 * runtime in it: the object is simply absent, so a connector job finds nothing to run and says so
 * once, instead of failing halfway through with a credential it could not open.
 */

export type ConnectorWiringOptions = {
  repository: ConnectorRepository;
  keyRing: KeyRing | null;
  allowlist: readonly AllowedDestination[];
  /** Shared with the schedule reconciler, which asks the same breaker whether to slow a poll. */
  circuits: CircuitStore;
  logger: RuntimeLogger;
  usage?: UsageRecordIngestor;
  mail?: SupportMailboxIngestor;
  oauthTokens?: OAuthTokenProvider;
};

export function createConnectorRuntime(options: ConnectorWiringOptions): ConnectorRuntime | null {
  if (!options.keyRing) return null;

  const secrets = new ConnectorSecretReader(options.repository, new CredentialVault(options.keyRing));
  const runtimeSecrets = options.oauthTokens
    ? {
        open: (context: Parameters<ConnectorSecretReader["open"]>[0], instanceId: string, kind: string) =>
          kind === "oauth_access_token"
            ? options.oauthTokens!.accessToken(context, instanceId)
            : secrets.open(context, instanceId, kind)
      }
    : secrets;

  return new ConnectorRuntime(connectorRegistry, {
    repository: options.repository,
    secrets: runtimeSecrets,
    circuits: options.circuits,
    logger: options.logger,
    ...(options.usage ? { usage: options.usage } : {}),
    ...(options.mail ? { mail: options.mail } : {}),
    http: (instance) => httpFor(instance, options.allowlist),
    mailbox: (instance, instanceSecrets) => mailboxFor(instance, instanceSecrets, options.allowlist)
  });
}

async function mailboxFor(
  instance: { connectorType: string; config: unknown },
  secrets: SecretsPort,
  allowlist: readonly AllowedDestination[]
) {
  if (instance.connectorType !== "imap" || typeof instance.config !== "object" || instance.config === null) {
    throw new Error("MAILBOX_NOT_DECLARED");
  }
  const mailboxUrl = (instance.config as { mailboxUrl?: unknown }).mailboxUrl;
  if (typeof mailboxUrl !== "string") throw new Error("MAILBOX_CONFIG_INVALID");
  return createImapMailbox({ mailboxUrl, secrets, allowlist });
}

/**
 * The client one instance is allowed to use.
 *
 * A connector whose manifest declares no egress gets a port that refuses everything rather than
 * no port at all: the contract says `http` is always there, and a handler that calls it despite
 * having declared it would not is a bug we want to see as a refusal, not as a crash.
 *
 * For connectors with `destination: "operator_allowlist"`, the instance's configured `baseUrl`
 * is automatically added to the effective allowlist. This means operators do not have to manually
 * edit `CONNECTOR_INTERNAL_ALLOWLIST` for every instance they configure through the panel. The
 * security model is preserved: only URLs that have been explicitly configured by an admin/owner
 * are allowed, and the SSRF protection still applies to any other address.
 */
function httpFor(
  instance: { connectorType: string; config: unknown },
  allowlist: readonly AllowedDestination[]
): HttpPort {
  const connector = connectorRegistry.find(instance.connectorType);
  const policy = connector?.capabilities.egress;
  if (!policy) return { send: () => Promise.reject(new Error("EGRESS_NOT_DECLARED")) };

  const baseUrl = baseUrlOf(instance.config);

  // For operator_allowlist connectors, add the instance's baseUrl to the effective allowlist.
  // This allows internal services (n8n, Prometheus, etc.) to be reached without manual .env edits.
  const effectiveAllowlist =
    policy.destination === "operator_allowlist" && baseUrl ? addBaseUrlToAllowlist(allowlist, baseUrl) : allowlist;

  return createGuardedHttp({ policy, baseUrl, allowlist: effectiveAllowlist });
}

/**
 * Adds a base URL to the allowlist if it is not already present.
 *
 * Returns the original allowlist if the URL is invalid or already present.
 */
function addBaseUrlToAllowlist(
  allowlist: readonly AllowedDestination[],
  baseUrl: string
): readonly AllowedDestination[] {
  const destination = urlToAllowedDestination(baseUrl);
  if (!destination) return allowlist;

  // Check if already present
  const alreadyPresent = allowlist.some(
    (entry) =>
      entry.scheme === destination.scheme && entry.hostname === destination.hostname && entry.port === destination.port
  );

  return alreadyPresent ? allowlist : [...allowlist, destination];
}

/**
 * The base URL an instance was configured with, when it has one.
 *
 * Read here and not inside the guard because the guard must not know what a configuration looks
 * like: it is handed a base and enforces it. A connector confined to its configured base with no
 * base in its configuration can reach nothing, which is the right answer — the alternative would
 * be to fall back to "anywhere public".
 */
function baseUrlOf(config: unknown): string | null {
  if (typeof config !== "object" || config === null) return null;
  const value = (config as { baseUrl?: unknown }).baseUrl;
  return typeof value === "string" && value.length > 0 ? value : null;
}

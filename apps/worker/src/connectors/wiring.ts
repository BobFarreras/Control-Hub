import type { ConnectorRepository } from "@control-hub/application";
import { ConnectorSecretReader } from "@control-hub/application";
import type { AllowedDestination, KeyRing } from "@control-hub/config";
import { connectorRegistry } from "@control-hub/connectors";
import type { HttpPort } from "@control-hub/connectors";
import { CredentialVault } from "@control-hub/persistence";
import type { UsageRecordIngestor } from "../usage/ingestion.js";
import type { CircuitStore } from "./circuit-store.js";
import { createGuardedHttp } from "./guarded-fetch.js";
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
};

export function createConnectorRuntime(options: ConnectorWiringOptions): ConnectorRuntime | null {
  if (!options.keyRing) return null;

  const secrets = new ConnectorSecretReader(options.repository, new CredentialVault(options.keyRing));

  return new ConnectorRuntime(connectorRegistry, {
    repository: options.repository,
    secrets,
    circuits: options.circuits,
    logger: options.logger,
    ...(options.usage ? { usage: options.usage } : {}),
    http: (instance) => httpFor(instance, options.allowlist)
  });
}

/**
 * The client one instance is allowed to use.
 *
 * A connector whose manifest declares no egress gets a port that refuses everything rather than
 * no port at all: the contract says `http` is always there, and a handler that calls it despite
 * having declared it would not is a bug we want to see as a refusal, not as a crash.
 */
function httpFor(
  instance: { connectorType: string; config: unknown },
  allowlist: readonly AllowedDestination[]
): HttpPort {
  const connector = connectorRegistry.find(instance.connectorType);
  const policy = connector?.capabilities.egress;
  if (!policy) return { send: () => Promise.reject(new Error("EGRESS_NOT_DECLARED")) };

  return createGuardedHttp({ policy, baseUrl: baseUrlOf(instance.config), allowlist });
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

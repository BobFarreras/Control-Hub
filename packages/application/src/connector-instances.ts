import type { CapabilityManifest, ConfigField, ConfigIssue, RegisteredConnector } from "@control-hub/connectors";
import { hasPermission, type TenantContext } from "@control-hub/domain";
import type {
  ConfigValue,
  ConnectorConfig,
  ConnectorInstanceRecord,
  ConnectorRepository,
  DeletedInstanceSummary,
  RunPage
} from "./connectors.js";

/**
 * What somebody with a session may do to an integration.
 *
 * Every rule an operator can break lives here rather than in the route: the API decides the
 * status code and the audit line, and this decides whether the thing is allowed at all. That is
 * what lets acceptance criteria 2 and 7 — invalid configuration refused, `Administrator` refused
 * on anything that changes something — be closed by tests that never open a socket.
 *
 * Note what this service cannot do: there is no method here that returns a secret. Reading one is
 * `ConnectorSecretReader`, which only the worker imports.
 *
 * Specification: `docs/specifications/connectors.md`.
 */

export class ConnectorServiceError extends Error {
  constructor(
    public readonly code: string,
    /** Where a configuration failed and why, as a path and a code. Never the value. */
    public readonly issues: readonly ConfigIssue[] = []
  ) {
    super(code);
  }
}

/** What a screen needs to offer a choice of connector. No handlers, no schema internals. */
export type ConnectorCatalogueEntry = {
  type: string;
  contractVersion: number;
  /** What an operator has to fill in, so a screen can draw a form instead of asking for JSON. */
  configFields: readonly ConfigField[];
  credentialKinds: readonly string[];
  capabilities: CapabilityManifest;
};

/**
 * The lookup half of the registry.
 *
 * Declared as a port so the use cases do not depend on which connectors this release happens to
 * ship, and so a test can hand over one connector instead of the catalogue of a whole installation.
 */
export type ConnectorCatalogue = {
  types(): readonly string[];
  find(type: string): RegisteredConnector | null;
};

/**
 * Asking the worker to check an instance.
 *
 * The API does not perform a health check: it queues one and answers `202`. A check that ran
 * inside the request would put a provider's timeout in front of the person waiting for the page,
 * which is the failure the whole runtime of increment 6 exists to avoid.
 */
export type ConnectorHealthCheckQueue = {
  /** Returns the queue's identifier for the request, so the caller can be told what it started. */
  requestHealthCheck(input: {
    tenantId: string;
    instanceId: string;
    /** When present, the same key must not enqueue a second check. */
    idempotencyKey: string | null;
  }): Promise<string>;
};

export type CreateConnectorInstanceInput = {
  connectorType: string;
  name: string;
  config: unknown;
};

const shortestName = 2;
const longestName = 120;

function requireRead(context: TenantContext) {
  if (!hasPermission(context, "integrations:read")) throw new ConnectorServiceError("FORBIDDEN");
}

/**
 * Everything that changes an integration, including disabling one.
 *
 * `Administrator` holds `integrations:read` and not this, which is the owner's decision of
 * 11 August 2026 and the whole of acceptance criterion 7.
 */
function requireManage(context: TenantContext) {
  if (!hasPermission(context, "integrations:manage")) throw new ConnectorServiceError("FORBIDDEN");
}

function normalizedName(value: string): string {
  const name = value.trim();
  if (name.length < shortestName || name.length > longestName) throw new ConnectorServiceError("INVALID_NAME");
  return name;
}

/**
 * Refuses a configuration the connector does not recognise, with a path and a code per problem.
 *
 * The issues travel to the API and from there to a screen, so they must carry no value: a person
 * pasting a token into the wrong field would otherwise see it come back in an error, and it would
 * be in a log by then.
 */
function parseConfig(connector: RegisteredConnector, value: unknown): ConnectorConfig {
  const result = connector.parseConfig(value);
  if (!result.ok) throw new ConnectorServiceError("INVALID_CONFIG", result.issues);
  return asStoredConfig(result.config);
}

/**
 * What goes into `jsonb` has to be JSON.
 *
 * A schema that returns a `Date`, a `Map` or a class instance would compile and then store
 * whatever the driver made of it. This is the check that turns that into a refusal here rather
 * than into a column nobody can read back.
 */
function asStoredConfig(value: unknown): ConnectorConfig {
  if (!isConfigValue(value) || typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ConnectorServiceError("INVALID_CONFIG", [{ path: "", code: "not_a_json_object" }]);
  }
  return value;
}

function isConfigValue(value: unknown): value is ConfigValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isConfigValue);
  if (typeof value !== "object") return false;
  return Object.getPrototypeOf(value) === Object.prototype && Object.values(value).every(isConfigValue);
}

export class ConnectorService {
  constructor(
    private readonly repository: ConnectorRepository,
    private readonly catalogue: ConnectorCatalogue,
    private readonly healthChecks: ConnectorHealthCheckQueue
  ) {}

  /** The connectors this release ships, for a screen that has to offer a choice. */
  catalogueEntries(context: TenantContext): ConnectorCatalogueEntry[] {
    requireRead(context);
    return this.catalogue.types().flatMap((type) => {
      const connector = this.catalogue.find(type);
      return connector
        ? [
            {
              type: connector.type,
              contractVersion: connector.contractVersion,
              configFields: connector.configFields,
              credentialKinds: connector.credentialKinds,
              capabilities: connector.capabilities
            }
          ]
        : [];
    });
  }

  // Async, like every other call that can be refused: a guard that threw synchronously would make
  // one method of this class fail differently from the rest, which is a trap for one caller.
  async list(context: TenantContext): Promise<ConnectorInstanceRecord[]> {
    requireRead(context);
    return this.repository.listInstances(context);
  }

  async get(context: TenantContext, instanceId: string): Promise<ConnectorInstanceRecord> {
    requireRead(context);
    return this.require(context, instanceId);
  }

  async create(context: TenantContext, input: CreateConnectorInstanceInput): Promise<ConnectorInstanceRecord> {
    requireManage(context);
    const name = normalizedName(input.name);
    const connector = this.catalogue.find(input.connectorType.trim());
    if (!connector) throw new ConnectorServiceError("UNKNOWN_CONNECTOR_TYPE");
    return this.repository.createInstance(context, {
      connectorType: connector.type,
      name,
      config: parseConfig(connector, input.config)
    });
  }

  /**
   * Replaces the configuration, revalidated against the schema of the release that is running.
   *
   * The version rises with it, in the repository's own statement, so a run recorded afterwards
   * names the configuration it actually read.
   */
  async updateConfig(context: TenantContext, instanceId: string, config: unknown): Promise<ConnectorInstanceRecord> {
    requireManage(context);
    const instance = await this.require(context, instanceId);
    const connector = this.connectorFor(instance);
    const updated = await this.repository.updateInstanceConfig(context, instanceId, parseConfig(connector, config));
    if (!updated) throw new ConnectorServiceError("INSTANCE_NOT_FOUND");
    return updated;
  }

  /**
   * Enabling revalidates what is already stored.
   *
   * A connector's schema travels with a release, so an instance configured under the previous one
   * may no longer be valid. Finding that out here is a refusal somebody can act on; finding it out
   * in the worker is a run that fails every five minutes for a reason nobody is watching.
   */
  async enable(context: TenantContext, instanceId: string): Promise<ConnectorInstanceRecord> {
    requireManage(context);
    const instance = await this.require(context, instanceId);
    parseConfig(this.connectorFor(instance), instance.config);
    return this.setStatus(context, instanceId, "enabled");
  }

  /**
   * Disabling stops the work and then revokes the credentials, in that order.
   *
   * The other order leaves a window where the instance is still enabled and has nothing to
   * authenticate with, which the provider sees as a burst of unauthorized calls from us.
   */
  async disable(
    context: TenantContext,
    instanceId: string
  ): Promise<{ instance: ConnectorInstanceRecord; revokedCredentials: number }> {
    requireManage(context);
    await this.require(context, instanceId);
    const instance = await this.setStatus(context, instanceId, "disabled");
    const revokedCredentials = await this.repository.revokeCredentials(context, instanceId);
    return { instance, revokedCredentials };
  }

  /**
   * Removes an integration and everything the schema hangs off it.
   *
   * Distinct from disabling, and deliberately so: disabling keeps the configuration, the history
   * and the links while stopping the work, which is what somebody who only wants it to stop
   * actually wants. This is for the other case, and it does not come back.
   *
   * There is no precondition of state. The stopping that `disable` performs — revoking, closing
   * the ingress, ending the schedules — is rows that this removes outright in the same
   * transaction, and the two pieces of state that live outside PostgreSQL heal themselves: the
   * reconciler drops any schedule it no longer wants, and the runtime skips a job whose instance
   * it cannot find. Demanding "disable it first" would be a rule a screen enforces rather than
   * the system, and its predictable outcome is an integration half removed.
   *
   * What it cannot do is revoke the credential at the provider. We forget the envelope; the token
   * stays valid over there until somebody withdraws it, which is the same lesson as the key
   * rotation runbook and which the screen has to say out loud.
   */
  async delete(context: TenantContext, instanceId: string): Promise<DeletedInstanceSummary> {
    requireManage(context);
    const deleted = await this.repository.deleteInstance(context, instanceId);
    if (!deleted) throw new ConnectorServiceError("INSTANCE_NOT_FOUND");
    return deleted;
  }

  /**
   * Queues a health check and returns the queue's identifier for it.
   *
   * Only for an enabled instance: the runtime skips anything else, so a `202` for a disabled one
   * would promise a check that never happens.
   */
  async requestHealthCheck(
    context: TenantContext,
    instanceId: string,
    idempotencyKey: string | null = null
  ): Promise<{ instance: ConnectorInstanceRecord; requestId: string }> {
    requireManage(context);
    const instance = await this.require(context, instanceId);
    if (instance.status !== "enabled") throw new ConnectorServiceError("INSTANCE_NOT_ENABLED");
    const requestId = await this.healthChecks.requestHealthCheck({
      tenantId: context.tenantId,
      instanceId,
      idempotencyKey
    });
    return { instance, requestId };
  }

  async runs(context: TenantContext, instanceId: string, page: number, pageSize: number): Promise<RunPage> {
    requireRead(context);
    await this.require(context, instanceId);
    return this.repository.listRuns(context, instanceId, page, pageSize);
  }

  /**
   * An instance of this tenant, or nothing.
   *
   * The read is already tenant-scoped, so an identifier belonging to somebody else is simply not
   * found here — which is acceptance criterion 6, and the reason no route needs to compare a
   * tenant identifier by hand.
   */
  private async require(context: TenantContext, instanceId: string): Promise<ConnectorInstanceRecord> {
    const instance = await this.repository.getInstance(context, instanceId);
    if (!instance) throw new ConnectorServiceError("INSTANCE_NOT_FOUND");
    return instance;
  }

  private connectorFor(instance: ConnectorInstanceRecord): RegisteredConnector {
    const connector = this.catalogue.find(instance.connectorType);
    // A stored instance of a type this release no longer ships. Refusing is the honest answer:
    // there is no schema to validate against and no handler to run.
    if (!connector) throw new ConnectorServiceError("UNKNOWN_CONNECTOR_TYPE");
    return connector;
  }

  private async setStatus(
    context: TenantContext,
    instanceId: string,
    status: "enabled" | "disabled"
  ): Promise<ConnectorInstanceRecord> {
    const instance = await this.repository.setInstanceStatus(context, instanceId, status);
    if (!instance) throw new ConnectorServiceError("INSTANCE_NOT_FOUND");
    return instance;
  }
}

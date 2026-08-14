import type { ConnectorRepository, ConnectorSecretReader, SyncRunRecord } from "@control-hub/application";
import type { ConnectorContext, HttpPort, RegisteredConnector } from "@control-hub/connectors";
import { connectorHealthOperation } from "@control-hub/contracts/jobs";
import {
  backoffDelayMs,
  defaultBackoff,
  failureCode,
  isTransientFailure,
  redact,
  type BackoffPolicy,
  type ConnectorErrorCode,
  type ConnectorFailureKind,
  type TenantContext
} from "@control-hub/domain";
import type { CircuitStore } from "./circuit-store.js";
import { EgressError } from "./guarded-fetch.js";

/**
 * What happens around a connector call, and never inside one.
 *
 * The order is fixed and each step exists for a reason somebody paid for once: ask the breaker
 * before spending a worker slot, open a run row that a redelivery will find rather than duplicate,
 * run exactly one attempt, and record the outcome even when it is a failure — especially then.
 *
 * There is no sleep here. A transient failure ends the job and asks the queue to bring it back
 * later, because a worker that sleeps through a backoff is a worker slot that a slow provider has
 * taken from every other tenant. That is acceptance criterion 3, and it is a property of this
 * shape rather than of a timeout somewhere.
 *
 * Specification: `docs/specifications/connectors.md`.
 */

export type RunVerdict =
  | { status: "skipped"; reason: "circuit_open" | "instance_unavailable" | "already_attempted" | "already_running" }
  | { status: "succeeded"; runId: string; itemsProcessed: number; cursor: string | null }
  | { status: "retry"; runId: string; errorCode: string; delayMs: number }
  | { status: "failed"; runId: string; errorCode: string }
  | { status: "dead_letter"; runId: string; errorCode: string };

export type RuntimeLogger = {
  info(fields: Record<string, unknown>, message: string): void;
  warn(fields: Record<string, unknown>, message: string): void;
  error(fields: Record<string, unknown>, message: string): void;
};

export type ConnectorRuntimeOptions = {
  repository: ConnectorRepository;
  secrets: ConnectorSecretReader;
  circuits: CircuitStore;
  logger: RuntimeLogger;
  /**
   * Built per instance, because where a connector may connect depends on its manifest and on
   * that instance's own configuration. A single shared client would have to allow the union of
   * every instance's destinations, which is not a guard.
   */
  http: (instance: { id: string; connectorType: string; config: unknown }) => HttpPort;
  backoff?: BackoffPolicy;
  now?: () => Date;
  random?: () => number;
};

export type RunRequest = {
  instanceId: string;
  operation: string;
  jobId: string;
  attempt: number;
  cursor: string | null;
};

/**
 * The operation name reserved for a health check, which is not one a connector declares.
 *
 * It comes from the contracts package because the API enqueues health checks under exactly this
 * name: the two processes have to mean the same thing by it.
 */
export const healthOperation = connectorHealthOperation;

export class ConnectorRuntime {
  private readonly backoff: BackoffPolicy;
  private readonly now: () => Date;
  private readonly random: () => number;

  constructor(
    private readonly registry: { find(type: string): RegisteredConnector | null },
    private readonly options: ConnectorRuntimeOptions
  ) {
    this.backoff = options.backoff ?? defaultBackoff;
    this.now = options.now ?? (() => new Date());
    this.random = options.random ?? Math.random;
  }

  async run(context: TenantContext, request: RunRequest): Promise<RunVerdict> {
    const { repository, circuits } = this.options;

    const instance = await repository.getInstance(context, request.instanceId);
    // A disabled or missing instance is not a failure to record against it: there is nothing to
    // record against. A job for an instance somebody turned off is simply dropped.
    if (!instance || instance.status !== "enabled") return { status: "skipped", reason: "instance_unavailable" };

    const connector = this.registry.find(instance.connectorType);
    if (!connector) return { status: "skipped", reason: "instance_unavailable" };

    if (!(await circuits.allows(context.tenantId, instance.id, request.operation))) {
      this.options.logger.warn(
        { connectorType: instance.connectorType, instanceId: instance.id, operation: request.operation },
        "circuit open, call not attempted"
      );
      return { status: "skipped", reason: "circuit_open" };
    }

    const start = await repository.startRun(context, {
      instanceId: instance.id,
      operation: request.operation,
      jobId: request.jobId,
      attempt: request.attempt,
      configVersion: instance.configVersion
    });
    // A pass that arrives while the previous one is still going stands down, and says so rather
    // than reporting success. The ceiling on a slow instance is one worker slot however often it
    // is scheduled -- otherwise a provider that got slower would take the whole queue.
    if (start.outcome === "already_running") return { status: "skipped", reason: "already_running" };
    // The queue delivers at least once. A row that already exists for this exact attempt means
    // the work was already carried out, or is being carried out right now by somebody else.
    if (start.outcome === "already_attempted") return { status: "skipped", reason: "already_attempted" };
    const run = start.run;

    const secretsSeen = new Set<string>();
    const startedAt = this.now();
    const connectorContext: ConnectorContext<unknown> = {
      instanceId: instance.id,
      config: instance.config,
      http: this.options.http({
        id: instance.id,
        connectorType: instance.connectorType,
        config: instance.config
      }),
      secrets: {
        open: async (kind: string) => {
          const secret = await this.options.secrets.open(context, instance.id, kind);
          if (secret === null) throw new ConnectorRunError("unauthorized", "CREDENTIAL_MISSING");
          // Held for the length of the run so the logger can take it back out of whatever a
          // provider echoes at us. It never leaves this object.
          secretsSeen.add(secret);
          return secret;
        }
      },
      logger: this.redactingLogger(instance, request.operation, secretsSeen),
      clock: { now: () => this.now() }
    };

    // Where the operation got to is the platform's to remember. A job that carried it would be
    // handing a queue payload the authority over a cursor it may have been holding for an hour;
    // one that names it explicitly is replaying on purpose, and that wins.
    const cursor = request.cursor ?? (await this.storedCursor(context, instance.id, request.operation));

    try {
      const result = await this.attempt(context, connector, connectorContext, instance.id, {
        ...request,
        cursor
      });

      await circuits.recordSuccess(context.tenantId, instance.id, request.operation);
      if (request.operation !== healthOperation) {
        await repository.saveOperationState(context, {
          instanceId: instance.id,
          operation: request.operation,
          cursor: result.cursor,
          ranAt: this.now(),
          succeeded: true
        });
      }
      await repository.finishRun(context, run.id, { status: "succeeded", itemsProcessed: result.itemsProcessed });
      this.log(instance, request, run, "succeeded", startedAt, null);
      return { status: "succeeded", runId: run.id, itemsProcessed: result.itemsProcessed, cursor: result.cursor };
    } catch (error) {
      if (request.operation !== healthOperation) {
        // The cursor stays where it was: an attempt that failed advanced nothing. Only
        // `last_run_at` moves, so the history says we tried and the age still says we have not
        // succeeded since.
        await repository.saveOperationState(context, {
          instanceId: instance.id,
          operation: request.operation,
          cursor,
          ranAt: this.now(),
          succeeded: false
        });
      }
      return await this.recordFailure(context, instance, request, run, startedAt, error, secretsSeen);
    }
  }

  /** Null rather than a throw when nothing has run yet: a first pass starts from the beginning. */
  private async storedCursor(context: TenantContext, instanceId: string, operation: string): Promise<string | null> {
    if (operation === healthOperation) return null;
    const state = await this.options.repository.readOperationState(context, instanceId, operation);
    return state?.cursor ?? null;
  }

  /**
   * One attempt, whether it is a health check or real work.
   *
   * A health check is a run like any other, and that is the point: it is recorded, it counts as
   * evidence, and it opens the circuit when it keeps failing. A check that lived outside the run
   * history would let a connector look healthy in one place and broken in another.
   */
  private async attempt(
    context: TenantContext,
    connector: RegisteredConnector,
    connectorContext: ConnectorContext<unknown>,
    instanceId: string,
    request: RunRequest
  ): Promise<{ itemsProcessed: number; cursor: string | null }> {
    if (request.operation !== healthOperation) {
      // The manifest is what says how long the result lives, and `run` already refuses an
      // operation it does not declare -- so this is a contradiction inside the connector, not a
      // caller's mistake, and it fails before any call goes out.
      const declaration = connector.capabilities.operations[request.operation];
      if (!declaration) throw new ConnectorRunError("invalid_response", "OPERATION_NOT_DECLARED");

      const result = await connector.run(request.operation, connectorContext, { cursor: request.cursor });
      // Stored, not counted and dropped. The API makes no outbound call, so a record that is not
      // written here is a record no screen can ever show.
      await this.options.repository.upsertRecords(context, {
        instanceId,
        operation: request.operation,
        shape: declaration.shape,
        records: result.records.map((record) => ({ externalId: record.externalId, data: record.data })),
        seenAt: this.now()
      });
      return { itemsProcessed: result.records.length, cursor: result.cursor };
    }

    const report = await connector.health(connectorContext);
    if (report.status === "failed") throw new ConnectorRunError(report.failure);

    // `unverifiable` is recorded as no evidence rather than as a pass. A connector with nothing
    // it can call is the ordinary inbound-only case, and reporting it healthy would manufacture
    // the very evidence `connectorHealth` refuses to invent.
    await this.options.repository.recordHealth(context, instanceId, {
      status: report.status === "ok" ? "healthy" : "unknown",
      checkedAt: this.now(),
      errorCode: null
    });
    return { itemsProcessed: 0, cursor: null };
  }

  private async recordFailure(
    context: TenantContext,
    instance: { id: string; connectorType: string },
    request: RunRequest,
    run: SyncRunRecord,
    startedAt: Date,
    error: unknown,
    secretsSeen: ReadonlySet<string>
  ): Promise<RunVerdict> {
    const failure = failureKindOf(error);
    const errorCode = errorCodeOf(error, failure);

    const circuit = await this.options.circuits.recordFailure(context.tenantId, instance.id, request.operation);
    const delayMs = isTransientFailure(failure) ? backoffDelayMs(this.backoff, request.attempt, this.random) : null;
    const status = delayMs === null && isTransientFailure(failure) ? "dead_letter" : "failed";

    await this.options.repository.finishRun(context, run.id, { status, errorCode });
    await this.options.repository.recordHealth(context, instance.id, {
      status: "failing",
      checkedAt: this.now(),
      errorCode
    });
    this.log(instance, request, run, status, startedAt, errorCode, redact(messageOf(error), [...secretsSeen]));

    if (circuit.state === "open") {
      this.options.logger.warn(
        { connectorType: instance.connectorType, instanceId: instance.id, operation: request.operation },
        "circuit opened"
      );
    }

    if (delayMs !== null) return { status: "retry", runId: run.id, errorCode, delayMs };
    return status === "dead_letter"
      ? { status: "dead_letter", runId: run.id, errorCode }
      : { status: "failed", runId: run.id, errorCode };
  }

  /**
   * The logger a connector is given, with every secret it opened taken back out.
   *
   * `packages/observability` redacts by key path, which cannot reach a token a provider pasted
   * into the middle of an error message it sent us. That sentence is the most common way a
   * credential reaches a log, and the connector writing the line has no idea it is in there.
   */
  private redactingLogger(
    instance: { id: string; connectorType: string },
    operation: string,
    secretsSeen: ReadonlySet<string>
  ): ConnectorContext<unknown>["logger"] {
    const base = { connectorType: instance.connectorType, instanceId: instance.id, operation };
    const clean = (fields: Readonly<Record<string, unknown>>, message: string) => {
      const secrets = [...secretsSeen];
      const safe: Record<string, unknown> = { ...base };
      for (const [key, value] of Object.entries(fields)) {
        safe[key] = typeof value === "string" ? redact(value, secrets) : value;
      }
      return { fields: safe, message: redact(message, secrets) };
    };
    return {
      info: (fields, message) => {
        const line = clean(fields, message);
        this.options.logger.info(line.fields, line.message);
      },
      warn: (fields, message) => {
        const line = clean(fields, message);
        this.options.logger.warn(line.fields, line.message);
      },
      error: (fields, message) => {
        const line = clean(fields, message);
        this.options.logger.error(line.fields, line.message);
      }
    };
  }

  /** One shape for every run line: no URL, no headers, no payload. */
  private log(
    instance: { id: string; connectorType: string },
    request: RunRequest,
    run: SyncRunRecord,
    status: string,
    startedAt: Date,
    errorCode: string | null,
    detail?: string
  ) {
    const fields = {
      connectorType: instance.connectorType,
      instanceId: instance.id,
      operation: request.operation,
      runId: run.id,
      attempt: request.attempt,
      status,
      latencyMs: this.now().getTime() - startedAt.getTime(),
      errorCode,
      ...(detail === undefined ? {} : { detail })
    };
    if (errorCode) this.options.logger.warn(fields, "connector run failed");
    else this.options.logger.info(fields, "connector run finished");
  }
}

/** A failure a connector reported about the provider, rather than one it suffered itself. */
export class ConnectorRunError extends Error {
  constructor(
    public readonly failure: ConnectorFailureKind,
    public readonly code?: ConnectorErrorCode
  ) {
    super(code ?? failure);
  }
}

/**
 * What kind of failure this was, from the three sources that can produce one: the guard, a
 * connector reporting about the provider, and anything else, which is ours and not transient.
 *
 * Defaulting an unrecognised error to permanent is deliberate. Retrying a bug in our own code
 * five times with backoff turns one broken deploy into a load test against a provider.
 */
function failureKindOf(error: unknown): ConnectorFailureKind {
  if (error instanceof EgressError) return error.failure;
  if (error instanceof ConnectorRunError) return error.failure;
  if (error instanceof Error && error.name === "AbortError") return "timeout";
  return "invalid_response";
}

/**
 * A stable code for the history and the screen. Never the provider's own words: those are
 * attacker-influenced text that would end up in a log, a ticket and a translation key.
 *
 * The return type is the vocabulary rather than `string`, which is what keeps this honest: a new
 * code thrown anywhere upstream has to be declared in `@control-hub/domain` before it compiles,
 * and declaring it is what a test then requires words for in all three languages.
 */
function errorCodeOf(error: unknown, failure: ConnectorFailureKind): ConnectorErrorCode {
  if (error instanceof EgressError) return error.code;
  if (error instanceof ConnectorRunError && error.code) return error.code;
  return failureCode(failure);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

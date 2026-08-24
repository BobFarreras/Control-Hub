import type { ConnectorRepository, ConnectorSecretReader } from "@control-hub/application";
import type { HttpPort, RegisteredConnector } from "@control-hub/connectors";
import type { TenantContext } from "@control-hub/domain";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { CircuitStore, type CircuitClient } from "./circuit-store.js";
import { EgressError } from "./guarded-fetch.js";
import { ConnectorRunError, ConnectorRuntime, healthOperation } from "./runtime.js";

const tenantId = "11111111-1111-4111-8111-111111111111";
const instanceId = "33333333-3333-4333-8333-333333333333";

const context: TenantContext = {
  tenantId,
  membershipId: "m-1",
  userId: "u-1",
  roles: ["technical"],
  permissions: ["integrations:read"],
  mfaEnabled: true
};

/** Only what the runtime touches. Anything else is a test reaching where it should not. */
class FakeRepository {
  status: "draft" | "enabled" | "disabled" | "error" = "enabled";
  connectorType = "demo";
  readonly runs: { id: string; status: string; errorCode: string | null; itemsProcessed: number }[] = [];
  readonly health: { status: string; errorCode: string | null }[] = [];
  startedAttempts = new Set<string>();
  private next = 0;

  getInstance(_context: TenantContext, id: string) {
    if (this.status === "draft" && id === "missing") return Promise.resolve(null);
    return Promise.resolve({
      id,
      connectorType: this.connectorType,
      name: "demo",
      status: this.status,
      config: { baseUrl: "https://provider.test" },
      configVersion: 3,
      healthStatus: "unknown" as const,
      healthCheckedAt: null,
      lastErrorCode: null,
      createdAt: new Date(0),
      updatedAt: new Date(0)
    });
  }

  /** Set by a test that wants the database to report a pass already in flight. */
  running = false;

  startRun(_context: TenantContext, input: { jobId: string; attempt: number }) {
    if (this.running) return Promise.resolve({ outcome: "already_running" as const });

    const key = `${input.jobId}:${input.attempt}`;
    const started = !this.startedAttempts.has(key);
    if (started) {
      this.next += 1;
      this.runs.push({ id: `run-${this.next}`, status: "running", errorCode: null, itemsProcessed: 0 });
      this.startedAttempts.add(key);
    }
    const run = this.runs[this.runs.length - 1]!;
    return Promise.resolve({
      outcome: started ? ("started" as const) : ("already_attempted" as const),
      run: run as never
    });
  }

  finishRun(
    _context: TenantContext,
    runId: string,
    outcome: { status: string; errorCode?: string; itemsProcessed?: number }
  ) {
    const run = this.runs.find((candidate) => candidate.id === runId);
    if (run) {
      run.status = outcome.status;
      run.errorCode = outcome.errorCode ?? null;
      run.itemsProcessed = outcome.itemsProcessed ?? 0;
    }
    return Promise.resolve(null);
  }

  recordHealth(_context: TenantContext, _instanceId: string, outcome: { status: string; errorCode: string | null }) {
    this.health.push({ status: outcome.status, errorCode: outcome.errorCode });
    return Promise.resolve();
  }

  readonly stored: { operation: string; shape: string; externalIds: string[]; seenAt: Date }[] = [];
  readonly state = new Map<string, { cursor: string | null; ranAt: Date; succeeded: boolean }>();

  upsertRecords(
    _context: TenantContext,
    input: { operation: string; shape: string; records: readonly { externalId: string }[]; seenAt: Date }
  ) {
    this.stored.push({
      operation: input.operation,
      shape: input.shape,
      externalIds: input.records.map((record) => record.externalId),
      seenAt: input.seenAt
    });
    return Promise.resolve({ inserted: input.records.length, updated: 0 });
  }

  readOperationState(_context: TenantContext, instanceId: string, operation: string) {
    const found = this.state.get(`${instanceId}:${operation}`);
    return Promise.resolve(
      found ? { instanceId, operation, cursor: found.cursor, lastRunAt: null, lastSuccessAt: null } : null
    );
  }

  saveOperationState(
    _context: TenantContext,
    input: { instanceId: string; operation: string; cursor: string | null; ranAt: Date; succeeded: boolean }
  ) {
    this.state.set(`${input.instanceId}:${input.operation}`, {
      cursor: input.cursor,
      ranAt: input.ranAt,
      succeeded: input.succeeded
    });
    return Promise.resolve();
  }
}

class FakeSecrets {
  secret: string | null = "sk_live_9f2c8ab4";
  open() {
    return Promise.resolve(this.secret);
  }
}

class MemoryValkey implements CircuitClient {
  readonly entries = new Map<string, string>();
  get(key: string) {
    return Promise.resolve(this.entries.get(key) ?? null);
  }
  set(key: string, value: string) {
    this.entries.set(key, value);
    return Promise.resolve("OK");
  }
}

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const http: HttpPort = { send: () => Promise.reject(new Error("no test should reach the network")) };

let repository: FakeRepository;
let secrets: FakeSecrets;
let circuits: CircuitStore;
let connector: {
  run: Mock<RegisteredConnector["run"]>;
  health: Mock<RegisteredConnector["health"]>;
} & Partial<RegisteredConnector>;

const build = (
  overrides: {
    random?: () => number;
    usage?: { ingest: Mock<(context: TenantContext, input: Record<string, unknown>) => Promise<unknown>> };
  } = {}
) =>
  new ConnectorRuntime(
    { find: () => connector as unknown as RegisteredConnector },
    {
      repository: repository as unknown as ConnectorRepository,
      secrets: secrets as unknown as ConnectorSecretReader,
      circuits,
      logger,
      http: () => http,
      backoff: { baseMs: 1_000, maxMs: 60_000, maxAttempts: 3 },
      now: () => new Date("2026-08-11T10:00:00.000Z"),
      random: overrides.random ?? (() => 0.5),
      ...(overrides.usage ? { usage: overrides.usage } : {})
    }
  );

const request = (overrides: Partial<{ jobId: string; attempt: number; operation: string }> = {}) => ({
  instanceId,
  operation: "pull",
  jobId: "job-1",
  attempt: 1,
  cursor: null,
  ...overrides
});

beforeEach(() => {
  vi.clearAllMocks();
  repository = new FakeRepository();
  secrets = new FakeSecrets();
  circuits = new CircuitStore({
    client: new MemoryValkey(),
    policy: { failureThreshold: 2, openMs: 30_000, successThreshold: 1 }
  });
  const records = [
    { externalId: "a", data: {} },
    { externalId: "b", data: {} }
  ];
  connector = {
    capabilities: { egress: null, operations: { pull: { shape: "state" } }, ingress: false },
    run: vi.fn<RegisteredConnector["run"]>().mockResolvedValue({ records, cursor: "next" }),
    health: vi.fn<RegisteredConnector["health"]>().mockResolvedValue({ status: "ok" })
  };
});

describe("a run that works", () => {
  it("records what it processed and hands the cursor back", async () => {
    const verdict = await build().run(context, request());
    expect(verdict).toMatchObject({ status: "succeeded", itemsProcessed: 2, cursor: "next" });
    expect(repository.runs[0]).toMatchObject({ status: "succeeded", itemsProcessed: 2 });
  });

  it("stores what the operation returned, under the shape the manifest declares", async () => {
    await build().run(context, request());
    expect(repository.stored).toEqual([
      {
        operation: "pull",
        shape: "state",
        externalIds: ["a", "b"],
        seenAt: new Date("2026-08-11T10:00:00.000Z")
      }
    ]);
  });

  it("projects usage before declaring the connector run successful", async () => {
    connector.run.mockResolvedValue({
      records: [{ externalId: "usage-1", data: { usage: { sku: "model-a" } } }],
      cursor: "next"
    });
    const usage = { ingest: vi.fn().mockResolvedValue({ inserted: 1 }) };
    await build({ usage }).run(context, request({ operation: "pull" }));
    expect(usage.ingest).toHaveBeenCalledWith(context, {
      instanceId,
      operation: "pull",
      completedAt: new Date("2026-08-11T10:00:00.000Z"),
      records: [{ externalId: "usage-1", data: { usage: { sku: "model-a" } } }]
    });
    expect(repository.runs[0]?.status).toBe("succeeded");
  });

  it("fails the run and leaves the cursor behind when usage projection fails", async () => {
    const usage = { ingest: vi.fn().mockRejectedValue(new Error("USAGE_RECORD_INVALID")) };
    const verdict = await build({ usage }).run(context, request());
    expect(verdict).toMatchObject({ status: "failed", errorCode: "INVALID_RESPONSE" });
    expect(repository.state.get(`${instanceId}:pull`)?.cursor).toBeNull();
  });

  it("keeps the cursor, and hands it back when the next job carries none", async () => {
    const runtime = build();
    await runtime.run(context, request());
    expect(repository.state.get(`${instanceId}:pull`)).toMatchObject({ cursor: "next", succeeded: true });

    await runtime.run(context, request({ jobId: "job-2" }));
    // The scheduler of A3 enqueues a bare job: where an operation got to is the platform's to
    // remember, not something a queue payload should be carrying around for hours.
    expect(connector.run.mock.calls[1]?.[2]).toEqual({ cursor: "next" });
  });

  it("prefers the cursor the job carries, because a replay names its own starting point", async () => {
    const runtime = build();
    await runtime.run(context, request());
    await runtime.run(context, request({ jobId: "job-3" }));
    connector.run.mockClear();
    await runtime.run(context, { ...request({ jobId: "job-4" }), cursor: "from-the-job" });
    expect(connector.run.mock.calls[0]?.[2]).toEqual({ cursor: "from-the-job" });
  });

  it("does not store records for a health check, which fetches nothing", async () => {
    await build().run(context, request({ operation: healthOperation }));
    expect(repository.stored).toEqual([]);
    expect(repository.state.size).toBe(0);
  });

  it("runs the operation against the version of the configuration it read", async () => {
    await build().run(context, request());
    const callContext = connector.run.mock.calls[0]?.[1];
    expect(callContext?.instanceId).toBe(instanceId);
    expect(callContext?.config).toEqual({ baseUrl: "https://provider.test" });
  });
});

describe("a redelivered attempt", () => {
  it("does not run the work a second time", async () => {
    const runtime = build();
    await runtime.run(context, request());
    const second = await runtime.run(context, request());
    expect(second).toEqual({ status: "skipped", reason: "already_attempted" });
    expect(connector.run).toHaveBeenCalledTimes(1);
    expect(repository.runs).toHaveLength(1);
  });

  /**
   * A different pass, not a redelivery of the same one. It arrives because the provider got
   * slower than the cadence, and the right answer is to stand down: two passes of one operation
   * writing the same records at once is the accumulation that takes the whole queue.
   */
  it("stands down when the previous pass of the same operation is still going", async () => {
    const runtime = build();
    repository.running = true;

    const verdict = await runtime.run(context, request({ jobId: "job-later" }));
    expect(verdict).toEqual({ status: "skipped", reason: "already_running" });
    expect(connector.run).not.toHaveBeenCalled();
    // Nothing was recorded against the instance either: standing down is not an outcome to file.
    expect(repository.runs).toHaveLength(0);
  });

  it("treats a genuinely new attempt as new", async () => {
    const runtime = build();
    await runtime.run(context, request());
    await runtime.run(context, request({ attempt: 2 }));
    expect(connector.run).toHaveBeenCalledTimes(2);
  });
});

describe("an instance that should not be called", () => {
  it("is skipped when it is not enabled, and leaves no run behind", async () => {
    repository.status = "disabled";
    expect(await build().run(context, request())).toEqual({ status: "skipped", reason: "instance_unavailable" });
    expect(repository.runs).toHaveLength(0);
    expect(connector.run).not.toHaveBeenCalled();
  });
});

describe("a failure the provider might recover from", () => {
  beforeEach(() => {
    connector.run.mockRejectedValue(new ConnectorRunError("rate_limited"));
  });

  it("asks for a retry with a delay drawn from the domain's backoff", async () => {
    const verdict = await build({ random: () => 0.5 }).run(context, request());
    expect(verdict).toMatchObject({ status: "retry", errorCode: "RATE_LIMITED", delayMs: 500 });
  });

  it("spreads two workers that failed in the same second apart", async () => {
    const first = await build({ random: () => 0.1 }).run(context, request({ jobId: "a" }));
    const second = await build({ random: () => 0.9 }).run(context, request({ jobId: "b" }));
    expect(first).toMatchObject({ status: "retry" });
    expect(second).toMatchObject({ status: "retry" });
    expect((first as { delayMs: number }).delayMs).not.toBe((second as { delayMs: number }).delayMs);
  });

  it("gives up once the attempt budget is spent, and says so in the history", async () => {
    const verdict = await build().run(context, request({ attempt: 4 }));
    expect(verdict).toMatchObject({ status: "dead_letter", errorCode: "RATE_LIMITED" });
    expect(repository.runs[0]).toMatchObject({ status: "dead_letter", errorCode: "RATE_LIMITED" });
  });

  it("never sleeps: the verdict comes back at once", async () => {
    const before = Date.now();
    await build().run(context, request());
    expect(Date.now() - before).toBeLessThan(200);
  });
});

describe("what a failed operation leaves behind", () => {
  it("records the attempt without claiming the operation succeeded", async () => {
    connector.run.mockRejectedValue(new ConnectorRunError("server_error"));
    await build().run(context, request());
    // `succeeded: false` is what stops `last_success_at` from moving. A connector broken since
    // yesterday must not read as answered a moment ago on the screen.
    expect(repository.state.get(`${instanceId}:pull`)).toMatchObject({ succeeded: false, cursor: null });
    expect(repository.stored).toEqual([]);
  });
});

describe("a failure that will not get better", () => {
  it("is not retried, whatever the attempt number", async () => {
    connector.run.mockRejectedValue(new EgressError("ADDRESS_NOT_ROUTABLE", "blocked_destination"));
    const verdict = await build().run(context, request());
    expect(verdict).toMatchObject({ status: "failed", errorCode: "ADDRESS_NOT_ROUTABLE" });
    expect(repository.health.at(-1)).toEqual({ status: "failing", errorCode: "ADDRESS_NOT_ROUTABLE" });
  });

  it("treats an error nobody classified as permanent rather than retrying our own bug", async () => {
    connector.run.mockRejectedValue(new TypeError("cannot read properties of undefined"));
    expect(await build().run(context, request())).toMatchObject({ status: "failed", errorCode: "INVALID_RESPONSE" });
  });

  it("says plainly when the credential is not there", async () => {
    secrets.secret = null;
    connector.run.mockImplementation(async (_operation, callContext) => {
      await callContext.secrets.open("api_key");
      return { records: [], cursor: null };
    });
    expect(await build().run(context, request())).toMatchObject({ status: "failed", errorCode: "CREDENTIAL_MISSING" });
  });
});

describe("the circuit breaker", () => {
  it("stops calling a provider that keeps failing, without spending a worker slot", async () => {
    connector.run.mockRejectedValue(new ConnectorRunError("server_error"));
    const runtime = build();
    await runtime.run(context, request({ jobId: "a" }));
    await runtime.run(context, request({ jobId: "b" }));

    connector.run.mockClear();
    const verdict = await runtime.run(context, request({ jobId: "c" }));
    expect(verdict).toEqual({ status: "skipped", reason: "circuit_open" });
    expect(connector.run).not.toHaveBeenCalled();
    // Nothing was attempted, so nothing is recorded as an attempt either.
    expect(repository.runs).toHaveLength(2);
  });

  it("closes again after a success", async () => {
    connector.run.mockRejectedValueOnce(new ConnectorRunError("server_error"));
    const runtime = build();
    await runtime.run(context, request({ jobId: "a" }));
    await runtime.run(context, request({ jobId: "b" }));
    expect(await runtime.run(context, request({ jobId: "c" }))).toMatchObject({ status: "succeeded" });
  });
});

describe("a health check", () => {
  it("is recorded as a run and as a health reading", async () => {
    const verdict = await build().run(context, request({ operation: healthOperation }));
    expect(verdict).toMatchObject({ status: "succeeded" });
    expect(repository.health.at(-1)).toEqual({ status: "healthy", errorCode: null });
  });

  it("records nothing green for a connector with nothing it can call", async () => {
    connector.health.mockResolvedValue({ status: "unverifiable" });
    await build().run(context, request({ operation: healthOperation }));
    expect(repository.health.at(-1)).toEqual({ status: "unknown", errorCode: null });
  });

  it("fails the run when the provider says no", async () => {
    connector.health.mockResolvedValue({ status: "failed", failure: "unauthorized" });
    const verdict = await build().run(context, request({ operation: healthOperation }));
    expect(verdict).toMatchObject({ status: "failed", errorCode: "UNAUTHORIZED" });
    expect(repository.health.at(-1)).toEqual({ status: "failing", errorCode: "UNAUTHORIZED" });
  });
});

describe("what reaches a log", () => {
  it("takes a secret back out of a line the connector wrote", async () => {
    connector.run.mockImplementation(async (_operation, callContext) => {
      const secret = await callContext.secrets.open("api_key");
      callContext.logger.info({ echo: `provider said: ${secret}` }, `token ${secret} rejected`);
      return { records: [], cursor: null };
    });

    await build().run(context, request());
    const line = logger.info.mock.calls.find(([fields]) => "echo" in (fields as Record<string, unknown>));
    expect(JSON.stringify(line)).not.toContain("sk_live_9f2c8ab4");
    expect(JSON.stringify(line)).toContain("[REDACTED]");
  });

  it("says which connector and operation, and never a URL", async () => {
    await build().run(context, request());
    const [fields] = logger.info.mock.calls.at(-1) as [Record<string, unknown>, string];
    expect(fields).toMatchObject({ connectorType: "demo", instanceId, operation: "pull", status: "succeeded" });
    expect(JSON.stringify(fields)).not.toContain("https://");
  });
});

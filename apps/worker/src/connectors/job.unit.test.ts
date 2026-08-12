import { DelayedError } from "bullmq";
import { describe, expect, it, vi } from "vitest";
import { connectorJobSchema, jobContext, runConnectorJob, type QueuedJob } from "./job.js";
import type { ConnectorRuntime, RunVerdict } from "./runtime.js";

const payload = {
  tenantId: "11111111-1111-4111-8111-111111111111",
  instanceId: "33333333-3333-4333-8333-333333333333",
  operation: "pull",
  cursor: null
};

const runtimeReturning = (verdict: RunVerdict) =>
  ({ run: vi.fn().mockResolvedValue(verdict) }) as unknown as ConnectorRuntime & { run: ReturnType<typeof vi.fn> };

type MoveToDelayed = (timestamp: number, token?: string) => Promise<void>;
type TestJob = QueuedJob & { moveToDelayed: ReturnType<typeof vi.fn<MoveToDelayed>> };

const queuedJob = (overrides: Partial<Omit<QueuedJob, "moveToDelayed">> = {}): TestJob => ({
  id: "job-7",
  data: payload,
  attemptsMade: 0,
  moveToDelayed: vi.fn<MoveToDelayed>().mockResolvedValue(undefined),
  token: "token-1",
  ...overrides
});

describe("the payload a job may carry", () => {
  it("carries no credential, no configuration and no URL", () => {
    expect(Object.keys(connectorJobSchema.shape).sort()).toEqual(["cursor", "instanceId", "operation", "tenantId"]);
  });

  it("is refused when it is not the shape we declared", async () => {
    const runtime = runtimeReturning({ status: "skipped", reason: "already_attempted" });
    for (const data of [{}, { ...payload, extra: 1 }, { ...payload, tenantId: "not-a-uuid" }]) {
      await expect(runConnectorJob(runtime, queuedJob({ data }))).rejects.toThrow("CONNECTOR_JOB_PAYLOAD_INVALID");
    }
    expect(runtime.run).not.toHaveBeenCalled();
  });
});

describe("the context a job runs under", () => {
  it("can read integrations and nothing else", () => {
    const context = jobContext(payload.tenantId);
    expect(context.permissions).toEqual(["integrations:read"]);
    expect(context.permissions).not.toContain("credentials:rotate");
    expect(context.tenantId).toBe(payload.tenantId);
  });
});

describe("running one job", () => {
  it("numbers the attempt from one, so a run history reads like one", async () => {
    const runtime = runtimeReturning({ status: "succeeded", runId: "r-1", itemsProcessed: 0, cursor: null });
    await runConnectorJob(runtime, queuedJob({ attemptsMade: 2 }));
    expect(runtime.run).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: payload.tenantId }),
      expect.objectContaining({ jobId: "job-7", attempt: 3, operation: "pull" })
    );
  });

  it("puts a transient failure back with the delay the domain computed", async () => {
    const runtime = runtimeReturning({ status: "retry", runId: "r-1", errorCode: "RATE_LIMITED", delayMs: 750 });
    const job = queuedJob();
    const before = Date.now();

    await expect(runConnectorJob(runtime, job)).rejects.toBeInstanceOf(DelayedError);

    const [when, token] = job.moveToDelayed.mock.calls[0] as [number, string];
    expect(when).toBeGreaterThanOrEqual(before + 750);
    expect(token).toBe("token-1");
  });

  it("does not put a permanent failure back at all", async () => {
    const runtime = runtimeReturning({ status: "failed", runId: "r-1", errorCode: "UNAUTHORIZED" });
    const job = queuedJob();
    await expect(runConnectorJob(runtime, job)).resolves.toMatchObject({ status: "failed" });
    expect(job.moveToDelayed).not.toHaveBeenCalled();
  });

  it("does not put a skipped job back either", async () => {
    const runtime = runtimeReturning({ status: "skipped", reason: "circuit_open" });
    const job = queuedJob();
    await expect(runConnectorJob(runtime, job)).resolves.toMatchObject({ status: "skipped" });
    expect(job.moveToDelayed).not.toHaveBeenCalled();
  });
});

import { openCode } from "@control-hub/connectors";
import { describe, expect, it, vi } from "vitest";
import { runConnectorIngressJob } from "./ingress-job.js";

const tenantId = "11111111-1111-4111-8111-111111111111";
const eventId = "22222222-2222-4222-8222-222222222222";
const instanceId = "33333333-3333-4333-8333-333333333333";
const body = JSON.stringify({
  schemaVersion: 1,
  batchId: "batch-1",
  deviceId: "44444444-4444-4444-8444-444444444444",
  events: [
    {
      id: "message-1",
      occurredAt: "2026-08-24T08:00:00.000Z",
      provider: "openai",
      model: "gpt-5",
      projectRef: "a".repeat(64),
      tokens: { input: "12", output: "3", reasoning: "0", cacheRead: "2", cacheWrite: "0" }
    }
  ]
});

function fixture() {
  const repository = {
    getPendingInbox: vi.fn().mockResolvedValue({
      id: eventId,
      tenantId,
      endpointId: "endpoint",
      providerEventId: "batch-1",
      payloadHash: "hash",
      payload: body,
      receivedAt: new Date("2026-08-24T08:01:00.000Z"),
      status: "pending",
      attempts: 0,
      processedAt: null,
      instanceId,
      connectorType: "opencode",
      instanceStatus: "enabled",
      config: {}
    }),
    upsertRecords: vi.fn().mockResolvedValue({ inserted: 1, updated: 0 }),
    finishInboxEvent: vi.fn().mockResolvedValue(undefined),
    recordInboxAttempt: vi.fn().mockResolvedValue(undefined)
  };
  const usage = { ingest: vi.fn().mockResolvedValue({ inserted: 1 }) };
  return { repository, usage };
}

describe("OpenCode ingress job", () => {
  it("projects a queued delivery and only then marks the inbox processed", async () => {
    const { repository, usage } = fixture();
    const result = await runConnectorIngressJob(
      repository,
      { find: (type) => (type === "opencode" ? openCode : null) },
      usage,
      { data: { tenantId, eventId } },
      () => new Date("2026-08-24T08:02:00.000Z")
    );
    expect(result).toEqual({ status: "processed", records: 1 });
    expect(usage.ingest).toHaveBeenCalledOnce();
    expect(repository.finishInboxEvent).toHaveBeenCalledWith(
      expect.anything(),
      eventId,
      expect.objectContaining({ status: "processed" })
    );
    expect(repository.finishInboxEvent).toHaveBeenCalledAfter(usage.ingest);
  });

  it("keeps the inbox pending and records an attempt when projection fails", async () => {
    const { repository, usage } = fixture();
    usage.ingest.mockRejectedValue(new Error("database unavailable"));
    await expect(
      runConnectorIngressJob(repository, { find: () => openCode }, usage, { data: { tenantId, eventId } })
    ).rejects.toThrow("database unavailable");
    expect(repository.recordInboxAttempt).toHaveBeenCalledWith(expect.anything(), eventId);
    expect(repository.finishInboxEvent).not.toHaveBeenCalled();
  });

  it("rejects queue payloads with extra authority", async () => {
    const { repository, usage } = fixture();
    await expect(
      runConnectorIngressJob(repository, { find: () => openCode }, usage, { data: { tenantId, eventId, instanceId } })
    ).rejects.toThrow("CONNECTOR_INGRESS_JOB_PAYLOAD_INVALID");
  });
});

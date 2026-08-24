import type { TenantContext } from "@control-hub/domain";
import { describe, expect, it, vi } from "vitest";
import { UsageIngestionError, UsageRecordIngestor, normalizeUsageRecord } from "./ingestion.js";

const context: TenantContext = {
  tenantId: "11111111-1111-4111-8111-111111111111",
  membershipId: "system",
  userId: "system",
  roles: [],
  permissions: ["integrations:read", "usage:manage"],
  mfaEnabled: true
};

const validRecord = {
  externalId: "provider-event-1",
  data: {
    usage: {
      occurredAt: "2026-08-23T10:00:00.000Z",
      sku: "model-a",
      status: "observed",
      quantities: [
        { unit: "input_token", quantity: "900719925474099312345", qualifier: "input" },
        { unit: "output_token", quantity: 42 }
      ],
      reportedCost: { amountMinor: "17", currency: "EUR" }
    }
  }
};

describe("usage record normalization", () => {
  it("keeps arbitrary-size integers and only the canonical allowlisted fields", () => {
    expect(normalizeUsageRecord(validRecord, "source-a", "pull_usage")).toEqual({
      sourceId: "source-a",
      externalId: "provider-event-1",
      occurredAt: new Date("2026-08-23T10:00:00.000Z"),
      operation: "pull_usage",
      sku: "model-a",
      status: "observed",
      quantities: [
        { unit: "input_token", quantity: 900719925474099312345n, qualifier: "input" },
        { unit: "output_token", quantity: 42n }
      ],
      reportedCost: { amountMinor: 17n, currency: "EUR" }
    });
  });

  it.each([
    [{ ...validRecord, externalId: "" }, "USAGE_EXTERNAL_ID_INVALID"],
    [{ externalId: "x", data: { usage: { ...validRecord.data.usage, quantities: [] } } }, "USAGE_RECORD_INVALID"],
    [
      {
        externalId: "x",
        data: { usage: { ...validRecord.data.usage, quantities: [{ unit: "input_token", quantity: "1.5" }] } }
      },
      "USAGE_RECORD_INVALID"
    ]
  ])("rejects an unusable provider record without echoing its payload", (record, code) => {
    expect(() => normalizeUsageRecord(record, "source-a", "pull_usage")).toThrow(expect.objectContaining({ code }));
  });
});

describe("UsageRecordIngestor", () => {
  it("deduplicates through the service and marks a source complete only after every record", async () => {
    const service = {
      ensureConnectorSource: vi.fn().mockResolvedValue({ id: "source-a" }),
      ingestEvent: vi.fn().mockResolvedValueOnce({ inserted: true }).mockResolvedValueOnce({ inserted: false }),
      completeSource: vi.fn().mockResolvedValue(undefined)
    };
    const ingestor = new UsageRecordIngestor(service);
    const result = await ingestor.ingest(context, {
      instanceId: "instance-a",
      operation: "pull_usage",
      completedAt: new Date("2026-08-23T11:00:00.000Z"),
      records: [validRecord, { ...validRecord, externalId: "provider-event-2" }, { externalId: "infra", data: {} }]
    });
    expect(result).toEqual({ accepted: 2, inserted: 1, duplicates: 1, ignored: 1 });
    expect(service.completeSource).toHaveBeenCalledAfter(service.ingestEvent);
  });

  it("does not claim source completeness after one invalid event", async () => {
    const service = {
      ensureConnectorSource: vi.fn().mockResolvedValue({ id: "source-a" }),
      ingestEvent: vi.fn(),
      completeSource: vi.fn()
    };
    const ingestor = new UsageRecordIngestor(service);
    await expect(
      ingestor.ingest(context, {
        instanceId: "instance-a",
        operation: "pull_usage",
        completedAt: new Date(),
        records: [{ externalId: "bad", data: { usage: { payload: "must-not-appear-in-error" } } }]
      })
    ).rejects.toEqual(expect.objectContaining({ code: "USAGE_RECORD_INVALID", message: "USAGE_RECORD_INVALID" }));
    expect(service.completeSource).not.toHaveBeenCalled();
  });
});

it("uses stable error codes", () => {
  expect(new UsageIngestionError("USAGE_RECORD_INVALID").message).toBe("USAGE_RECORD_INVALID");
});

import type { UsageEventRecord } from "@control-hub/application";
import { describe, expect, it } from "vitest";
import { usageEventResponse } from "./usage.js";

describe("usage response projection", () => {
  it("never serializes provider cost for a volume-only reader", () => {
    const event = {
      id: "event-a",
      sourceId: "source-a",
      externalId: "external-a",
      occurredAt: new Date(),
      operation: "pull_usage",
      sku: "model-a",
      status: "observed",
      quantities: [{ unit: "input_token", quantity: 42n }],
      reportedCost: { amountMinor: 999n, currency: "EUR" },
      createdAt: new Date()
    } satisfies UsageEventRecord;
    const response = usageEventResponse(event);
    expect(JSON.stringify(response)).not.toContain("999");
    expect(JSON.stringify(response)).not.toContain("reportedCost");
    expect(response.quantities).toEqual([{ unit: "input_token", quantity: "42" }]);
  });
});

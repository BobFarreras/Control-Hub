import { describe, expect, it } from "vitest";
import type { UsageCost, UsageEvent } from "./api-types";
import { budgetIssue, quantityTotal, usageCoverage } from "./usage";
const event = (id: string, quantity = "10"): UsageEvent => ({
  id,
  sourceId: "s",
  externalId: id,
  occurredAt: "2026-08-23T00:00:00Z",
  operation: "usage",
  sku: "model",
  status: "observed",
  quantities: [{ unit: "input_token", quantity }],
  createdAt: "2026-08-23T00:00:00Z"
});
const cost = (eventId: string, state: UsageCost["state"]): UsageCost => ({
  id: `${eventId}-${state}`,
  eventId,
  adjustmentId: null,
  state,
  originalCostMinor: null,
  originalCurrency: null,
  reportCostMinor: state === "priced" ? "10" : null,
  reportCurrency: "EUR"
});
describe("usage presentation", () => {
  it("never counts missing valuation as zero-cost coverage", () =>
    expect(usageCoverage([event("a"), event("b"), event("c")], [cost("a", "priced"), cost("b", "partial")])).toEqual({
      total: 3,
      priced: 1,
      partial: 1,
      unpriced: 1,
      percent: 33
    }));
  it("sums decimal integer quantities without losing precision", () =>
    expect(quantityTotal([event("a", "9007199254740993"), event("b", "7")])).toBe(9007199254741000n));
  it("uses the newest valuation when history contains several versions", () =>
    expect(usageCoverage([event("a")], [cost("a", "priced"), cost("a", "unpriced")]).priced).toBe(1));
  it("explains stale coverage with the number of required sources", () =>
    expect(
      budgetIssue({
        budgetId: "b",
        amountMinor: "100",
        currency: "EUR",
        periodStart: "2026-08-01",
        spentMinor: "1",
        hasMissingValuation: false,
        state: "stale",
        observedThrough: "2026-08-23T12:00:00Z",
        sources: [{ required: true, lastCompleteAt: null, maxAgeMinutes: 60 }]
      })
    ).toEqual({ kind: "sources", count: 1 }));
});

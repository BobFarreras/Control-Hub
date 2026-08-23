import type { TenantContext } from "@control-hub/domain";
import { describe, expect, it, vi } from "vitest";
import { buildUsageValuation, UsageService, type UsageRepository, type UsageValuationEvidence } from "./usage.js";

const repository = (): UsageRepository => ({
  ensureConnectorSource: vi.fn(),
  completeSource: vi.fn(),
  ingestEvent: vi.fn(),
  listEvents: vi.fn().mockResolvedValue([]),
  listSources: vi.fn().mockResolvedValue([]),
  listCosts: vi.fn().mockResolvedValue([]),
  createRate: vi.fn(),
  listRates: vi.fn(),
  annulRate: vi.fn(),
  createExchangeRate: vi.fn(),
  listExchangeRates: vi.fn(),
  annulExchangeRate: vi.fn(),
  valuationEvidence: vi.fn(),
  saveValuation: vi.fn(),
  createBudget: vi.fn(),
  listBudgets: vi.fn(),
  budgetEvidence: vi.fn(),
  recordBudgetState: vi.fn(),
  finalizeMonthlySnapshot: vi.fn()
});

const evidence = (overrides: Partial<UsageValuationEvidence> = {}): UsageValuationEvidence => ({
  event: {
    id: "event-a",
    sourceId: "source-a",
    externalId: "external-a",
    occurredAt: new Date("2026-08-23T10:00:00Z"),
    operation: "pull_usage",
    sku: "model-a",
    status: "observed",
    quantities: [{ unit: "input_token", quantity: 1_500n }],
    createdAt: new Date("2026-08-23T10:01:00Z")
  },
  provider: "provider-a",
  quantities: [{ id: "quantity-a", unit: "input_token", qualifier: "input", quantity: 1_500n }],
  rates: [
    {
      id: "rate-a",
      currency: "USD",
      unit: "input_token",
      unitSize: 1_000n,
      effectiveFrom: "2026-01-01T00:00:00Z",
      tiers: [
        { upTo: 1_000n, priceMinor: 10n },
        { upTo: null, priceMinor: 8n }
      ]
    }
  ],
  exchangeRates: [
    {
      id: "fx-a",
      baseCurrency: "USD",
      quoteCurrency: "EUR",
      rateDay: "2026-08-23",
      numerator: 9n,
      denominator: 10n
    }
  ],
  ...overrides
});

const context = (permissions: TenantContext["permissions"]): TenantContext => ({
  tenantId: "tenant-a",
  membershipId: "member-a",
  userId: "user-a",
  roles: ["technical"],
  permissions,
  mfaEnabled: true
});

describe("UsageService permissions", () => {
  it("lets Technical read quantities but denies costs even when an event id is known", async () => {
    const port = repository();
    const service = new UsageService(port);
    await expect(service.listEvents(context(["usage:read"]), { eventId: "known-event" })).resolves.toEqual([]);
    await expect(service.listSources(context(["usage:read"]))).resolves.toEqual([]);
    expect(() => service.listCosts(context(["usage:read"]), { eventId: "known-event" })).toThrow(
      expect.objectContaining({ code: "FORBIDDEN" })
    );
    expect(port.listCosts).not.toHaveBeenCalled();
  });

  it("keeps rate publication and budget management as separate authorities", () => {
    const service = new UsageService(repository());
    expect(() => service.createRate(context(["budgets:manage"]), {} as never)).toThrow(
      expect.objectContaining({ code: "FORBIDDEN" })
    );
    expect(() => service.createBudget(context(["usage:manage"]), {} as never)).toThrow(
      expect.objectContaining({ code: "FORBIDDEN" })
    );
  });
});

describe("usage valuation", () => {
  it("prices progressive lines and freezes the exact FX evidence", () => {
    expect(buildUsageValuation(evidence(), "EUR")).toMatchObject({
      state: "priced",
      originalCostMinor: 14n,
      originalCurrency: "USD",
      reportCostMinor: 13n,
      reportCurrency: "EUR",
      missing: [],
      lines: [{ rateId: "rate-a", exchangeRateId: "fx-a", originalCostMinor: 14n, reportCostMinor: 13n }]
    });
  });

  it("uses provider-reported cost before every tariff", () => {
    const input = evidence({
      event: { ...evidence().event, reportedCost: { amountMinor: 21n, currency: "EUR" } }
    });
    expect(buildUsageValuation(input, "EUR")).toMatchObject({
      state: "priced",
      originalCostMinor: 21n,
      reportCostMinor: 21n,
      lines: []
    });
  });

  it("marks missing rates and historical FX explicitly instead of inventing zero", () => {
    expect(buildUsageValuation(evidence({ rates: [] }), "EUR")).toMatchObject({
      state: "unpriced",
      reportCostMinor: null,
      missing: ["rate"]
    });
    expect(buildUsageValuation(evidence({ exchangeRates: [] }), "EUR")).toMatchObject({
      state: "partial",
      originalCostMinor: 14n,
      reportCostMinor: null,
      missing: ["exchange_rate"]
    });
  });
});

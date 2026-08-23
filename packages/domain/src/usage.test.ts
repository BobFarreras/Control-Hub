import { describe, expect, it } from "vitest";
import {
  convertMinor,
  rateAt,
  resolveUsageCost,
  roundHalfUp,
  tieredCostMinor,
  usageBudgetState,
  UsageError,
  type UsageRate
} from "./usage.js";

const tokenRate = (overrides: Partial<UsageRate> = {}): UsageRate => ({
  currency: "EUR",
  unit: "input_token",
  unitSize: 1_000n,
  effectiveFrom: "2026-01-01",
  tiers: [{ upTo: null, priceMinor: 200n }],
  ...overrides
});

describe("usage money arithmetic", () => {
  it("rounds halves away from zero using integers only", () => {
    expect(roundHalfUp(1n, 2n)).toBe(1n);
    expect(roundHalfUp(4n, 3n)).toBe(1n);
    expect(roundHalfUp(5n, 3n)).toBe(2n);
    expect(roundHalfUp(-1n, 2n)).toBe(-1n);
  });

  it("refuses a zero or negative denominator", () => {
    expect(() => roundHalfUp(1n, 0n)).toThrowError(new UsageError("INVALID_DENOMINATOR"));
    expect(() => roundHalfUp(1n, -2n)).toThrowError(new UsageError("INVALID_DENOMINATOR"));
  });

  it("converts minor units through a reproducible rational rate", () => {
    expect(convertMinor(10_00n, { numerator: 92n, denominator: 100n })).toBe(9_20n);
    expect(convertMinor(1n, { numerator: 1n, denominator: 2n })).toBe(1n);
  });
});

describe("versioned usage rates", () => {
  it("uses the latest rate already effective when usage occurred", () => {
    const rates = [
      tokenRate({ effectiveFrom: "2026-01-01", tiers: [{ upTo: null, priceMinor: 100n }] }),
      tokenRate({ effectiveFrom: "2026-08-01", tiers: [{ upTo: null, priceMinor: 200n }] }),
      tokenRate({ effectiveFrom: "2026-09-01", tiers: [{ upTo: null, priceMinor: 300n }] })
    ];

    expect(rateAt(rates, "2026-08-23T10:00:00.000Z")?.tiers[0]?.priceMinor).toBe(200n);
    expect(rateAt(rates, "2025-12-31T23:59:59.999Z")).toBeNull();
  });

  it("values progressive tiers and rounds once for the whole quantity line", () => {
    const rate = tokenRate({
      tiers: [
        { upTo: 1_000n, priceMinor: 200n },
        { upTo: null, priceMinor: 100n }
      ]
    });

    expect(tieredCostMinor(1_500n, rate)).toBe(250n);
    expect(tieredCostMinor(1n, rate)).toBe(0n);
    expect(tieredCostMinor(3n, tokenRate({ unitSize: 2n, tiers: [{ upTo: null, priceMinor: 1n }] }))).toBe(2n);
  });

  it("refuses negative quantities and malformed tier scales", () => {
    expect(() => tieredCostMinor(-1n, tokenRate())).toThrowError(new UsageError("INVALID_QUANTITY"));
    expect(() =>
      tieredCostMinor(
        10n,
        tokenRate({
          tiers: [
            { upTo: 10n, priceMinor: 1n },
            { upTo: 5n, priceMinor: 1n }
          ]
        })
      )
    ).toThrowError(new UsageError("INVALID_TIERS"));
  });
});

describe("usage cost source priority", () => {
  it("prefers a provider-reported cost even when it is zero", () => {
    expect(
      resolveUsageCost({
        occurredAt: "2026-08-23T10:00:00.000Z",
        unit: "input_token",
        quantity: 1_000n,
        reportedCost: { currency: "USD", amountMinor: 0n },
        rates: [tokenRate()]
      })
    ).toEqual({ source: "reported", cost: { currency: "USD", amountMinor: 0n }, rate: null });
  });

  it("falls back to the rate in force", () => {
    const rate = tokenRate();
    expect(
      resolveUsageCost({
        occurredAt: "2026-08-23T10:00:00.000Z",
        unit: "input_token",
        quantity: 1_500n,
        reportedCost: null,
        rates: [rate]
      })
    ).toEqual({ source: "rated", cost: { currency: "EUR", amountMinor: 300n }, rate });
  });

  it("reports unpriced instead of inventing a zero", () => {
    expect(
      resolveUsageCost({
        occurredAt: "2026-08-23T10:00:00.000Z",
        unit: "output_token",
        quantity: 500n,
        reportedCost: null,
        rates: [tokenRate()]
      })
    ).toEqual({ source: "unpriced", cost: null, rate: null });
  });
});

describe("usage budget state", () => {
  const now = new Date("2026-08-23T12:00:00.000Z");
  const freshRequired = { required: true, lastCompleteAt: new Date("2026-08-23T11:45:00.000Z"), maxAgeMinutes: 30 };

  it("gives stale required evidence precedence over money thresholds", () => {
    expect(
      usageBudgetState({
        spentMinor: 12_000n,
        budgetMinor: 10_000n,
        warningBasisPoints: 8_000,
        now,
        sources: [{ required: true, lastCompleteAt: new Date("2026-08-23T11:00:00.000Z"), maxAgeMinutes: 30 }],
        hasMissingValuation: false
      })
    ).toBe("stale");
  });

  it("marks missing valuation or an optional stale source as partial", () => {
    expect(
      usageBudgetState({
        spentMinor: 12_000n,
        budgetMinor: 10_000n,
        warningBasisPoints: 8_000,
        now,
        sources: [freshRequired],
        hasMissingValuation: true
      })
    ).toBe("partial");

    expect(
      usageBudgetState({
        spentMinor: 1n,
        budgetMinor: 10_000n,
        warningBasisPoints: 8_000,
        now,
        sources: [freshRequired, { required: false, lastCompleteAt: null, maxAgeMinutes: 30 }],
        hasMissingValuation: false
      })
    ).toBe("partial");
  });

  it("distinguishes exceeded, warning and healthy only with complete evidence", () => {
    const input = {
      budgetMinor: 10_000n,
      warningBasisPoints: 8_000,
      now,
      sources: [freshRequired],
      hasMissingValuation: false
    };
    expect(usageBudgetState({ ...input, spentMinor: 10_000n })).toBe("exceeded");
    expect(usageBudgetState({ ...input, spentMinor: 8_000n })).toBe("warning");
    expect(usageBudgetState({ ...input, spentMinor: 7_999n })).toBe("healthy");
  });
});

import { describe, expect, it } from "vitest";
import {
  annualizeMinor,
  isCommercialIntervalAllowed,
  monthlyFromAnnualMinor,
  nextRenewalAt,
  recurringMetrics,
  taxMinor
} from "./index.js";

describe("commerce money", () => {
  it("normalizes supported periods without floating point", () => {
    expect(annualizeMinor(1000, "monthly")).toBe(12000);
    expect(annualizeMinor(3000, "quarterly")).toBe(12000);
    expect(annualizeMinor(6000, "semiannual")).toBe(12000);
    expect(annualizeMinor(12000, "annual")).toBe(12000);
    expect(annualizeMinor(1000, "free")).toBe(0);
    expect(annualizeMinor(1000, "one_time")).toBe(0);
  });

  it("keeps recurring and one-time commercial models coherent", () => {
    expect(isCommercialIntervalAllowed("subscription", "monthly")).toBe(true);
    expect(isCommercialIntervalAllowed("maintenance", "annual")).toBe(true);
    expect(isCommercialIntervalAllowed("one_time", "one_time")).toBe(true);
    expect(isCommercialIntervalAllowed("project_service", "monthly")).toBe(false);
  });

  it("uses deterministic half-up integer rounding", () => {
    expect(monthlyFromAnnualMinor(1000)).toBe(83);
    expect(monthlyFromAnnualMinor(1002)).toBe(84);
    expect(taxMinor(999, 2100)).toBe(210);
  });

  it("calculates quantity, cost and margin from auditable integers", () => {
    expect(recurringMetrics({ amountMinor: 2500, costMinor: 700, interval: "monthly", quantity: 2 })).toEqual({
      mrrMinor: 5000,
      arrMinor: 60000,
      annualCostMinor: 16800,
      annualMarginMinor: 43200
    });
  });

  it("rejects unsafe or negative money", () => {
    expect(() => annualizeMinor(-1, "monthly")).toThrow("INVALID_AMOUNT");
    expect(() => annualizeMinor(Number.MAX_SAFE_INTEGER, "monthly")).toThrow("MONEY_OVERFLOW");
  });

  it("advances renewals in UTC and clamps month boundaries", () => {
    expect(nextRenewalAt(new Date("2028-01-31T10:30:00.000Z"), "monthly")?.toISOString()).toBe(
      "2028-02-29T10:30:00.000Z"
    );
    expect(nextRenewalAt(new Date("2027-08-31T23:00:00.000Z"), "semiannual")?.toISOString()).toBe(
      "2028-02-29T23:00:00.000Z"
    );
    expect(nextRenewalAt(new Date(), "free")).toBeNull();
  });
});

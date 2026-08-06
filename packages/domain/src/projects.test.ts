import { describe, expect, it } from "vitest";
import {
  acceptsTimeEntries,
  canTransitionProject,
  isIsoDate,
  parseDurationMinutes,
  profitability,
  rateOn,
  valueOfMinutes,
  type ValuedTimeEntry
} from "./projects.js";

describe("project status", () => {
  it("walks the delivery path", () => {
    expect(canTransitionProject("draft", "active")).toBe(true);
    expect(canTransitionProject("active", "delivered")).toBe(true);
    expect(canTransitionProject("delivered", "closed")).toBe(true);
  });

  it("lets a closed project be reopened but never a canceled one", () => {
    expect(canTransitionProject("closed", "active")).toBe(true);
    expect(canTransitionProject("canceled", "active")).toBe(false);
    expect(canTransitionProject("canceled", "draft")).toBe(false);
  });

  it("refuses to skip straight from draft to delivered", () => {
    expect(canTransitionProject("draft", "delivered")).toBe(false);
    expect(canTransitionProject("draft", "closed")).toBe(false);
  });

  it("closes the door on hours once a project is closed or canceled", () => {
    expect(acceptsTimeEntries("active")).toBe(true);
    expect(acceptsTimeEntries("on_hold")).toBe(true);
    expect(acceptsTimeEntries("closed")).toBe(false);
    expect(acceptsTimeEntries("canceled")).toBe(false);
  });
});

describe("durations", () => {
  it("reads plain minutes", () => {
    expect(parseDurationMinutes("90")).toBe(90);
    expect(parseDurationMinutes(" 45 ")).toBe(45);
  });

  it("reads written durations", () => {
    expect(parseDurationMinutes("1h 30m")).toBe(90);
    expect(parseDurationMinutes("2h")).toBe(120);
    expect(parseDurationMinutes("1H30")).toBe(90);
    expect(parseDurationMinutes("45m")).toBe(45);
  });

  it("refuses what it cannot read rather than guessing", () => {
    expect(parseDurationMinutes("")).toBeNull();
    expect(parseDurationMinutes("half an hour")).toBeNull();
    expect(parseDurationMinutes("1.5h")).toBeNull();
    // Sixty minutes past an hour is a typo, not twenty-five hours of work.
    expect(parseDurationMinutes("1h 90m")).toBeNull();
  });

  it("keeps an entry inside a single day", () => {
    expect(parseDurationMinutes("1440")).toBe(1440);
    expect(parseDurationMinutes("1441")).toBeNull();
    expect(parseDurationMinutes("0")).toBeNull();
  });
});

describe("iso dates", () => {
  it("accepts real days and rejects impossible ones", () => {
    expect(isIsoDate("2026-08-05")).toBe(true);
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(isIsoDate("2026-13-01")).toBe(false);
    expect(isIsoDate("05/08/2026")).toBe(false);
  });
});

describe("rate resolution", () => {
  const rates = [
    { currency: "EUR", minorPerHour: 3000, effectiveFrom: "2026-01-01" },
    { currency: "EUR", minorPerHour: 4000, effectiveFrom: "2026-07-01" },
    { currency: "EUR", minorPerHour: 5000, effectiveFrom: "2026-09-01" }
  ];

  it("takes the most recent rate published on or before the day worked", () => {
    expect(rateOn(rates, "2026-08-05")?.minorPerHour).toBe(4000);
    expect(rateOn(rates, "2026-07-01")?.minorPerHour).toBe(4000);
    expect(rateOn(rates, "2026-06-30")?.minorPerHour).toBe(3000);
  });

  it("ignores a rate that had not started yet", () => {
    expect(rateOn(rates, "2025-12-31")).toBeNull();
  });

  it("does not let a rate published today reach work done before it", () => {
    const worked = "2026-07-15";
    const before = rateOn(rates, worked)?.minorPerHour;
    const withNewRate = [...rates, { currency: "EUR", minorPerHour: 9900, effectiveFrom: "2026-08-05" }];
    expect(rateOn(withNewRate, worked)?.minorPerHour).toBe(before);
  });
});

describe("valueOfMinutes", () => {
  it("prices whole hours exactly", () => {
    expect(valueOfMinutes(60, 4500)).toBe(4500);
    expect(valueOfMinutes(90, 4500)).toBe(6750);
  });

  it("rounds halves up", () => {
    // 1 minute at 30.00/h is 0.50 minor units, which becomes 1 rather than 0.
    expect(valueOfMinutes(1, 30)).toBe(1);
    expect(valueOfMinutes(1, 29)).toBe(0);
    expect(valueOfMinutes(7, 1000)).toBe(117);
  });

  it("refuses nonsense instead of returning it", () => {
    expect(() => valueOfMinutes(-1, 100)).toThrow("INVALID_MINUTES");
    expect(() => valueOfMinutes(60, -1)).toThrow("INVALID_RATE");
    expect(() => valueOfMinutes(1440, Number.MAX_SAFE_INTEGER)).toThrow("MONEY_OVERFLOW");
  });
});

describe("profitability", () => {
  const entry = (over: Partial<ValuedTimeEntry> = {}): ValuedTimeEntry => ({
    minutes: 60,
    billable: true,
    cost: { currency: "EUR", minorPerHour: 2000 },
    revenue: { currency: "EUR", minorPerHour: 6000 },
    ...over
  });

  it("adds up hours, revenue and margin", () => {
    const result = profitability([entry(), entry({ minutes: 30 })]);
    expect(result.minutes).toBe(90);
    expect(result.billableMinutes).toBe(90);
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]).toMatchObject({ currency: "EUR", revenueMinor: 9000, costMinor: 3000, marginMinor: 6000 });
  });

  it("counts non-billable work as cost without revenue", () => {
    const result = profitability([entry({ billable: false })]);
    expect(result.billableMinutes).toBe(0);
    expect(result.lines[0]).toMatchObject({ revenueMinor: 0, costMinor: 2000, marginMinor: -2000 });
    // No rate is missing: work nobody is charged for has no price to look up.
    expect(result.entriesWithoutBillingRate).toBe(0);
  });

  it("never mixes currencies in one amount", () => {
    const result = profitability([entry(), entry({ revenue: { currency: "USD", minorPerHour: 7000 } })]);
    expect(result.lines.map((line) => line.currency)).toEqual(["EUR", "USD"]);
    expect(result.lines.find((line) => line.currency === "USD")).toMatchObject({ revenueMinor: 7000, costMinor: 0 });
    // The hours are counted once, at the top, not split between the two lines.
    expect(result.minutes).toBe(120);
  });

  it("reports a missing rate as a gap rather than as zero", () => {
    const result = profitability([entry({ cost: null }), entry({ revenue: null })]);
    expect(result.entriesWithoutCostRate).toBe(1);
    expect(result.entriesWithoutBillingRate).toBe(1);
    expect(result.lines[0]).toMatchObject({ revenueMinor: 6000, costMinor: 2000 });
  });

  it("sums rounded lines so a total reconciles line by line", () => {
    const seven = entry({ minutes: 7, cost: { currency: "EUR", minorPerHour: 1000 }, revenue: null });
    const result = profitability([seven, seven, seven]);
    expect(result.lines[0]!.costMinor).toBe(valueOfMinutes(7, 1000) * 3);
    // And not the rounding of the whole: 21 minutes at 10.00/h would be 350, not 351.
    expect(result.lines[0]!.costMinor).toBe(351);
  });

  it("returns no lines at all when there is nothing logged", () => {
    expect(profitability([])).toMatchObject({ minutes: 0, lines: [] });
  });
});

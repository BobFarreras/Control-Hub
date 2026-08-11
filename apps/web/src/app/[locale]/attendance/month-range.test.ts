import { describe, expect, it } from "vitest";
import { monthRange, shiftMonth } from "./month-range";

describe("attendance month range", () => {
  it.each([
    ["2026-01", "2026-01-01", "2026-01-31"],
    ["2026-02", "2026-02-01", "2026-02-28"],
    ["2028-02", "2028-02-01", "2028-02-29"],
    ["2026-08", "2026-08-01", "2026-08-31"],
    ["2026-11", "2026-11-01", "2026-11-30"]
  ])("uses the whole selected month for %s", (month, from, to) => {
    expect(monthRange(month)).toEqual({ month, from, to });
  });

  it("crosses year boundaries without using the local time zone", () => {
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
  });
});

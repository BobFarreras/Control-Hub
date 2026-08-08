import { describe, expect, it } from "vitest";
import { addCalendarDays, localCivilDate, projectDateDefaults } from "./project-date-defaults.js";

describe("project date defaults", () => {
  it("uses the user's civil day instead of converting the form value through UTC", () => {
    const local = new Date(2026, 7, 8, 23, 45);
    expect(localCivilDate(local)).toBe("2026-08-08");
  });

  it("defaults delivery to thirty calendar days after the start", () => {
    expect(projectDateDefaults(new Date(2026, 7, 8, 12))).toEqual({
      startedAt: "2026-08-08",
      dueAt: "2026-09-07"
    });
  });

  it("carries calendar days across month, year and leap-day boundaries", () => {
    expect(addCalendarDays("2026-12-15", 30)).toBe("2027-01-14");
    expect(addCalendarDays("2028-02-01", 30)).toBe("2028-03-02");
  });

  it("rejects values that are not civil dates", () => {
    expect(() => addCalendarDays("08/08/2026", 30)).toThrow("INVALID_CIVIL_DATE");
  });
});

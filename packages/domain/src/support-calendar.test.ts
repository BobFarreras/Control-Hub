import { describe, expect, it } from "vitest";
import { businessMinutesBetween, overlappingWindows, type SupportCalendar } from "./support-calendar.js";

/** The first installation's hours: Monday to Friday, 08:00 to 16:00, Madrid. */
const officeHours: SupportCalendar = {
  timeZone: "Europe/Madrid",
  windows: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, opensAt: "08:00", closesAt: "16:00" })),
  holidays: []
};

const at = (iso: string) => new Date(iso);

describe("business minutes", () => {
  it("counts a stretch inside one working day", () => {
    // 09:00 to 11:30 Madrid, in August that is UTC+2.
    expect(businessMinutesBetween(officeHours, at("2026-08-04T07:00:00Z"), at("2026-08-04T09:30:00Z"))).toBe(150);
  });

  it("ignores the part of an interval that falls outside the window", () => {
    // Opened 06:00 local, before opening; only 08:00 to 09:00 counts.
    expect(businessMinutesBetween(officeHours, at("2026-08-04T04:00:00Z"), at("2026-08-04T07:00:00Z"))).toBe(60);
  });

  it("does not consume the weekend", () => {
    // Friday 15:00 local to Monday 09:00 local: one hour of Friday plus one of Monday.
    expect(businessMinutesBetween(officeHours, at("2026-08-07T13:00:00Z"), at("2026-08-10T07:00:00Z"))).toBe(120);
  });

  it("skips a configured holiday", () => {
    const withHoliday: SupportCalendar = { ...officeHours, holidays: ["2026-08-05"] };
    // Tuesday 15:00 local to Thursday 09:00 local, with Wednesday off.
    expect(businessMinutesBetween(withHoliday, at("2026-08-04T13:00:00Z"), at("2026-08-06T07:00:00Z"))).toBe(120);
  });

  it("adds up several windows on the same day for a split shift", () => {
    const splitShift: SupportCalendar = {
      timeZone: "Europe/Madrid",
      windows: [
        { weekday: 2, opensAt: "09:00", closesAt: "13:00" },
        { weekday: 2, opensAt: "15:00", closesAt: "18:00" }
      ],
      holidays: []
    };
    // The whole Tuesday: four hours plus three, and nothing for the gap between them.
    expect(businessMinutesBetween(splitShift, at("2026-08-04T00:00:00Z"), at("2026-08-04T23:59:00Z"))).toBe(420);
  });

  it("counts nothing when no day is configured", () => {
    const closed: SupportCalendar = { timeZone: "Europe/Madrid", windows: [], holidays: [] };
    expect(businessMinutesBetween(closed, at("2026-08-04T07:00:00Z"), at("2026-08-06T07:00:00Z"))).toBe(0);
  });

  it("handles the spring clock change without inventing or losing an hour", () => {
    // Spain moves to summer time at 02:00 on 2026-03-29, a Sunday, so the working days around
    // it are unaffected: Friday 15:00 to Monday 09:00 is still two hours.
    expect(businessMinutesBetween(officeHours, at("2026-03-27T14:00:00Z"), at("2026-03-30T07:00:00Z"))).toBe(120);
  });

  it("treats a reversed or empty interval as no time at all", () => {
    expect(businessMinutesBetween(officeHours, at("2026-08-04T09:00:00Z"), at("2026-08-04T07:00:00Z"))).toBe(0);
    expect(businessMinutesBetween(officeHours, at("2026-08-04T07:00:00Z"), at("2026-08-04T07:00:00Z"))).toBe(0);
  });

  it("counts a long stretch as whole working days rather than elapsed time", () => {
    // Monday 08:00 to Friday 16:00 local: five days of eight hours.
    expect(businessMinutesBetween(officeHours, at("2026-08-03T06:00:00Z"), at("2026-08-07T14:00:00Z"))).toBe(2400);
  });
});

describe("schedule validation", () => {
  const window = (weekday: number, opensAt: string, closesAt: string) => ({ weekday, opensAt, closesAt });

  it("accepts a split shift with a gap between the windows", () => {
    expect(overlappingWindows([window(2, "09:00", "13:00"), window(2, "15:00", "18:00")])).toEqual([]);
  });

  it("accepts windows that merely touch", () => {
    expect(overlappingWindows([window(2, "09:00", "13:00"), window(2, "13:00", "18:00")])).toEqual([]);
  });

  it("reports two windows that overlap on the same day", () => {
    // Left unchecked the SLA clock counts the overlap twice, so a ticket appears to consume
    // more of its target than the day actually held.
    const overlapping = overlappingWindows([window(2, "09:00", "14:00"), window(2, "13:00", "18:00")]);
    expect(overlapping).toHaveLength(2);
  });

  it("does not confuse the same hours on different days", () => {
    expect(overlappingWindows([window(1, "09:00", "17:00"), window(2, "09:00", "17:00")])).toEqual([]);
  });

  it("reports a window that closes before it opens", () => {
    expect(overlappingWindows([window(3, "16:00", "08:00")])).toHaveLength(1);
  });
});

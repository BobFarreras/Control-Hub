import { describe, expect, it } from "vitest";
import {
  canRecord,
  deriveSessions,
  deriveDayStatus,
  hasBlockOverlap,
  isAbsenceDay,
  isAcceptableEntry,
  isHoliday,
  isNonWorkingDay,
  isVacationDay,
  liveEvents,
  needsReason,
  reconcile,
  stateOf,
  summariseDays,
  totalMinutes,
  type AttendanceAbsence,
  type AttendanceBlock,
  type AttendanceEvent,
  type AttendanceHoliday,
  type AttendanceNonWorkingDay,
  type AttendanceVacation
} from "./attendance.js";

const zone = "Europe/Madrid";
const at = (iso: string) => new Date(iso);

let sequence = 0;
const event = (kind: AttendanceEvent["kind"], iso: string, extra: Partial<AttendanceEvent> = {}): AttendanceEvent => ({
  id: extra.id ?? `e${++sequence}`,
  kind,
  occurredAt: at(iso),
  correctsEventId: null,
  ...extra
});

/** A plain morning: in at 09:00 Madrid, out at 13:00. August is UTC+2. */
const morning = [event("clock_in", "2026-08-04T07:00:00Z"), event("clock_out", "2026-08-04T11:00:00Z")];

/** The installation that records breaks. Off is the default, per the specification. */
const withPauses = { pausesEnabled: true };

describe("what may be recorded next", () => {
  it("refuses a clock out that has no clock in to close", () => {
    expect(canRecord("out", "clock_out")).toBe(false);
    expect(canRecord("out", "clock_in")).toBe(true);
  });

  it("refuses a second clock in while already inside", () => {
    expect(canRecord("in", "clock_in")).toBe(false);
  });

  it("refuses ending a pause that never started, and starting one while out", () => {
    expect(canRecord("in", "pause_end", withPauses)).toBe(false);
    expect(canRecord("out", "pause_start", withPauses)).toBe(false);
    expect(canRecord("in", "pause_start", withPauses)).toBe(true);
    expect(canRecord("paused", "pause_end", withPauses)).toBe(true);
  });

  /**
   * The default, and what most of the first installation's kind of company wants: a continuous
   * shift where nobody deducts breakfast or lunch. With no pause to record, the pause somebody
   * forgets to close cannot happen at all.
   */
  it("refuses a pause at all where pauses are not recorded", () => {
    expect(canRecord("in", "pause_start")).toBe(false);
    expect(canRecord("in", "clock_out")).toBe(true);
  });

  /**
   * Deliberate, and the one worth arguing about: leaving while paused has to end the pause
   * first. The alternative is closing the pause implicitly at the clock out, which makes the
   * day's total depend on a rule nobody reads. Two taps, and the log stays a plain alternation.
   */
  it("refuses clocking out while paused", () => {
    expect(canRecord("paused", "clock_out", withPauses)).toBe(false);
    expect(canRecord("paused", "clock_in", withPauses)).toBe(false);
  });

  it("reads the current state from the last live event", () => {
    expect(stateOf([])).toBe("out");
    expect(stateOf([morning[0]!])).toBe("in");
    expect(stateOf(morning)).toBe("out");
    expect(stateOf([morning[0]!, event("pause_start", "2026-08-04T09:00:00Z")])).toBe("paused");
  });
});

describe("sessions derived from the log", () => {
  it("pairs a clock in with its clock out", () => {
    const [session, ...rest] = deriveSessions(morning, zone);
    expect(rest).toHaveLength(0);
    expect(session!.day).toBe("2026-08-04");
    expect(session!.workedMinutes).toBe(240);
    expect(session!.endedAt).toEqual(at("2026-08-04T11:00:00Z"));
  });

  it("subtracts a closed pause but not an open one", () => {
    const withPause = [
      event("clock_in", "2026-08-04T07:00:00Z"),
      event("pause_start", "2026-08-04T09:00:00Z"),
      event("pause_end", "2026-08-04T09:30:00Z"),
      event("clock_out", "2026-08-04T11:00:00Z")
    ];
    expect(deriveSessions(withPause, zone)[0]!.workedMinutes).toBe(210);
    expect(deriveSessions(withPause, zone)[0]!.pausedMinutes).toBe(30);

    // A pause nobody closed cannot be guessed at, so it does not come off the total. It is
    // visible as an open session instead, which is a thing somebody can go and fix.
    const openPause = [event("clock_in", "2026-08-04T07:00:00Z"), event("pause_start", "2026-08-04T09:00:00Z")];
    const [session] = deriveSessions(openPause, zone);
    expect(session!.workedMinutes).toBeNull();
    expect(session!.pausedMinutes).toBe(0);
  });

  it("counts a session that crosses midnight on the day it started", () => {
    // 23:00 to 01:00 Madrid. Two hours, and both belong to the fourth.
    const nightShift = [event("clock_in", "2026-08-04T21:00:00Z"), event("clock_out", "2026-08-04T23:00:00Z")];
    const [session] = deriveSessions(nightShift, zone);
    expect(session!.day).toBe("2026-08-04");
    expect(session!.workedMinutes).toBe(120);
  });

  /**
   * The night the clocks go back, 03:00 local happens after five real hours, not four. The
   * record is of time actually worked, so it says five: subtracting wall clock readings would
   * quietly shorten one shift a year and lengthen another.
   */
  it("counts real elapsed time across a clock change", () => {
    const clockChange = [event("clock_in", "2026-10-24T21:00:00Z"), event("clock_out", "2026-10-25T02:00:00Z")];
    expect(deriveSessions(clockChange, zone)[0]!.workedMinutes).toBe(300);
  });

  it("leaves a session that is still open without a total", () => {
    const [session] = deriveSessions([morning[0]!], zone);
    expect(session!.workedMinutes).toBeNull();
    expect(session!.endedAt).toBeNull();
    // Nothing here may read as zero: an unfinished day and a day off are not the same thing.
    expect(session!.workedMinutes).not.toBe(0);
  });

  it("reads the log in time order however it arrives", () => {
    expect(deriveSessions([morning[1]!, morning[0]!], zone)[0]!.workedMinutes).toBe(240);
  });

  /**
   * Turning pauses off decides what may be written from now on, never what a day already
   * recorded is worth. Hours already in the log cannot move because somebody changed a setting.
   */
  it("keeps counting pauses already in the log after they stop being recorded", () => {
    const before = [
      event("clock_in", "2026-08-04T07:00:00Z"),
      event("pause_start", "2026-08-04T09:00:00Z"),
      event("pause_end", "2026-08-04T09:30:00Z"),
      event("clock_out", "2026-08-04T11:00:00Z")
    ];
    expect(canRecord("in", "pause_start")).toBe(false);
    expect(deriveSessions(before, zone)[0]!.workedMinutes).toBe(210);
  });
});

describe("corrections", () => {
  const original = event("clock_out", "2026-08-04T15:00:00Z", { id: "wrong" });
  const fixed = event("clock_out", "2026-08-04T11:00:00Z", {
    id: "right",
    correctsEventId: "wrong",
    reason: "Va marxar a les 13:00"
  });

  it("counts the corrected value and stops counting the original", () => {
    const log = [morning[0]!, original, fixed];
    expect(deriveSessions(log, zone)[0]!.workedMinutes).toBe(240);
  });

  it("keeps the original in the log, because that is what makes the record defensible", () => {
    const log = [morning[0]!, original, fixed];
    expect(log.some((entry) => entry.id === "wrong")).toBe(true);
    expect(liveEvents(log).some((entry) => entry.id === "wrong")).toBe(false);
  });

  it("follows a correction of a correction to the last one standing", () => {
    const again = event("clock_out", "2026-08-04T12:00:00Z", {
      id: "final",
      correctsEventId: "right",
      reason: "Encara no hi era"
    });
    expect(liveEvents([morning[0]!, original, fixed, again]).map((entry) => entry.id)).toEqual([
      morning[0]!.id,
      "final"
    ]);
    expect(deriveSessions([morning[0]!, original, fixed, again], zone)[0]!.workedMinutes).toBe(300);
  });
});

describe("an entry that was not clocked at the moment it happened", () => {
  const clocked = { occurredAt: at("2026-08-04T11:00:00Z"), recordedAt: at("2026-08-04T11:00:00Z") };

  it("accepts an ordinary punch, which needs no reason", () => {
    expect(needsReason(clocked)).toBe(false);
    expect(isAcceptableEntry(clocked)).toBe(true);
  });

  it("demands a reason for anything written after the fact", () => {
    const late = { occurredAt: at("2026-08-04T11:00:00Z"), recordedAt: at("2026-08-04T14:00:00Z") };
    expect(needsReason(late)).toBe(true);
    expect(isAcceptableEntry(late)).toBe(false);
    expect(isAcceptableEntry({ ...late, reason: "Vaig oblidar-me de reprendre" })).toBe(true);
    // Whitespace is not a reason.
    expect(isAcceptableEntry({ ...late, reason: "   " })).toBe(false);
  });

  it("demands a reason for a correction even when the time is unchanged", () => {
    expect(needsReason({ ...clocked, correctsEventId: "wrong" })).toBe(true);
  });

  it("refuses an entry claiming to have happened in the future", () => {
    const future = { occurredAt: at("2026-08-04T18:00:00Z"), recordedAt: at("2026-08-04T11:00:00Z") };
    expect(isAcceptableEntry({ ...future, reason: "Ho deixo apuntat" })).toBe(false);
  });
});

/**
 * The case that decided how corrections work, written out because it is the one that will
 * actually happen: in at 08:00, pause at 12:00 for the doctor, back at 13:00 without marking it,
 * and at 16:00 the person notices they are still on a break.
 */
describe("the pause somebody forgot to close", () => {
  const clockIn = event("clock_in", "2026-08-04T06:00:00Z");
  const pauseStart = event("pause_start", "2026-08-04T10:00:00Z");

  it("would count three hours that were worked as break, until somebody says otherwise", () => {
    const asClocked = [clockIn, pauseStart, event("pause_end", "2026-08-04T14:00:00Z")];
    // Resumed at 16:00 local: four hours of break and four of work, and only four are true.
    expect(deriveSessions([...asClocked, event("clock_out", "2026-08-04T14:00:00Z")], zone)[0]!.workedMinutes).toBe(
      240
    );
  });

  it("counts seven hours once the return is declared, and still shows it was declared", () => {
    const declaredReturn = event("pause_end", "2026-08-04T11:00:00Z", {
      id: "declared",
      reason: "Vaig tornar del metge a les 13:00 i no ho vaig marcar"
    });
    const day = [clockIn, pauseStart, declaredReturn, event("clock_out", "2026-08-04T14:00:00Z")];

    const [session] = deriveSessions(day, zone);
    expect(session!.workedMinutes).toBe(420);
    expect(session!.pausedMinutes).toBe(60);
    // Written three hours after it says it happened, so it carries a reason and reads as declared.
    expect(needsReason({ occurredAt: declaredReturn.occurredAt, recordedAt: at("2026-08-04T14:00:00Z") })).toBe(true);
  });
});

describe("the month a person or the accountancy reads", () => {
  const log = [
    ...morning,
    event("clock_in", "2026-08-05T07:00:00Z"),
    event("clock_out", "2026-08-05T09:30:00Z"),
    // Two sessions on one day: the afternoon after a long lunch out of the building.
    event("clock_in", "2026-08-05T13:00:00Z"),
    event("clock_out", "2026-08-05T15:00:00Z")
  ];

  it("adds up the sessions of each day", () => {
    const days = summariseDays(deriveSessions(log, zone));
    expect(days).toEqual([
      { day: "2026-08-04", workedMinutes: 240, hasOpenSession: false },
      { day: "2026-08-05", workedMinutes: 270, hasOpenSession: false }
    ]);
    expect(totalMinutes(days)).toBe(510);
  });

  it("marks a day holding an unfinished session without inventing a total for it", () => {
    const days = summariseDays(deriveSessions([...log, event("clock_in", "2026-08-06T07:00:00Z")], zone));
    const sixth = days.find((day) => day.day === "2026-08-06")!;
    expect(sixth.hasOpenSession).toBe(true);
    expect(sixth.workedMinutes).toBe(0);
    // And the month total is still only what is finished, so it never counts an open session.
    expect(totalMinutes(days)).toBe(510);
  });
});

describe("reconciliation against logged hours", () => {
  it("keeps the two records apart and reports the difference", () => {
    const line = reconcile({ workedMinutes: 510, loggedMinutes: 420 });
    expect(line).toEqual({ workedMinutes: 510, loggedMinutes: 420, unbilledMinutes: 90 });
  });

  /**
   * Negative is not an error and is not clamped: it means somebody logged more hours against
   * projects than they were at work, so one of the two records is wrong. Hiding it would hide
   * the only signal that says so.
   */
  it("does not hide more hours logged than worked", () => {
    expect(reconcile({ workedMinutes: 300, loggedMinutes: 420 }).unbilledMinutes).toBe(-120);
  });
});

describe("calendar functions", () => {
  const holidays = [
    { id: "h1", date: "2026-08-15", name: "Assumpcio" },
    { id: "h2", date: "2026-12-25", name: "Nadal" }
  ];

  const nonWorkingDays = [
    { id: "nw1", dayOfWeek: 0 }, // Sunday
    { id: "nw2", dayOfWeek: 6 } // Saturday
  ];

  const vacations: AttendanceVacation[] = [
    {
      id: "v1",
      membershipId: "m1",
      startDate: "2026-08-01",
      endDate: "2026-08-15",
      status: "approved",
      approvedByMembershipId: null,
      approvedAt: null,
      notes: null
    }
  ];

  const absences: AttendanceAbsence[] = [
    {
      id: "a1",
      membershipId: "m1",
      startDate: "2026-08-20",
      endDate: "2026-08-22",
      type: "sick_leave",
      documentUrl: null,
      notes: null,
      createdByMembershipId: "m1"
    }
  ];

  it("identifies holidays", () => {
    expect(isHoliday("2026-08-15", holidays)).toBe(true);
    expect(isHoliday("2026-08-16", holidays)).toBe(false);
  });

  it("identifies non-working days", () => {
    expect(isNonWorkingDay(0, nonWorkingDays)).toBe(true); // Sunday
    expect(isNonWorkingDay(6, nonWorkingDays)).toBe(true); // Saturday
    expect(isNonWorkingDay(1, nonWorkingDays)).toBe(false); // Monday
  });

  it("identifies vacation days", () => {
    expect(isVacationDay("2026-08-10", vacations, "m1")).toBe(true);
    expect(isVacationDay("2026-08-16", vacations, "m1")).toBe(false);
    expect(isVacationDay("2026-08-10", vacations, "m2")).toBe(false);
  });

  it("identifies absence days", () => {
    expect(isAbsenceDay("2026-08-20", absences, "m1")).toBe(true);
    expect(isAbsenceDay("2026-08-23", absences, "m1")).toBe(false);
    expect(isAbsenceDay("2026-08-20", absences, "m2")).toBe(false);
  });

  it("detects block overlaps", () => {
    const blocks: AttendanceBlock[] = [
      { id: "b1", membershipId: "m1", date: "2026-08-25", startTime: "10:00", endTime: "12:00", reason: "Meeting" }
    ];
    expect(hasBlockOverlap("2026-08-25", "09:00", "11:00", blocks, "m1")).toBe(true);
    expect(hasBlockOverlap("2026-08-25", "12:00", "14:00", blocks, "m1")).toBe(false);
    expect(hasBlockOverlap("2026-08-25", "09:00", "11:00", blocks, "m2")).toBe(false);
  });

  it("derives day status correctly", () => {
    // Holiday
    expect(deriveDayStatus("2026-08-15", 5, holidays, nonWorkingDays, vacations, absences, "m1", 0, false)).toBe(
      "holiday"
    );

    // Non-working day (Saturday)
    expect(deriveDayStatus("2026-08-16", 6, holidays, nonWorkingDays, vacations, absences, "m1", 0, false)).toBe(
      "non_working"
    );

    // Vacation
    expect(deriveDayStatus("2026-08-10", 1, holidays, nonWorkingDays, vacations, absences, "m1", 0, false)).toBe(
      "vacation"
    );

    // Absence
    expect(deriveDayStatus("2026-08-20", 3, holidays, nonWorkingDays, vacations, absences, "m1", 0, false)).toBe(
      "absence"
    );

    // Worked
    expect(deriveDayStatus("2026-08-17", 1, holidays, nonWorkingDays, vacations, absences, "m1", 480, false)).toBe(
      "worked"
    );

    // Open session
    expect(deriveDayStatus("2026-08-18", 2, holidays, nonWorkingDays, vacations, absences, "m1", 0, true)).toBe("open");

    // Empty (no sessions at all, workedMinutes is null)
    expect(deriveDayStatus("2026-08-19", 3, holidays, nonWorkingDays, vacations, absences, "m1", null, false)).toBe(
      "empty"
    );
  });
});

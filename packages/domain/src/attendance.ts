/**
 * Working time records: what the log means, with nothing that touches a database.
 *
 * The record is a log of events and everything else is derived from it, per
 * `docs/specifications/attendance.md`. Sessions and totals are read out of the log rather than
 * stored, because a row with an `ended_at` to update is a row somebody can rewrite, and a record
 * an employer can rewrite in silence proves nothing to an inspection.
 *
 * Two rules run through all of it: a correction never removes what it corrects, and an
 * unfinished session is never shown as zero.
 */

import { localDay } from "./tenant-clock.js";

export const attendanceEventKinds = ["clock_in", "clock_out", "pause_start", "pause_end"] as const;
export type AttendanceEventKind = (typeof attendanceEventKinds)[number];

export const attendanceStates = ["out", "in", "paused"] as const;
/** Where a person is according to their log. Derived from the last live event, never stored. */
export type AttendanceState = (typeof attendanceStates)[number];

export type AttendanceEvent = {
  id: string;
  kind: AttendanceEventKind;
  /** When it happened, always from the server clock. The browser's clock is not evidence. */
  occurredAt: Date;
  /** The event this one replaces. Null for an ordinary punch. */
  correctsEventId?: string | null;
  reason?: string | null;
};

export type AttendanceSession = {
  startedAt: Date;
  /** Null while the session is open. */
  endedAt: Date | null;
  /** The tenant-local day the session started, `YYYY-MM-DD`. A night shift belongs to its start. */
  day: string;
  pausedMinutes: number;
  /** Null while the session is open, so an unfinished day cannot be read as a day off. */
  workedMinutes: number | null;
};

export type AttendanceDay = { day: string; workedMinutes: number; hasOpenSession: boolean };

/**
 * Whether this installation records breaks at all.
 *
 * Off by default. Recording start and end of the working day is the obligation; what happens in
 * between depends on the collective agreement, and plenty of companies run a continuous shift
 * without deducting breakfast or lunch. Where nobody deducts a break, recording one only creates
 * the break somebody forgets to close.
 */
export type AttendancePolicy = { pausesEnabled: boolean };

const continuousShift: AttendancePolicy = { pausesEnabled: false };

/**
 * What each state allows next, before any policy.
 *
 * A clock out with nothing to close, a second clock in, or a pause that never started are all
 * refused here and again at the database, because this is the shape that makes the totals
 * unambiguous. Leaving while paused is refused too: closing the pause implicitly at the clock
 * out would make a day's total depend on a rule nobody reads, and the screen has a better answer
 * anyway, which is to ask when the person came back.
 */
const allowed: Record<AttendanceState, readonly AttendanceEventKind[]> = {
  out: ["clock_in"],
  in: ["clock_out", "pause_start"],
  paused: ["pause_end"]
};

const pauseKinds: readonly AttendanceEventKind[] = ["pause_start", "pause_end"];

/**
 * Whether an event can follow this state at all, ignoring policy.
 *
 * Reading the log has to be policy-free. An installation that stops recording breaks still has
 * to add up the days it recorded them, and a report that changed its answer because somebody
 * flipped a setting would be worse than useless.
 */
function follows(state: AttendanceState, kind: AttendanceEventKind): boolean {
  return allowed[state].includes(kind);
}

/**
 * Whether a person in this state may record this kind of event now.
 *
 * The policy gates what may be *written*, never how the log is read: `deriveSessions` keeps
 * counting pauses that are already recorded even after an installation stops recording them,
 * because a setting must not be able to move hours somebody already worked.
 */
export function canRecord(
  state: AttendanceState,
  kind: AttendanceEventKind,
  policy: AttendancePolicy = continuousShift
): boolean {
  if (!policy.pausesEnabled && pauseKinds.includes(kind)) return false;
  return allowed[state].includes(kind);
}

/**
 * An entry, as it is about to be written, with both clocks: when it says it happened and when it
 * reached the server. For an ordinary punch they are the same instant.
 */
export type AttendanceEntry = {
  occurredAt: Date;
  recordedAt: Date;
  correctsEventId?: string | null | undefined;
  reason?: string | null | undefined;
};

/**
 * Anything not clocked at the moment it happened has to say why.
 *
 * That covers both shapes a late entry takes: an event that replaces another, and an event that
 * was simply missing and is written now with the time it really happened. Neither can pass as an
 * ordinary punch, because the difference between the two clocks is what tells a reader -- an
 * inspector included -- that a person declared this rather than pressed a button at the time.
 */
export function needsReason(entry: AttendanceEntry): boolean {
  return Boolean(entry.correctsEventId) || entry.occurredAt.getTime() < entry.recordedAt.getTime();
}

/** The same two rules the database enforces, so a form can refuse before a round trip. */
export function isAcceptableEntry(entry: AttendanceEntry): boolean {
  if (entry.occurredAt.getTime() > entry.recordedAt.getTime()) return false;
  return !needsReason(entry) || Boolean(entry.reason?.trim());
}

function byOccurredAt(a: AttendanceEvent, b: AttendanceEvent): number {
  return a.occurredAt.getTime() - b.occurredAt.getTime();
}

/**
 * The log with corrected events taken out, in time order.
 *
 * The originals stay in the caller's list and stay readable; they simply stop counting. A
 * correction of a correction leaves only the last one standing, because each superseded id is
 * removed no matter how long the chain is.
 */
export function liveEvents(events: readonly AttendanceEvent[]): AttendanceEvent[] {
  const superseded = new Set(events.map((event) => event.correctsEventId).filter((id): id is string => Boolean(id)));
  return events.filter((event) => !superseded.has(event.id)).sort(byOccurredAt);
}

export function stateOf(events: readonly AttendanceEvent[]): AttendanceState {
  let state: AttendanceState = "out";
  for (const event of liveEvents(events)) {
    if (!follows(state, event.kind)) continue;
    if (event.kind === "clock_in") state = "in";
    else if (event.kind === "clock_out") state = "out";
    else if (event.kind === "pause_start") state = "paused";
    else state = "in";
  }
  return state;
}

/** Half-up, so a session of thirty seconds is a minute rather than nothing. */
function minutesBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / 60_000 + 0.5);
}

/**
 * Sessions read out of the log.
 *
 * Events that cannot follow the current state are skipped rather than thrown on: the service
 * and the database both refuse to write them, so meeting one here means reading a log written
 * before those rules existed, and a report that fails to render is worse than one that shows
 * what it can.
 *
 * Rounding is per session and never on the sum, the same rule time entries follow: a total a
 * person can check has to be the sum of the lines they can see.
 */
export function deriveSessions(events: readonly AttendanceEvent[], timeZone: string): AttendanceSession[] {
  const sessions: AttendanceSession[] = [];
  let state: AttendanceState = "out";
  let startedAt: Date | null = null;
  let pausedMinutes = 0;
  let pausedAt: Date | null = null;

  for (const event of liveEvents(events)) {
    if (!follows(state, event.kind)) continue;

    if (event.kind === "clock_in") {
      state = "in";
      startedAt = event.occurredAt;
      pausedMinutes = 0;
    } else if (event.kind === "pause_start") {
      state = "paused";
      pausedAt = event.occurredAt;
    } else if (event.kind === "pause_end") {
      state = "in";
      if (pausedAt) pausedMinutes += minutesBetween(pausedAt, event.occurredAt);
      pausedAt = null;
    } else {
      state = "out";
      sessions.push({
        startedAt: startedAt!,
        endedAt: event.occurredAt,
        day: localDay(startedAt!, timeZone),
        pausedMinutes,
        // Clamped because a pause longer than the session it sits in cannot be worked back to a
        // sensible number, and a negative day would be read as a bug in the total, not in the log.
        workedMinutes: Math.max(0, minutesBetween(startedAt!, event.occurredAt) - pausedMinutes)
      });
      startedAt = null;
      pausedMinutes = 0;
    }
  }

  // Whatever is still open is reported as open, with no total. An open pause inside it is not
  // subtracted either: nobody knows yet how long it will be.
  if (startedAt) {
    sessions.push({
      startedAt,
      endedAt: null,
      day: localDay(startedAt, timeZone),
      pausedMinutes,
      workedMinutes: null
    });
  }

  return sessions;
}

/** One line per day that has any session, in date order. */
export function summariseDays(sessions: readonly AttendanceSession[]): AttendanceDay[] {
  const days = new Map<string, AttendanceDay>();
  for (const session of sessions) {
    const day = days.get(session.day) ?? { day: session.day, workedMinutes: 0, hasOpenSession: false };
    if (session.workedMinutes === null) day.hasOpenSession = true;
    else day.workedMinutes += session.workedMinutes;
    days.set(session.day, day);
  }
  return [...days.values()].sort((a, b) => a.day.localeCompare(b.day));
}

export function totalMinutes(days: readonly AttendanceDay[]): number {
  return days.reduce((total, day) => total + day.workedMinutes, 0);
}

export type AttendanceHoliday = {
  id: string;
  date: string; // YYYY-MM-DD
  name: string;
};

export type AttendanceNonWorkingDay = {
  id: string;
  dayOfWeek: number; // 0 = Sunday, 6 = Saturday
};

export type AttendanceRequestStatus = "pending" | "approved" | "rejected";
export type AttendanceVacationStatus = AttendanceRequestStatus;

export type AttendanceVacation = {
  id: string;
  membershipId: string;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  status: AttendanceVacationStatus;
  approvedByMembershipId?: string | null;
  approvedAt?: Date | null;
  notes?: string | null;
};

export type AttendanceAbsenceType = "sick_leave" | "personal_leave" | "other";

export type AttendanceAbsence = {
  id: string;
  membershipId: string;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  type: AttendanceAbsenceType;
  status: AttendanceRequestStatus;
  approvedByMembershipId?: string | null;
  approvedAt?: Date | null;
  documentUrl?: string | null;
  notes?: string | null;
  createdByMembershipId: string;
};

export type AttendanceBlock = {
  id: string;
  membershipId: string;
  date: string; // YYYY-MM-DD
  startTime: string; // HH:mm
  endTime: string; // HH:mm
  reason: string;
};

export type ReconciliationLine = { workedMinutes: number; loggedMinutes: number; unbilledMinutes: number };

/**
 * Time at work against time logged to projects and tickets, side by side and never added up.
 *
 * The difference is the structural time nobody bills: internal meetings, administration,
 * training, selling. It can come out negative, meaning more was logged than worked, and that is
 * left visible on purpose -- it is the only sign that one of the two records is wrong.
 */
export function reconcile(input: { workedMinutes: number; loggedMinutes: number }): ReconciliationLine {
  return {
    workedMinutes: input.workedMinutes,
    loggedMinutes: input.loggedMinutes,
    unbilledMinutes: input.workedMinutes - input.loggedMinutes
  };
}

/**
 * Check if a date is a holiday for the tenant.
 */
export function isHoliday(date: string, holidays: readonly AttendanceHoliday[]): boolean {
  return holidays.some((h) => h.date === date);
}

/**
 * Check if a day of week is a non-working day for the tenant.
 */
export function isNonWorkingDay(dayOfWeek: number, nonWorkingDays: readonly AttendanceNonWorkingDay[]): boolean {
  return nonWorkingDays.some((n) => n.dayOfWeek === dayOfWeek);
}

/**
 * Get the day of week for a date string (0 = Sunday, 6 = Saturday).
 */
export function dayOfWeek(date: string): number {
  return new Date(`${date}T12:00:00`).getDay();
}

/**
 * Check if a date is a vacation day for a member.
 */
export function isVacationDay(date: string, vacations: readonly AttendanceVacation[], membershipId: string): boolean {
  return vacations.some(
    (v) => v.membershipId === membershipId && v.status === "approved" && date >= v.startDate && date <= v.endDate
  );
}

/**
 * Check if a date is an absence day for a member.
 */
export function isAbsenceDay(date: string, absences: readonly AttendanceAbsence[], membershipId: string): boolean {
  return absences.some(
    (a) => a.membershipId === membershipId && a.status === "approved" && date >= a.startDate && date <= a.endDate
  );
}

/**
 * Check if a time slot overlaps with any block for a member on a given date.
 */
export function hasBlockOverlap(
  date: string,
  startTime: string,
  endTime: string,
  blocks: readonly AttendanceBlock[],
  membershipId: string
): boolean {
  return blocks.some(
    (b) => b.membershipId === membershipId && b.date === date && b.startTime < endTime && b.endTime > startTime
  );
}

/**
 * The status of a day for a member, used for the calendar view.
 */
export type AttendanceDayStatus =
  "worked" | "partial" | "open" | "holiday" | "non_working" | "vacation" | "absence" | "empty";

/**
 * Derive the status of a day for calendar rendering.
 */
export function deriveDayStatus(
  date: string,
  dayOfWeek: number,
  holidays: readonly AttendanceHoliday[],
  nonWorkingDays: readonly AttendanceNonWorkingDay[],
  vacations: readonly AttendanceVacation[],
  absences: readonly AttendanceAbsence[],
  membershipId: string,
  workedMinutes: number | null,
  hasOpenSession: boolean
): AttendanceDayStatus {
  if (isHoliday(date, holidays)) return "holiday";
  if (isNonWorkingDay(dayOfWeek, nonWorkingDays)) return "non_working";
  if (isVacationDay(date, vacations, membershipId)) return "vacation";
  if (isAbsenceDay(date, absences, membershipId)) return "absence";
  if (hasOpenSession) return "open";
  if (workedMinutes !== null && workedMinutes > 0) return "worked";
  if (workedMinutes !== null && workedMinutes === 0) return "partial";
  return "empty";
}

/**
 * How much of an interval counts against a service level target.
 *
 * The clock only runs inside the configured support hours, so a ticket opened on Friday
 * evening does not spend the weekend breaching a target nobody agreed to be available for.
 *
 * Everything here is pure and takes the calendar as an argument: hours, days and holidays are
 * tenant data, never constants. A buyer may run split shifts, work Saturdays, or open on no
 * day at all, and each of those is representable.
 */

import { localParts } from "./tenant-clock.js";

/** `0` is Sunday, matching `Date.getUTCDay`. Local times are `HH:MM` in the tenant's zone. */
export type SupportWindow = { weekday: number; opensAt: string; closesAt: string };

export type SupportCalendar = {
  timeZone: string;
  windows: readonly SupportWindow[];
  /** Dates the office is closed regardless of the weekly pattern, as `YYYY-MM-DD` local. */
  holidays: readonly string[];
};

const MINUTE = 60_000;
const DAY_MINUTES = 24 * 60;

/** Local `HH:MM` as minutes from midnight, so windows can be compared as plain numbers. */
function toMinutes(time: string): number {
  const [hours, minutes] = time.split(":");
  return Number(hours) * 60 + Number(minutes);
}

/**
 * Walks the interval one local day at a time and adds up the overlap with that day's windows.
 *
 * Days are stepped through in UTC and each step is asked what local day it landed on, rather
 * than assuming a day is 1440 minutes long. Around a clock change it is not.
 */
export function businessMinutesBetween(calendar: SupportCalendar, from: Date, to: Date): number {
  if (!(from < to) || calendar.windows.length === 0) return 0;

  const holidays = new Set(calendar.holidays);
  const startedAt = from.getTime();
  const endedAt = to.getTime();
  let total = 0;
  const counted = new Set<string>();

  for (let cursor = startedAt; cursor <= endedAt + DAY_MINUTES * MINUTE; cursor += (DAY_MINUTES / 2) * MINUTE) {
    const { date, weekday } = localParts(new Date(Math.min(cursor, endedAt)), calendar.timeZone);
    if (counted.has(date) || holidays.has(date)) continue;
    counted.add(date);

    for (const window of calendar.windows) {
      if (window.weekday !== weekday) continue;
      const opensAt = toMinutes(window.opensAt);
      const closesAt = toMinutes(window.closesAt);
      if (closesAt <= opensAt) continue;

      // The window's edges as instants, found by nudging from a known point inside the day.
      const windowStart = instantAtLocal(date, opensAt, calendar.timeZone);
      const windowEnd = instantAtLocal(date, closesAt, calendar.timeZone);
      const overlap = Math.min(endedAt, windowEnd) - Math.max(startedAt, windowStart);
      if (overlap > 0) total += overlap / MINUTE;
    }
  }
  return Math.round(total);
}

/**
 * The instant at which a local date and time occurs in a zone.
 *
 * Guessed as if the zone were UTC, then corrected by the offset the zone actually had at that
 * guess. One correction is enough for every real zone, and it stays right across a clock
 * change because the offset is measured near the answer rather than assumed.
 */
function instantAtLocal(date: string, minutesIntoDay: number, timeZone: string): number {
  const [year, month, day] = date.split("-").map(Number);
  const guess = Date.UTC(year!, month! - 1, day, 0, minutesIntoDay);
  const seen = localParts(new Date(guess), timeZone);
  const [seenYear, seenMonth, seenDay] = seen.date.split("-").map(Number);
  const seenAsUtc = Date.UTC(seenYear!, seenMonth! - 1, seenDay, 0, seen.minutesIntoDay);
  return guess + (guess - seenAsUtc);
}

/**
 * The windows that make a schedule unusable: any that close before they open, and any pair on
 * the same weekday that overlap.
 *
 * An overlap is not a harmless duplicate. The clock adds up each window's intersection with
 * the interval, so overlapping hours are counted twice and a ticket appears to have consumed
 * more of its target than the day actually contained.
 */
export function overlappingWindows(windows: readonly SupportWindow[]): SupportWindow[] {
  const offending = new Set<SupportWindow>();
  for (const window of windows) {
    if (toMinutes(window.closesAt) <= toMinutes(window.opensAt)) offending.add(window);
  }
  for (const [index, window] of windows.entries()) {
    for (const other of windows.slice(index + 1)) {
      if (window.weekday !== other.weekday) continue;
      const startsBeforeOtherEnds = toMinutes(window.opensAt) < toMinutes(other.closesAt);
      const endsAfterOtherStarts = toMinutes(window.closesAt) > toMinutes(other.opensAt);
      if (startsBeforeOtherEnds && endsAfterOtherStarts) {
        offending.add(window);
        offending.add(other);
      }
    }
  }
  return [...offending];
}

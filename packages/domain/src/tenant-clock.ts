/**
 * The tenant's wall clock for an instant.
 *
 * `Intl` is what knows that Madrid is UTC+1 in January and UTC+2 in August, so the offset is
 * read from the calendar rather than assumed. Doing this arithmetic with fixed offsets is how a
 * clock change silently gains or loses an hour.
 *
 * Shared because two modules need the same answer to "which local day did this instant fall on":
 * support counts business minutes per day, and attendance attributes a session to the day it
 * started. Two copies of this would drift, and the one that drifted would be the one nobody
 * tested around a clock change.
 */

const weekdayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export type LocalParts = {
  /** `YYYY-MM-DD` in the tenant's zone. */
  date: string;
  minutesIntoDay: number;
  /** `0` is Sunday, matching `Date.getUTCDay`. */
  weekday: number;
};

export function localParts(instant: Date, timeZone: string): LocalParts {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short"
  });
  const parts = Object.fromEntries(formatter.formatToParts(instant).map(({ type, value }) => [type, value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutesIntoDay: Number(parts.hour) * 60 + Number(parts.minute),
    weekday: weekdayNames.indexOf(parts.weekday ?? "")
  };
}

/** The local day an instant belongs to, as `YYYY-MM-DD`. */
export function localDay(instant: Date, timeZone: string): string {
  return localParts(instant, timeZone).date;
}

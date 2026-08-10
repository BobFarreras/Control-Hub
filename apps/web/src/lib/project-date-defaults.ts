const CIVIL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** Formats the day shown by the user's wall clock without converting it through UTC. */
export function localCivilDate(now: Date): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * Moves a civil date without letting daylight-saving offsets add or remove a day.
 * The input and output are form values, not instants, so the arithmetic deliberately uses UTC.
 */
export function addCalendarDays(value: string, days: number): string {
  const match = CIVIL_DATE.exec(value);
  if (!match) throw new Error("INVALID_CIVIL_DATE");
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days));
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

export function projectDateDefaults(now: Date): { startedAt: string; dueAt: string } {
  const startedAt = localCivilDate(now);
  return { startedAt, dueAt: addCalendarDays(startedAt, 30) };
}

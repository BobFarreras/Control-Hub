/**
 * The month both attendance screens are looking at, shared so they cannot disagree about where a
 * month starts.
 *
 * Built from the parts rather than from an instant, because a month boundary turned into UTC
 * lands in the previous month for anybody east of Greenwich, and this record is counted in local
 * days from end to end.
 */
export function monthRange(value: string | undefined): { from: string; to: string; month: string } {
  const now = new Date();
  const matched = /^(\d{4})-(\d{2})$/.exec(value ?? "");
  const year = matched ? Number(matched[1]) : now.getFullYear();
  const month = matched ? Number(matched[2]) : now.getMonth() + 1;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    from: `${year}-${pad(month)}-01`,
    to: `${year}-${pad(month)}-${pad(lastDay)}`,
    month: `${year}-${pad(month)}`
  };
}

/** The month before or after this one, as `YYYY-MM`, carried across a year boundary. */
export function shiftMonth(month: string, by: number): string {
  const [year, index] = month.split("-").map(Number);
  const moved = new Date(Date.UTC(year!, index! - 1 + by, 1));
  return `${moved.getUTCFullYear()}-${String(moved.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function monthName(month: string, locale: string): string {
  const [year, index] = month.split("-").map(Number);
  // Midday, so the label cannot slip into the previous month in a zone behind UTC.
  return new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(
    new Date(Date.UTC(year!, index! - 1, 1, 12))
  );
}

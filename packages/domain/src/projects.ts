export const projectStatuses = ["draft", "active", "on_hold", "delivered", "closed", "canceled"] as const;
export type ProjectStatus = (typeof projectStatuses)[number];

/**
 * `canceled` is terminal: it means the work never happened, and there is nothing to resume.
 *
 * `closed` is not, because decision 8 of the specification makes reopening a project an
 * explicit, audited action rather than an impossible one. It reopens into `active`: a project
 * somebody has to work on again is active, whatever it was before it closed.
 */
const projectTransitions: Record<ProjectStatus, readonly ProjectStatus[]> = {
  draft: ["active", "on_hold", "canceled"],
  active: ["delivered", "on_hold", "closed", "canceled"],
  on_hold: ["active", "canceled"],
  delivered: ["closed", "active", "on_hold", "canceled"],
  closed: ["active"],
  canceled: []
};

export function canTransitionProject(from: ProjectStatus, to: ProjectStatus): boolean {
  return projectTransitions[from].includes(to);
}

/** The statuses that refuse new hours. Mirrored by a trigger on `time_entries`. */
export function acceptsTimeEntries(status: ProjectStatus): boolean {
  return status !== "closed" && status !== "canceled";
}

/**
 * A day, as `YYYY-MM-DD`.
 *
 * Days stay strings from the database to the report and are never turned into `Date`. A rate
 * effective from the 1st applies to the work of the 1st for everybody, and converting either
 * side to an instant would make that depend on the reader's time zone. ISO dates also compare
 * correctly as strings, so the ordering below needs no parsing at all.
 */
export type IsoDate = string;

const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: string): value is IsoDate {
  if (!isoDatePattern.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** Today in UTC, as the day a time entry defaults to. */
export function todayIso(now = new Date()): IsoDate {
  return now.toISOString().slice(0, 10);
}

/**
 * Minutes from either a plain number of minutes or a written duration such as `1h 30m`.
 *
 * Logging time is the one thing in this module people do several times a day, and forcing a
 * conversion to minutes in their head is how an hour and a half becomes 130. Returns null for
 * anything it cannot read, so the caller answers with an error instead of a guess.
 */
export function parseDurationMinutes(input: string): number | null {
  const text = input.trim().toLowerCase();
  if (text.length === 0) return null;

  if (/^\d+$/.test(text)) return withinDay(Number(text));

  const written = /^(?:(\d+)\s*h)?\s*(?:(\d+)\s*(?:m|min)?)?$/.exec(text);
  if (!written || (!written[1] && !written[2])) return null;
  const hours = Number(written[1] ?? 0);
  const minutes = Number(written[2] ?? 0);
  if (minutes > 59 && written[1]) return null;
  return withinDay(hours * 60 + minutes);
}

function withinDay(minutes: number): number | null {
  return Number.isSafeInteger(minutes) && minutes >= 1 && minutes <= 1440 ? minutes : null;
}

/** An hourly amount in minor units, with the currency it is expressed in. */
export type HourlyRate = { currency: string; minorPerHour: number };

/** A published rate: an hourly amount that starts applying on a given day and never moves. */
export type DatedRate = HourlyRate & { effectiveFrom: IsoDate };

/**
 * The rate in force on a day: the most recent one published on or before it.
 *
 * Resolving by the day worked rather than by today is the whole point of publishing rates with
 * an effective date. Valuing last month's hours with a rate published this morning would
 * rewrite the margin of a project that is already closed and invoiced.
 */
export function rateOn<T extends { effectiveFrom: IsoDate }>(rates: readonly T[], on: IsoDate): T | null {
  let winner: T | null = null;
  for (const rate of rates) {
    if (rate.effectiveFrom > on) continue;
    if (!winner || rate.effectiveFrom > winner.effectiveFrom) winner = rate;
  }
  return winner;
}

/**
 * `round_half_up(minutes * minorPerHour / 60)`, in integers throughout.
 *
 * Rounding happens per entry and never on a sum, so a report total is always the sum of the
 * lines a customer can see, and reconciling an invoice line by line adds up exactly.
 */
export function valueOfMinutes(minutes: number, minorPerHour: number): number {
  if (!Number.isSafeInteger(minutes) || minutes < 0) throw new Error("INVALID_MINUTES");
  if (!Number.isSafeInteger(minorPerHour) || minorPerHour < 0) throw new Error("INVALID_RATE");
  const numerator = BigInt(minutes) * BigInt(minorPerHour);
  const result = (numerator * 2n + 60n) / 120n;
  if (result > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("MONEY_OVERFLOW");
  return Number(result);
}

/** One logged stretch of work, already matched with the rates in force the day it was worked. */
export type ValuedTimeEntry = {
  minutes: number;
  billable: boolean;
  cost: HourlyRate | null;
  revenue: HourlyRate | null;
};

/** What was earned and spent in one currency. Two currencies never share a line. */
export type ProfitabilityLine = {
  currency: string;
  revenueMinor: number;
  costMinor: number;
  marginMinor: number;
};

export type Profitability = {
  minutes: number;
  billableMinutes: number;
  lines: ProfitabilityLine[];
  /** Entries whose rate could not be resolved. A missing rate is a gap, never a zero. */
  entriesWithoutCostRate: number;
  entriesWithoutBillingRate: number;
};

/**
 * Hours, money and margin for a set of entries.
 *
 * Minutes are counted once, at the top, rather than split across the currency lines: an entry
 * whose cost is in euros and whose price is in dollars belongs to both lines, and dividing its
 * hours between them would invent a number nobody could reconcile.
 *
 * A rate that could not be resolved is counted, not treated as zero. Zero cost would quietly
 * report a margin of one hundred per cent on unconfigured work, which is the most flattering
 * possible way to be wrong.
 */
export function profitability(entries: readonly ValuedTimeEntry[]): Profitability {
  const byCurrency = new Map<string, { revenueMinor: number; costMinor: number }>();
  const line = (currency: string) => {
    const existing = byCurrency.get(currency);
    if (existing) return existing;
    const created = { revenueMinor: 0, costMinor: 0 };
    byCurrency.set(currency, created);
    return created;
  };

  let minutes = 0;
  let billableMinutes = 0;
  let entriesWithoutCostRate = 0;
  let entriesWithoutBillingRate = 0;

  for (const entry of entries) {
    minutes += entry.minutes;
    if (entry.billable) billableMinutes += entry.minutes;

    if (entry.cost) line(entry.cost.currency).costMinor += valueOfMinutes(entry.minutes, entry.cost.minorPerHour);
    else entriesWithoutCostRate += 1;

    // Non-billable work still costs; it simply earns nothing, and no rate is missing for it.
    if (!entry.billable) continue;
    if (entry.revenue)
      line(entry.revenue.currency).revenueMinor += valueOfMinutes(entry.minutes, entry.revenue.minorPerHour);
    else entriesWithoutBillingRate += 1;
  }

  return {
    minutes,
    billableMinutes,
    lines: [...byCurrency.entries()]
      .map(([currency, totals]) => ({
        currency,
        revenueMinor: totals.revenueMinor,
        costMinor: totals.costMinor,
        marginMinor: totals.revenueMinor - totals.costMinor
      }))
      .sort((a, b) => a.currency.localeCompare(b.currency)),
    entriesWithoutCostRate,
    entriesWithoutBillingRate
  };
}

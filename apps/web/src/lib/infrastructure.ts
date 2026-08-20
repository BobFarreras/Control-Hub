import type { StatusTone } from "@/components/status-pill";
import type { AlertSeverity, InfrastructureAlert, ObservedState, Reading, ReadingValue } from "@/lib/api-types";

/**
 * How the infrastructure screen reads what the API said.
 *
 * Pure on purpose, like `lib/integrations`: the age of a reading and the state of an alert are
 * the two judgements this screen makes, and both are worth proving without rendering anything.
 *
 * Specification: `docs/specifications/infrastructure.md`.
 */

/**
 * The tone of a severity. Never the only carrier of meaning: `StatusPill` always draws the word
 * and an icon beside it, which is what keeps a severity legible in greyscale.
 */
export const severityTone: Record<AlertSeverity, StatusTone> = {
  critical: "danger",
  high: "warning",
  normal: "active",
  low: "neutral"
};

export type AlertState = "firing" | "acknowledged" | "resolved";

export const alertStateTone: Record<AlertState, StatusTone> = {
  firing: "danger",
  acknowledged: "warning",
  resolved: "done"
};

/**
 * Acknowledged is a state of its own, not a shade of firing. An alert somebody has taken should
 * stop asking for the same attention it asked for before they said so, and the list should still
 * show it, because it has not stopped happening.
 */
export function alertState(alert: InfrastructureAlert): AlertState {
  if (alert.status === "resolved") return "resolved";
  return alert.acknowledgedAt ? "acknowledged" : "firing";
}

/**
 * When a reading stops being current.
 *
 * `pull_workflows` runs every 15 minutes. Three passes that could have happened and did not is no
 * longer a slow one: it is a provider we have lost sight of, and the row has to say so by itself
 * rather than letting an hour-old figure look exactly like a fresh one.
 */
export const staleAfterMinutes = 45;

export type ReadingAge = {
  unit: "minute" | "hour" | "day";
  /** How many of that unit. The screen turns it into words; the count is locale-free. */
  count: number;
  stale: boolean;
};

/** The age of a reading, in the largest unit that still says something useful, or null. */
export function readingAge(observedAt: string | null | undefined, now: Date): ReadingAge | null {
  if (!observedAt) return null;
  const observed = new Date(observedAt);
  if (Number.isNaN(observed.getTime())) return null;

  // A reading dated after the moment we are drawing it is two clocks disagreeing, not a reading
  // from the future: it reads as fresh, never as a negative age.
  const minutes = Math.max(0, Math.floor((now.getTime() - observed.getTime()) / 60_000));
  const stale = minutes >= staleAfterMinutes;

  if (minutes < 60) return { unit: "minute", count: minutes, stale };
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return { unit: "hour", count: hours, stale };
  return { unit: "day", count: Math.floor(hours / 24), stale };
}

const ageKey: Record<ReadingAge["unit"], string> = {
  minute: "ageMinutes",
  hour: "ageHours",
  day: "ageDays"
};

/**
 * An age in the words of the dictionary.
 *
 * Zero minutes is "just now" and not "0 min ago", which is the one case where the number is
 * worse than the word. No reading at all is the fallback the caller chose: an age we do not have
 * is never drawn as an age of zero.
 */
export function ageLabel(labels: Record<string, string>, age: ReadingAge | null, fallback: string): string {
  if (!age) return fallback;
  if (age.unit === "minute" && age.count === 0) return labels.ageNow ?? "";
  return (labels[ageKey[age.unit]] ?? "").replace("{count}", String(age.count));
}

/**
 * The tone of an observed state.
 *
 * `unknown` is the third answer the API gives and not a shade of `down`: it is a collector we
 * have lost sight of, and drawing it in the colour of an outage would send somebody looking for
 * a machine that never stopped. As everywhere else the tone is never the only carrier of the
 * meaning: the pill draws the word and an icon beside it.
 */
export const observedStateTone: Record<ObservedState, StatusTone> = {
  up: "active",
  down: "danger",
  unknown: "neutral"
};

type Labels = Record<string, string>;

/** One measure of a reading, already in the words and the numbers of a language. */
export type Figure = { field: string; label: string; value: string };

type FigureContext = { labels: Labels; locale: string; now: Date };
type Formatter = (value: ReadingValue, context: FigureContext) => string | null;

const decimals = (value: number, locale: string, digits: number) =>
  new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(value);

/** A ratio as whole percent. There is no separator anywhere in it, which is why it needs no locale. */
const percent: Formatter = (value) => (typeof value === "number" ? `${Math.round(value * 100)}%` : null);

const rounded = (digits: number): Formatter =>
  function format(value, { locale }) {
    return typeof value === "number" ? decimals(value, locale, digits) : null;
  };

const gigabytes: Formatter = (value, { locale }) =>
  typeof value === "number" ? `${decimals(value / 1_000_000_000, locale, 1)} GB` : null;

const milliseconds: Formatter = (value) => (typeof value === "number" ? `${Math.round(value * 1000)} ms` : null);

/** How long ago an instant was, in the same words every other age on this screen is written in. */
const since: Formatter = (value, { labels, now }) => {
  if (typeof value !== "string") return null;
  const age = readingAge(value, now);
  return age ? ageLabel(labels, age, "") : null;
};

/**
 * A span of seconds, read as the instant it started.
 *
 * An uptime and the hour a container started are the same fact told two ways, so they are drawn
 * with the same words rather than with a second vocabulary of durations nobody else uses.
 */
const elapsed: Formatter = (value, context) => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  return since(new Date(context.now.getTime() - value * 1000).toISOString(), context);
};

const dayInMilliseconds = 86_400_000;

/**
 * How long an instant has left.
 *
 * Something already past says so in words rather than counting backwards: a certificate that
 * expired last week is not "-7 days", and a negative number beside a date is the kind of figure a
 * person reads twice and still does not trust.
 */
const until: Formatter = (value, { labels, now }) => {
  if (typeof value !== "string") return null;
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) return null;
  const remaining = instant.getTime() - now.getTime();
  if (remaining <= 0) return labels.figureExpired ?? "";
  const days = Math.floor(remaining / dayInMilliseconds);
  if (days === 0) return labels.figureExpiresToday ?? "";
  return (labels.figureRemainingDays ?? "").replace("{count}", String(days));
};

/**
 * What a reading may show, named field by field and in the order a person reads them.
 *
 * The same rule as the allow-list the API answers through, on the side of the wire the browser is
 * on: a field nobody put in this table is not drawn. A collector that starts publishing an
 * address, a token or anything else nobody asked for reaches no screen by the mere fact of
 * existing. And the order is the table's rather than the payload's, so two machines are read the
 * same way round.
 */
const figureFields: readonly { field: string; labelKey: string; format: Formatter }[] = [
  { field: "cpuBusyRatio", labelKey: "figureCpu", format: percent },
  { field: "memoryUsedRatio", labelKey: "figureMemory", format: percent },
  { field: "filesystemUsedRatio", labelKey: "figureDisk", format: percent },
  { field: "load1", labelKey: "figureLoad", format: rounded(2) },
  { field: "uptimeSeconds", labelKey: "figureUptime", format: elapsed },
  { field: "memoryBytes", labelKey: "figureMemoryBytes", format: gigabytes },
  { field: "cpuCores", labelKey: "figureCpuCores", format: rounded(2) },
  { field: "startedAt", labelKey: "figureStartedAt", format: since },
  { field: "durationSeconds", labelKey: "figureProbeDuration", format: milliseconds },
  { field: "certificateExpiresAt", labelKey: "figureCertificate", format: until },
  { field: "lastSuccessAt", labelKey: "figureLastBackup", format: since }
];

/**
 * The figures of a reading, in words.
 *
 * Computed on the server against one instant, like every age on this screen, so that a row cannot
 * say one thing before hydration and another after. A value of the wrong shape is a provider we
 * misread and is dropped: a figure nobody can trust is worse than no figure at all.
 */
export function readingFigures(labels: Labels, locale: string, reading: Reading, now: Date): Figure[] {
  const figures: Figure[] = [];
  for (const { field, labelKey, format } of figureFields) {
    const value = reading.data[field];
    if (value === undefined) continue;
    const formatted = format(value, { labels, locale, now });
    if (formatted) figures.push({ field, label: labels[labelKey] ?? field, value: formatted });
  }
  return figures;
}

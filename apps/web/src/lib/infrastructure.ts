import type { StatusTone } from "@/components/status-pill";
import type { AlertSeverity, InfrastructureAlert } from "@/lib/api-types";

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

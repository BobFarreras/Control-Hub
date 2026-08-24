import type { UsageBudgetEvaluation, UsageCost, UsageEvent } from "./api-types";

export type UsageCoverage = { total: number; priced: number; partial: number; unpriced: number; percent: number };

export function usageCoverage(events: readonly UsageEvent[], costs: readonly UsageCost[]): UsageCoverage {
  const latest = new Map<string, UsageCost>();
  for (const cost of costs) if (cost.eventId && !latest.has(cost.eventId)) latest.set(cost.eventId, cost);
  let priced = 0,
    partial = 0,
    unpriced = 0;
  for (const event of events) {
    const state = latest.get(event.id)?.state ?? "unpriced";
    if (state === "priced") priced += 1;
    else if (state === "partial") partial += 1;
    else unpriced += 1;
  }
  return {
    total: events.length,
    priced,
    partial,
    unpriced,
    percent: events.length ? Math.round((priced / events.length) * 100) : 0
  };
}

export function quantityTotal(events: readonly UsageEvent[]): bigint {
  return events.flatMap((event) => event.quantities).reduce((sum, quantity) => sum + BigInt(quantity.quantity), 0n);
}

export function money(minor: string | null, currency: string, locale: string): string {
  if (minor === null) return "—";
  const value = BigInt(minor);
  const safe = Number(value) / 100;
  return Number.isSafeInteger(Number(value))
    ? new Intl.NumberFormat(locale, { style: "currency", currency }).format(safe)
    : `${minor} ${currency}`;
}

export function coverageTone(state: UsageCost["state"] | "missing") {
  return state === "priced" ? "tone-active" : state === "partial" ? "tone-warning" : "tone-danger";
}

export function budgetIssue(evaluation: UsageBudgetEvaluation, now = new Date(evaluation.observedThrough)) {
  if (evaluation.hasMissingValuation) return { kind: "valuations" as const, count: 1 };
  const stale = evaluation.sources.filter(
    (source) =>
      source.required &&
      (!source.lastCompleteAt ||
        now.getTime() - new Date(source.lastCompleteAt).getTime() > source.maxAgeMinutes * 60_000)
  ).length;
  return stale > 0 ? { kind: "sources" as const, count: stale } : null;
}

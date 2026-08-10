export const OPPORTUNITY_PROBABILITY_STEP = 10;

export type OpportunityProbabilityBand = "low" | "medium" | "high";

export function adjustOpportunityProbability(value: number, direction: -1 | 1): number {
  return Math.min(100, Math.max(0, value + direction * OPPORTUNITY_PROBABILITY_STEP));
}

export function opportunityProbabilityBand(value: number): OpportunityProbabilityBand {
  if (value < 40) return "low";
  if (value < 70) return "medium";
  return "high";
}

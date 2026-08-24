export type UsageUnit =
  | "input_token"
  | "output_token"
  | "cached_input_token"
  | "request"
  | "image"
  | "audio_second"
  | "compute_millisecond"
  | "byte"
  | "provider_unit";

export type UsageMoney = { currency: string; amountMinor: bigint };

export type UsageRateTier = {
  /** Inclusive cumulative quantity where this tier ends; null is the unbounded final tier. */
  upTo: bigint | null;
  priceMinor: bigint;
};

export type UsageRate = {
  currency: string;
  unit: UsageUnit;
  /** How many units `priceMinor` buys. */
  unitSize: bigint;
  effectiveFrom: string;
  tiers: readonly UsageRateTier[];
};

export type UsageCostResolution =
  | { source: "reported"; cost: UsageMoney; rate: null }
  | { source: "rated"; cost: UsageMoney; rate: UsageRate }
  | { source: "unpriced"; cost: null; rate: null };

export type UsageBudgetState = "healthy" | "warning" | "exceeded" | "stale" | "partial";

export class UsageError extends Error {
  constructor(
    public readonly code:
      "INVALID_DENOMINATOR" | "INVALID_QUANTITY" | "INVALID_RATE" | "INVALID_TIERS" | "INVALID_DATE" | "INVALID_BUDGET"
  ) {
    super(code);
    this.name = "UsageError";
  }
}

/** Integer division rounded to nearest, with exact halves moving away from zero. */
export function roundHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new UsageError("INVALID_DENOMINATOR");
  const negative = numerator < 0n;
  const absolute = negative ? -numerator : numerator;
  let quotient = absolute / denominator;
  const remainder = absolute % denominator;
  if (remainder * 2n >= denominator) quotient += 1n;
  return negative ? -quotient : quotient;
}

export function convertMinor(amountMinor: bigint, rate: { numerator: bigint; denominator: bigint }): bigint {
  if (rate.numerator <= 0n) throw new UsageError("INVALID_RATE");
  return roundHalfUp(amountMinor * rate.numerator, rate.denominator);
}

function dateValue(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new UsageError("INVALID_DATE");
  return parsed;
}

/** Latest non-annulled rate whose effective instant is not later than the usage. */
export function rateAt(rates: readonly UsageRate[], occurredAt: string): UsageRate | null {
  const occurred = dateValue(occurredAt);
  let selected: UsageRate | null = null;
  let selectedAt = Number.NEGATIVE_INFINITY;
  for (const rate of rates) {
    const effective = dateValue(rate.effectiveFrom);
    if (effective <= occurred && effective > selectedAt) {
      selected = rate;
      selectedAt = effective;
    }
  }
  return selected;
}

function validateRate(rate: UsageRate): void {
  if (!/^[A-Z]{3}$/.test(rate.currency) || rate.unitSize <= 0n || rate.tiers.length === 0)
    throw new UsageError("INVALID_RATE");

  let previous = 0n;
  for (let index = 0; index < rate.tiers.length; index += 1) {
    const tier = rate.tiers[index]!;
    if (tier.priceMinor < 0n) throw new UsageError("INVALID_TIERS");
    if (tier.upTo === null) {
      if (index !== rate.tiers.length - 1) throw new UsageError("INVALID_TIERS");
      continue;
    }
    if (tier.upTo <= previous || index === rate.tiers.length - 1) throw new UsageError("INVALID_TIERS");
    previous = tier.upTo;
  }
  if (rate.tiers.at(-1)?.upTo !== null) throw new UsageError("INVALID_TIERS");
}

/** Progressive tier valuation, rounded once for the complete quantity line. */
export function tieredCostMinor(quantity: bigint, rate: UsageRate): bigint {
  if (quantity < 0n) throw new UsageError("INVALID_QUANTITY");
  validateRate(rate);
  if (quantity === 0n) return 0n;

  let previousLimit = 0n;
  let numerator = 0n;
  for (const tier of rate.tiers) {
    if (quantity <= previousLimit) break;
    const tierEnd = tier.upTo === null || tier.upTo > quantity ? quantity : tier.upTo;
    numerator += (tierEnd - previousLimit) * tier.priceMinor;
    previousLimit = tierEnd;
  }
  return roundHalfUp(numerator, rate.unitSize);
}

export function resolveUsageCost(input: {
  occurredAt: string;
  unit: UsageUnit;
  quantity: bigint;
  reportedCost: UsageMoney | null;
  rates: readonly UsageRate[];
}): UsageCostResolution {
  if (input.quantity < 0n) throw new UsageError("INVALID_QUANTITY");
  if (input.reportedCost) {
    if (!/^[A-Z]{3}$/.test(input.reportedCost.currency) || input.reportedCost.amountMinor < 0n)
      throw new UsageError("INVALID_RATE");
    return { source: "reported", cost: input.reportedCost, rate: null };
  }

  const rate = rateAt(
    input.rates.filter((candidate) => candidate.unit === input.unit),
    input.occurredAt
  );
  if (!rate) return { source: "unpriced", cost: null, rate: null };
  return {
    source: "rated",
    cost: { currency: rate.currency, amountMinor: tieredCostMinor(input.quantity, rate) },
    rate
  };
}

export function usageBudgetState(input: {
  spentMinor: bigint;
  budgetMinor: bigint;
  warningBasisPoints: number;
  now: Date;
  sources: readonly { required: boolean; lastCompleteAt: Date | null; maxAgeMinutes: number }[];
  hasMissingValuation: boolean;
}): UsageBudgetState {
  if (
    input.spentMinor < 0n ||
    input.budgetMinor <= 0n ||
    !Number.isInteger(input.warningBasisPoints) ||
    input.warningBasisPoints < 0 ||
    input.warningBasisPoints > 10_000 ||
    input.sources.length === 0 ||
    input.sources.some((source) => !Number.isSafeInteger(source.maxAgeMinutes) || source.maxAgeMinutes <= 0)
  )
    throw new UsageError("INVALID_BUDGET");

  const stale = (source: (typeof input.sources)[number]) =>
    source.lastCompleteAt === null ||
    input.now.getTime() - source.lastCompleteAt.getTime() > source.maxAgeMinutes * 60_000;

  if (input.sources.some((source) => source.required && stale(source))) return "stale";
  if (input.hasMissingValuation || input.sources.some((source) => !source.required && stale(source))) return "partial";
  if (input.spentMinor >= input.budgetMinor) return "exceeded";
  if (input.spentMinor * 10_000n >= input.budgetMinor * BigInt(input.warningBasisPoints)) return "warning";
  return "healthy";
}

import {
  convertMinor,
  hasPermission,
  rateAt,
  tieredCostMinor,
  usageBudgetState,
  type TenantContext,
  type UsageBudgetState,
  type UsageRate,
  type UsageUnit
} from "@control-hub/domain";

export type UsageEventInput = {
  sourceId: string;
  externalId: string;
  occurredAt: Date;
  operation: string;
  sku: string;
  status: "observed" | "estimated" | "void";
  quantities: ReadonlyArray<{ unit: UsageUnit; quantity: bigint; qualifier?: string }>;
  reportedCost?: { amountMinor: bigint; currency: string };
  customerId?: string;
  productId?: string;
  customerServiceId?: string;
  projectId?: string;
};
export type UsageEventRecord = UsageEventInput & { id: string; createdAt: Date };
export type UsageCostRecord = {
  id: string;
  eventId: string | null;
  adjustmentId: string | null;
  state: "priced" | "unpriced" | "partial";
  originalCostMinor: bigint | null;
  originalCurrency: string | null;
  reportCostMinor: bigint | null;
  reportCurrency: string;
};
export type UsageListQuery = { eventId?: string; from?: Date; to?: Date; limit?: number };
export type UsageSourceRecord = {
  id: string;
  instanceId: string;
  operation: string;
  lastCompleteAt: Date | null;
};
export type UsageRateInput = {
  provider: string;
  sku: string;
  unit: UsageUnit;
  unitSize: bigint;
  currency: string;
  effectiveFrom: Date;
  tiers: ReadonlyArray<{ startsAt: bigint; priceMinor: bigint }>;
};
export type UsageRateRecord = UsageRateInput & { id: string; annulledAt: Date | null };
export type UsageBudgetInput = {
  name: string;
  amountMinor: bigint;
  currency: string;
  period: "monthly" | "quarterly" | "annual";
  warningBasisPoints: number;
  sources: ReadonlyArray<{ sourceId: string; required: boolean; maxAgeMinutes: number }>;
  customerId?: string;
  productId?: string;
  customerServiceId?: string;
  projectId?: string;
};
export type UsageExchangeRateInput = {
  baseCurrency: string;
  quoteCurrency: string;
  rateDay: string;
  numerator: bigint;
  denominator: bigint;
  source: string;
};
export type UsageExchangeRateRecord = UsageExchangeRateInput & { id: string; annulledAt: Date | null };
export type UsageBudgetRecord = UsageBudgetInput & { id: string; enabled: boolean };
export type UsageRateEvidence = UsageRate & { id: string };
export type UsageValuationEvidence = {
  event: UsageEventRecord;
  provider: string;
  quantities: ReadonlyArray<{ id: string; unit: UsageUnit; qualifier: string; quantity: bigint }>;
  rates: readonly UsageRateEvidence[];
  exchangeRates: ReadonlyArray<{
    id: string;
    baseCurrency: string;
    quoteCurrency: string;
    rateDay: string;
    numerator: bigint;
    denominator: bigint;
  }>;
};
export type UsageValuationLineInput = {
  quantityId: string;
  unit: UsageUnit;
  qualifier: string;
  quantity: bigint;
  originalCostMinor: bigint | null;
  originalCurrency: string | null;
  reportCostMinor: bigint | null;
  reportCurrency: string;
  rateId: string | null;
  exchangeRateId: string | null;
  state: "priced" | "unpriced" | "partial";
  missing: "rate" | "exchange_rate" | null;
};
export type UsageValuationInput = {
  eventId: string;
  state: "priced" | "unpriced" | "partial";
  originalCostMinor: bigint | null;
  originalCurrency: string | null;
  reportCostMinor: bigint | null;
  reportCurrency: string;
  missing: readonly string[];
  lines: readonly UsageValuationLineInput[];
};
export type UsageBudgetEvidence = {
  budgetId: string;
  amountMinor: bigint;
  currency: string;
  warningBasisPoints: number;
  periodStart: string;
  spentMinor: bigint;
  hasMissingValuation: boolean;
  sources: ReadonlyArray<{ required: boolean; lastCompleteAt: Date | null; maxAgeMinutes: number }>;
};
export type UsageBudgetEvaluation = UsageBudgetEvidence & {
  state: UsageBudgetState;
  observedThrough: Date;
};

export interface UsageRepository {
  ensureConnectorSource(
    context: TenantContext,
    input: { instanceId: string; operation: string }
  ): Promise<UsageSourceRecord>;
  completeSource(context: TenantContext, sourceId: string, completedAt: Date): Promise<void>;
  ingestEvent(context: TenantContext, input: UsageEventInput): Promise<{ record: UsageEventRecord; inserted: boolean }>;
  listEvents(context: TenantContext, query: UsageListQuery): Promise<UsageEventRecord[]>;
  listCosts(context: TenantContext, query: UsageListQuery): Promise<UsageCostRecord[]>;
  createRate(context: TenantContext, input: UsageRateInput): Promise<{ id: string }>;
  listRates(context: TenantContext): Promise<UsageRateRecord[]>;
  annulRate(context: TenantContext, rateId: string): Promise<boolean>;
  createExchangeRate(context: TenantContext, input: UsageExchangeRateInput): Promise<{ id: string }>;
  listExchangeRates(context: TenantContext): Promise<UsageExchangeRateRecord[]>;
  annulExchangeRate(context: TenantContext, exchangeRateId: string): Promise<boolean>;
  valuationEvidence(
    context: TenantContext,
    eventId: string,
    reportCurrency: string
  ): Promise<UsageValuationEvidence | null>;
  saveValuation(context: TenantContext, input: UsageValuationInput): Promise<UsageCostRecord & { version: number }>;
  createBudget(context: TenantContext, input: UsageBudgetInput): Promise<{ id: string }>;
  listBudgets(context: TenantContext): Promise<UsageBudgetRecord[]>;
  budgetEvidence(context: TenantContext, budgetId: string, at: Date): Promise<UsageBudgetEvidence | null>;
  recordBudgetState(context: TenantContext, evaluation: UsageBudgetEvaluation): Promise<{ changed: boolean }>;
  finalizeMonthlySnapshot(
    context: TenantContext,
    input: { month: string; reportCurrency: string; finalizedAt: Date }
  ): Promise<{ revision: number; rows: number }>;
}

export class UsageServiceError extends Error {
  constructor(public readonly code: "FORBIDDEN" | "INVALID_INPUT" | "NOT_FOUND" | "INCOMPLETE_EVIDENCE") {
    super(code);
  }
}

export class UsageService {
  constructor(private readonly repository: UsageRepository) {}
  private require(
    context: TenantContext,
    permission: "usage:read" | "financials:read" | "usage:manage" | "budgets:manage"
  ) {
    if (!hasPermission(context, permission)) throw new UsageServiceError("FORBIDDEN");
  }
  ingestEvent(context: TenantContext, input: UsageEventInput) {
    this.require(context, "usage:manage");
    return this.repository.ingestEvent(context, input);
  }
  ensureConnectorSource(context: TenantContext, input: { instanceId: string; operation: string }) {
    this.require(context, "usage:manage");
    return this.repository.ensureConnectorSource(context, input);
  }
  completeSource(context: TenantContext, sourceId: string, completedAt: Date) {
    this.require(context, "usage:manage");
    return this.repository.completeSource(context, sourceId, completedAt);
  }
  listEvents(context: TenantContext, query: UsageListQuery = {}) {
    this.require(context, "usage:read");
    return this.repository.listEvents(context, query);
  }
  listCosts(context: TenantContext, query: UsageListQuery = {}) {
    this.require(context, "financials:read");
    return this.repository.listCosts(context, query);
  }
  createRate(context: TenantContext, input: UsageRateInput) {
    this.require(context, "usage:manage");
    validateRateInput(input);
    return this.repository.createRate(context, input);
  }
  listRates(context: TenantContext) {
    this.require(context, "financials:read");
    return this.repository.listRates(context);
  }
  annulRate(context: TenantContext, rateId: string) {
    this.require(context, "usage:manage");
    return this.repository.annulRate(context, rateId);
  }
  createExchangeRate(context: TenantContext, input: UsageExchangeRateInput) {
    this.require(context, "usage:manage");
    if (
      !currency(input.baseCurrency) ||
      !currency(input.quoteCurrency) ||
      input.baseCurrency === input.quoteCurrency ||
      !/^\d{4}-\d{2}-\d{2}$/.test(input.rateDay) ||
      input.numerator <= 0n ||
      input.denominator <= 0n ||
      input.source.trim().length < 1 ||
      input.source.length > 200
    )
      throw new UsageServiceError("INVALID_INPUT");
    return this.repository.createExchangeRate(context, input);
  }
  listExchangeRates(context: TenantContext) {
    this.require(context, "financials:read");
    return this.repository.listExchangeRates(context);
  }
  annulExchangeRate(context: TenantContext, exchangeRateId: string) {
    this.require(context, "usage:manage");
    return this.repository.annulExchangeRate(context, exchangeRateId);
  }
  async valueEvent(context: TenantContext, eventId: string, reportCurrency: string) {
    this.require(context, "usage:manage");
    if (!currency(reportCurrency)) throw new UsageServiceError("INVALID_INPUT");
    const evidence = await this.repository.valuationEvidence(context, eventId, reportCurrency);
    if (!evidence) throw new UsageServiceError("NOT_FOUND");
    return this.repository.saveValuation(context, buildUsageValuation(evidence, reportCurrency));
  }
  createBudget(context: TenantContext, input: UsageBudgetInput) {
    this.require(context, "budgets:manage");
    if (
      !input.name.trim() ||
      input.amountMinor <= 0n ||
      !currency(input.currency) ||
      input.warningBasisPoints < 1 ||
      input.warningBasisPoints >= 10_000 ||
      input.sources.length < 1 ||
      input.sources.some((source) => !Number.isSafeInteger(source.maxAgeMinutes) || source.maxAgeMinutes < 1) ||
      [input.customerId, input.productId, input.customerServiceId, input.projectId].filter(Boolean).length > 1
    )
      throw new UsageServiceError("INVALID_INPUT");
    return this.repository.createBudget(context, input);
  }
  listBudgets(context: TenantContext) {
    this.require(context, "financials:read");
    return this.repository.listBudgets(context);
  }
  async evaluateBudget(context: TenantContext, budgetId: string, at = new Date()) {
    this.require(context, "financials:read");
    const evidence = await this.repository.budgetEvidence(context, budgetId, at);
    if (!evidence) throw new UsageServiceError("NOT_FOUND");
    const evaluation: UsageBudgetEvaluation = {
      ...evidence,
      observedThrough: at,
      state: usageBudgetState({
        spentMinor: evidence.spentMinor,
        budgetMinor: evidence.amountMinor,
        warningBasisPoints: evidence.warningBasisPoints,
        now: at,
        sources: evidence.sources,
        hasMissingValuation: evidence.hasMissingValuation
      })
    };
    await this.repository.recordBudgetState(context, evaluation);
    return evaluation;
  }
  async finalizeMonthlySnapshot(
    context: TenantContext,
    month: string,
    reportCurrency: string,
    finalizedAt = new Date()
  ) {
    this.require(context, "usage:manage");
    if (!/^\d{4}-\d{2}-01$/.test(month) || !currency(reportCurrency)) throw new UsageServiceError("INVALID_INPUT");
    try {
      return await this.repository.finalizeMonthlySnapshot(context, { month, reportCurrency, finalizedAt });
    } catch (error) {
      if (error instanceof Error && error.message === "USAGE_SNAPSHOT_INCOMPLETE_EVIDENCE")
        throw new UsageServiceError("INCOMPLETE_EVIDENCE");
      throw error;
    }
  }
}

function currency(value: string): boolean {
  return /^[A-Z]{3}$/.test(value);
}

function validateRateInput(input: UsageRateInput): void {
  if (
    !input.provider.trim() ||
    !input.sku.trim() ||
    input.unitSize <= 0n ||
    !currency(input.currency) ||
    Number.isNaN(input.effectiveFrom.getTime()) ||
    input.tiers.length < 1 ||
    input.tiers[0]?.startsAt !== 0n ||
    input.tiers.some(
      (tier, index) => tier.priceMinor < 0n || (index > 0 && tier.startsAt <= input.tiers[index - 1]!.startsAt)
    )
  )
    throw new UsageServiceError("INVALID_INPUT");
}

function exchangeFor(evidence: UsageValuationEvidence, base: string, quote: string) {
  const day = evidence.event.occurredAt.toISOString().slice(0, 10);
  return evidence.exchangeRates.find(
    (rate) => rate.baseCurrency === base && rate.quoteCurrency === quote && rate.rateDay === day
  );
}

export function buildUsageValuation(evidence: UsageValuationEvidence, reportCurrency: string): UsageValuationInput {
  if (evidence.event.reportedCost) {
    const original = evidence.event.reportedCost;
    const exchange =
      original.currency === reportCurrency ? null : exchangeFor(evidence, original.currency, reportCurrency);
    return {
      eventId: evidence.event.id,
      state: original.currency === reportCurrency || exchange ? "priced" : "partial",
      originalCostMinor: original.amountMinor,
      originalCurrency: original.currency,
      reportCostMinor:
        original.currency === reportCurrency
          ? original.amountMinor
          : exchange
            ? convertMinor(original.amountMinor, exchange)
            : null,
      reportCurrency,
      missing: exchange || original.currency === reportCurrency ? [] : ["exchange_rate"],
      lines: []
    };
  }

  const lines: UsageValuationLineInput[] = evidence.quantities.map((quantity) => {
    const candidates = evidence.rates.filter((candidate) => candidate.unit === quantity.unit);
    const selected = rateAt(candidates, evidence.event.occurredAt.toISOString()) as UsageRateEvidence | null;
    if (!selected)
      return {
        quantityId: quantity.id,
        unit: quantity.unit,
        qualifier: quantity.qualifier,
        quantity: quantity.quantity,
        originalCostMinor: null,
        originalCurrency: null,
        reportCostMinor: null,
        reportCurrency,
        rateId: null,
        exchangeRateId: null,
        state: "unpriced",
        missing: "rate"
      };
    const originalCostMinor = tieredCostMinor(quantity.quantity, selected);
    const exchange =
      selected.currency === reportCurrency ? null : exchangeFor(evidence, selected.currency, reportCurrency);
    return {
      quantityId: quantity.id,
      unit: quantity.unit,
      qualifier: quantity.qualifier,
      quantity: quantity.quantity,
      originalCostMinor,
      originalCurrency: selected.currency,
      reportCostMinor:
        selected.currency === reportCurrency
          ? originalCostMinor
          : exchange
            ? convertMinor(originalCostMinor, exchange)
            : null,
      reportCurrency,
      rateId: selected.id,
      exchangeRateId: exchange?.id ?? null,
      state: selected.currency === reportCurrency || exchange ? "priced" : "partial",
      missing: selected.currency === reportCurrency || exchange ? null : "exchange_rate"
    };
  });
  const priced = lines.filter((line) => line.state === "priced");
  const state =
    priced.length === lines.length
      ? "priced"
      : priced.length === 0 && lines.every((line) => line.state === "unpriced")
        ? "unpriced"
        : "partial";
  const originalCurrencies = new Set(lines.flatMap((line) => (line.originalCurrency ? [line.originalCurrency] : [])));
  const completeOriginal = lines.every((line) => line.originalCostMinor !== null) && originalCurrencies.size === 1;
  return {
    eventId: evidence.event.id,
    state,
    originalCostMinor: completeOriginal ? lines.reduce((sum, line) => sum + line.originalCostMinor!, 0n) : null,
    originalCurrency: completeOriginal ? [...originalCurrencies][0]! : null,
    reportCostMinor: lines.every((line) => line.reportCostMinor !== null)
      ? lines.reduce((sum, line) => sum + line.reportCostMinor!, 0n)
      : null,
    reportCurrency,
    missing: [...new Set(lines.flatMap((line) => (line.missing ? [line.missing] : [])))],
    lines
  };
}

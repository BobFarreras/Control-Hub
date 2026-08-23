import { hasPermission, type TenantContext, type UsageUnit } from "@control-hub/domain";

export type UsageEventInput = {
  sourceId: string;
  externalId: string;
  occurredAt: Date;
  operation: string;
  sku: string;
  status: "observed" | "estimated" | "void";
  quantities: ReadonlyArray<{ unit: UsageUnit; quantity: bigint; qualifier?: string }>;
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
export type UsageRateInput = {
  provider: string;
  sku: string;
  unit: UsageUnit;
  unitSize: bigint;
  currency: string;
  effectiveFrom: Date;
  tiers: ReadonlyArray<{ startsAt: bigint; priceMinor: bigint }>;
};
export type UsageBudgetInput = {
  name: string;
  amountMinor: bigint;
  currency: string;
  period: "monthly" | "quarterly" | "annual";
  warningBasisPoints: number;
};

export interface UsageRepository {
  ingestEvent(context: TenantContext, input: UsageEventInput): Promise<{ record: UsageEventRecord; inserted: boolean }>;
  listEvents(context: TenantContext, query: UsageListQuery): Promise<UsageEventRecord[]>;
  listCosts(context: TenantContext, query: UsageListQuery): Promise<UsageCostRecord[]>;
  createRate(context: TenantContext, input: UsageRateInput): Promise<{ id: string }>;
  createBudget(context: TenantContext, input: UsageBudgetInput): Promise<{ id: string }>;
}

export class UsageServiceError extends Error {
  constructor(public readonly code: "FORBIDDEN" | "INVALID_INPUT") {
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
    return this.repository.createRate(context, input);
  }
  createBudget(context: TenantContext, input: UsageBudgetInput) {
    this.require(context, "budgets:manage");
    return this.repository.createBudget(context, input);
  }
}

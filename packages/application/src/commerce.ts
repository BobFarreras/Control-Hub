import {
  billingIntervals,
  commercialModels,
  isCommercialIntervalAllowed,
  monthlyFromAnnualMinor,
  recurringMetrics,
  subscriptionStatuses,
  type BillingInterval,
  type CommercialModel,
  type SubscriptionStatus,
  type TenantContext
} from "@control-hub/domain";

export type ProductRecord = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  status: "active" | "archived";
  createdAt: Date;
  updatedAt: Date;
};
export type ProductVersionRecord = {
  id: string;
  productId: string;
  version: string;
  status: "draft" | "active" | "retired";
  releasedAt: Date | null;
  releaseNotes: string | null;
  features: string[];
  contents: string[];
  schemaDocument: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
};
export type ProductResourceKind = "information" | "documentation" | "diagram" | "repository" | "demo";
export type ProductResourceRecord = {
  id: string;
  productId: string;
  productVersionId: string | null;
  kind: ProductResourceKind;
  label: string;
  url: string;
  createdAt: Date;
  updatedAt: Date;
};
export type ProductCustomerRecord = {
  serviceId: string;
  customerId: string;
  customerName: string;
  planName: string;
  commercialModel: CommercialModel;
  status: "active" | "paused" | "completed" | "canceled";
  quantity: number;
  startsAt: Date;
  endsAt: Date | null;
};
export type PlanRecord = {
  id: string;
  productVersionId: string;
  code: string;
  name: string;
  description: string | null;
  commercialModel: CommercialModel;
  status: "active" | "archived";
  createdAt: Date;
};
export type PriceRecord = {
  id: string;
  planId: string;
  currency: string;
  amountMinor: number;
  costMinor: number;
  taxBasisPoints: number;
  interval: BillingInterval;
  effectiveFrom: Date;
  createdAt: Date;
};
export type Catalog = {
  products: ProductRecord[];
  versions: ProductVersionRecord[];
  plans: PlanRecord[];
  prices: PriceRecord[];
};
export type ProductOfferRecord = {
  product: ProductRecord;
  version: ProductVersionRecord;
  plan: PlanRecord;
  price: PriceRecord;
};
export type ProductCatalogDetail = Catalog & {
  product: ProductRecord;
  resources: ProductResourceRecord[];
  customers: ProductCustomerRecord[];
};
export type ProductOfferInput = {
  product: { code: string; name: string; description?: string };
  version: { version: string };
  plan: { code: string; name: string; description?: string; commercialModel: CommercialModel };
  price: {
    currency: string;
    amountMinor: number;
    costMinor: number;
    taxBasisPoints: number;
    interval: BillingInterval;
    effectiveFrom?: Date;
  };
};
export type SubscriptionRecord = {
  id: string;
  customerId: string;
  customerName: string;
  planId: string;
  planName: string;
  priceId: string;
  status: SubscriptionStatus;
  quantity: number;
  startedAt: Date;
  currentPeriodStart: Date;
  renewalAt: Date | null;
  renewalAlertDays: number;
  pausedAt: Date | null;
  canceledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};
export type RenewalAlert = {
  subscriptionId: string;
  customerName: string;
  planName: string;
  renewalAt: Date;
  daysRemaining: number;
};
export type FinancialInput = {
  currency: string;
  amountMinor: number;
  costMinor: number;
  interval: BillingInterval;
  quantity: number;
};
export type FinancialMetric = {
  currency: string;
  mrrMinor: number;
  arrMinor: number;
  annualCostMinor: number;
  annualMarginMinor: number;
  activeSubscriptions: number;
};

export class CommerceError extends Error {
  constructor(
    public readonly code:
      | "INVALID_INPUT"
      | "PRODUCT_NOT_FOUND"
      | "VERSION_NOT_FOUND"
      | "PLAN_NOT_FOUND"
      | "PRICE_NOT_FOUND"
      | "CUSTOMER_NOT_FOUND"
      | "SUBSCRIPTION_NOT_FOUND"
      | "INVALID_SUBSCRIPTION_TRANSITION"
      | "CONCURRENT_MODIFICATION"
      | "DUPLICATE_CODE"
  ) {
    super(code);
  }
}

export interface CommerceRepository {
  catalog(context: TenantContext): Promise<Catalog>;
  productDetail(context: TenantContext, productId: string): Promise<ProductCatalogDetail>;
  updateProduct(
    context: TenantContext,
    productId: string,
    input: { name: string; description?: string; status: "active" | "archived"; expectedUpdatedAt: Date }
  ): Promise<ProductRecord>;
  updateVersionKnowledge(
    context: TenantContext,
    versionId: string,
    input: {
      releaseNotes?: string;
      features: string[];
      contents: string[];
      schemaDocument?: Record<string, unknown>;
      expectedUpdatedAt: Date;
    }
  ): Promise<ProductVersionRecord>;
  replaceProductResources(
    context: TenantContext,
    productId: string,
    resources: Array<{
      productVersionId?: string;
      kind: ProductResourceKind;
      label: string;
      url: string;
    }>
  ): Promise<ProductResourceRecord[]>;
  createProduct(
    context: TenantContext,
    input: { code: string; name: string; description?: string }
  ): Promise<ProductRecord>;
  createVersion(
    context: TenantContext,
    productId: string,
    input: { version: string; status: "draft" | "active"; releasedAt?: Date }
  ): Promise<ProductVersionRecord>;
  createPlan(
    context: TenantContext,
    productVersionId: string,
    input: { code: string; name: string; description?: string; commercialModel?: CommercialModel }
  ): Promise<PlanRecord>;
  createPrice(
    context: TenantContext,
    planId: string,
    input: {
      currency: string;
      amountMinor: number;
      costMinor: number;
      taxBasisPoints: number;
      interval: BillingInterval;
      effectiveFrom: Date;
    }
  ): Promise<PriceRecord>;
  createProductOffer(
    context: TenantContext,
    input: ProductOfferInput & {
      version: ProductOfferInput["version"] & { releasedAt: Date };
      price: ProductOfferInput["price"] & { effectiveFrom: Date };
    }
  ): Promise<ProductOfferRecord>;
  listSubscriptions(context: TenantContext): Promise<SubscriptionRecord[]>;
  createSubscription(
    context: TenantContext,
    input: {
      customerId: string;
      planId: string;
      priceId: string;
      quantity: number;
      startedAt: Date;
      renewalAt?: Date;
      renewalAlertDays: number;
    }
  ): Promise<SubscriptionRecord>;
  transitionSubscription(
    context: TenantContext,
    subscriptionId: string,
    status: SubscriptionStatus,
    effectiveAt: Date
  ): Promise<SubscriptionRecord>;
  changePlan(
    context: TenantContext,
    subscriptionId: string,
    input: { planId: string; priceId: string; effectiveAt: Date; renewalAt?: Date }
  ): Promise<SubscriptionRecord>;
  renewSubscription(context: TenantContext, subscriptionId: string, effectiveAt: Date): Promise<SubscriptionRecord>;
  renewalAlerts(context: TenantContext, now: Date): Promise<RenewalAlert[]>;
  financialInputs(context: TenantContext): Promise<FinancialInput[]>;
}

const codePattern = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/;
function required(value: string, max: number) {
  const normalized = value.trim();
  if (!normalized || normalized.length > max) throw new CommerceError("INVALID_INPUT");
  return normalized;
}
function code(value: string) {
  const normalized = value.trim().toLowerCase();
  if (!codePattern.test(normalized)) throw new CommerceError("INVALID_INPUT");
  return normalized;
}

function normalizedPrice(
  input: ProductOfferInput["price"],
  commercialModel?: CommercialModel
): ProductOfferInput["price"] & { effectiveFrom: Date } {
  const currency = input.currency.trim().toUpperCase();
  if (
    !/^[A-Z]{3}$/.test(currency) ||
    !billingIntervals.includes(input.interval) ||
    !Number.isSafeInteger(input.amountMinor) ||
    input.amountMinor < 0 ||
    !Number.isSafeInteger(input.costMinor) ||
    input.costMinor < 0 ||
    !Number.isInteger(input.taxBasisPoints) ||
    input.taxBasisPoints < 0 ||
    input.taxBasisPoints > 10000 ||
    (input.interval === "free" && input.amountMinor !== 0) ||
    (commercialModel !== undefined && !isCommercialIntervalAllowed(commercialModel, input.interval))
  )
    throw new CommerceError("INVALID_INPUT");
  return { ...input, currency, effectiveFrom: input.effectiveFrom ?? new Date() };
}

export class CommerceService {
  constructor(private readonly repository: CommerceRepository) {}
  catalog(context: TenantContext) {
    return this.repository.catalog(context);
  }
  productDetail(context: TenantContext, productId: string) {
    return this.repository.productDetail(context, productId);
  }
  updateProduct(
    context: TenantContext,
    productId: string,
    input: { name: string; description?: string; status: "active" | "archived"; expectedUpdatedAt: Date }
  ) {
    if (!["active", "archived"].includes(input.status) || Number.isNaN(input.expectedUpdatedAt.getTime()))
      throw new CommerceError("INVALID_INPUT");
    return this.repository.updateProduct(context, productId, {
      name: required(input.name, 160),
      ...(input.description?.trim() ? { description: required(input.description, 2000) } : {}),
      status: input.status,
      expectedUpdatedAt: input.expectedUpdatedAt
    });
  }
  updateVersionKnowledge(
    context: TenantContext,
    versionId: string,
    input: {
      releaseNotes?: string;
      features: string[];
      contents: string[];
      schemaDocument?: Record<string, unknown>;
      expectedUpdatedAt: Date;
    }
  ) {
    const list = (values: string[]) => {
      if (values.length > 100) throw new CommerceError("INVALID_INPUT");
      return values.map((value) => required(value, 500));
    };
    if (Number.isNaN(input.expectedUpdatedAt.getTime())) throw new CommerceError("INVALID_INPUT");
    return this.repository.updateVersionKnowledge(context, versionId, {
      ...(input.releaseNotes?.trim() ? { releaseNotes: required(input.releaseNotes, 10000) } : {}),
      features: list(input.features),
      contents: list(input.contents),
      ...(input.schemaDocument ? { schemaDocument: input.schemaDocument } : {}),
      expectedUpdatedAt: input.expectedUpdatedAt
    });
  }
  replaceProductResources(
    context: TenantContext,
    productId: string,
    resources: Array<{ productVersionId?: string; kind: ProductResourceKind; label: string; url: string }>
  ) {
    if (resources.length > 50) throw new CommerceError("INVALID_INPUT");
    const kinds: ProductResourceKind[] = ["information", "documentation", "diagram", "repository", "demo"];
    return this.repository.replaceProductResources(
      context,
      productId,
      resources.map((resource) => {
        if (!kinds.includes(resource.kind)) throw new CommerceError("INVALID_INPUT");
        let url: URL;
        try {
          url = new URL(resource.url);
        } catch {
          throw new CommerceError("INVALID_INPUT");
        }
        if (url.protocol !== "https:" || url.username || url.password) throw new CommerceError("INVALID_INPUT");
        return {
          ...(resource.productVersionId ? { productVersionId: resource.productVersionId } : {}),
          kind: resource.kind,
          label: required(resource.label, 160),
          url: url.toString()
        };
      })
    );
  }
  listSubscriptions(context: TenantContext) {
    return this.repository.listSubscriptions(context);
  }
  renewalAlerts(context: TenantContext, now = new Date()) {
    return this.repository.renewalAlerts(context, now);
  }
  createProduct(context: TenantContext, input: { code: string; name: string; description?: string }) {
    return this.repository.createProduct(context, {
      code: code(input.code),
      name: required(input.name, 160),
      ...(input.description?.trim() ? { description: required(input.description, 2000) } : {})
    });
  }
  createProductOffer(context: TenantContext, input: ProductOfferInput) {
    const releasedAt = new Date();
    return this.repository.createProductOffer(context, {
      product: {
        code: code(input.product.code),
        name: required(input.product.name, 160),
        ...(input.product.description?.trim() ? { description: required(input.product.description, 2000) } : {})
      },
      version: { version: required(input.version.version, 80), releasedAt },
      plan: {
        code: code(input.plan.code),
        name: required(input.plan.name, 160),
        commercialModel: input.plan.commercialModel,
        ...(input.plan.description?.trim() ? { description: required(input.plan.description, 2000) } : {})
      },
      price: normalizedPrice(input.price, input.plan.commercialModel)
    });
  }
  createVersion(
    context: TenantContext,
    productId: string,
    input: { version: string; status: "draft" | "active"; releasedAt?: Date }
  ) {
    return this.repository.createVersion(context, productId, { ...input, version: required(input.version, 80) });
  }
  createPlan(
    context: TenantContext,
    productVersionId: string,
    input: { code: string; name: string; description?: string; commercialModel?: CommercialModel }
  ) {
    const commercialModel = input.commercialModel ?? "subscription";
    if (!commercialModels.includes(commercialModel)) throw new CommerceError("INVALID_INPUT");
    return this.repository.createPlan(context, productVersionId, {
      code: code(input.code),
      name: required(input.name, 160),
      commercialModel,
      ...(input.description?.trim() ? { description: required(input.description, 2000) } : {})
    });
  }
  createPrice(
    context: TenantContext,
    planId: string,
    input: {
      currency: string;
      amountMinor: number;
      costMinor: number;
      taxBasisPoints: number;
      interval: BillingInterval;
      effectiveFrom?: Date;
    }
  ) {
    return this.repository.createPrice(context, planId, normalizedPrice(input));
  }
  createSubscription(
    context: TenantContext,
    input: {
      customerId: string;
      planId: string;
      priceId: string;
      quantity: number;
      startedAt?: Date;
      renewalAt?: Date;
      renewalAlertDays?: number;
    }
  ) {
    if (
      !Number.isSafeInteger(input.quantity) ||
      input.quantity < 1 ||
      input.quantity > 1_000_000 ||
      !Number.isInteger(input.renewalAlertDays ?? 14) ||
      (input.renewalAlertDays ?? 14) < 0 ||
      (input.renewalAlertDays ?? 14) > 365
    )
      throw new CommerceError("INVALID_INPUT");
    return this.repository.createSubscription(context, {
      ...input,
      startedAt: input.startedAt ?? new Date(),
      renewalAlertDays: input.renewalAlertDays ?? 14
    });
  }
  transitionSubscription(
    context: TenantContext,
    subscriptionId: string,
    status: SubscriptionStatus,
    effectiveAt = new Date()
  ) {
    if (!subscriptionStatuses.includes(status)) throw new CommerceError("INVALID_INPUT");
    return this.repository.transitionSubscription(context, subscriptionId, status, effectiveAt);
  }
  changePlan(
    context: TenantContext,
    subscriptionId: string,
    input: { planId: string; priceId: string; effectiveAt?: Date; renewalAt?: Date }
  ) {
    return this.repository.changePlan(context, subscriptionId, {
      ...input,
      effectiveAt: input.effectiveAt ?? new Date()
    });
  }
  renewSubscription(context: TenantContext, subscriptionId: string, effectiveAt = new Date()) {
    return this.repository.renewSubscription(context, subscriptionId, effectiveAt);
  }
  async financialSummary(context: TenantContext): Promise<FinancialMetric[]> {
    const totals = new Map<string, FinancialMetric>();
    const add = (left: number, right: number) => {
      const result = left + right;
      if (!Number.isSafeInteger(result)) throw new CommerceError("INVALID_INPUT");
      return result;
    };
    for (const input of await this.repository.financialInputs(context)) {
      const metrics = recurringMetrics(input);
      const current = totals.get(input.currency) ?? {
        currency: input.currency,
        mrrMinor: 0,
        arrMinor: 0,
        annualCostMinor: 0,
        annualMarginMinor: 0,
        activeSubscriptions: 0
      };
      current.arrMinor = add(current.arrMinor, metrics.arrMinor);
      current.annualCostMinor = add(current.annualCostMinor, metrics.annualCostMinor);
      current.annualMarginMinor = add(current.annualMarginMinor, metrics.annualMarginMinor);
      current.activeSubscriptions += 1;
      totals.set(input.currency, current);
    }
    return [...totals.values()]
      .map((metric) => ({ ...metric, mrrMinor: monthlyFromAnnualMinor(metric.arrMinor) }))
      .sort((a, b) => a.currency.localeCompare(b.currency));
  }
}

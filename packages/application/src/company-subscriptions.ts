import { type BillingInterval, type TenantContext } from "@control-hub/domain";

export const companySubscriptionCategories = ["saas", "api", "infrastructure", "domain", "license", "other"] as const;
export const companySubscriptionStatuses = ["active", "trial", "paused", "canceled"] as const;
export type CompanySubscriptionCategory = (typeof companySubscriptionCategories)[number];
export type CompanySubscriptionStatus = (typeof companySubscriptionStatuses)[number];
export type CompanySubscriptionRecord = {
  id: string;
  provider: string;
  serviceName: string;
  category: CompanySubscriptionCategory;
  status: CompanySubscriptionStatus;
  currency: string;
  amountMinor: number;
  interval: Exclude<BillingInterval, "free">;
  renewalAt: Date | null;
  renewalAlertDays: number;
  autoRenew: boolean;
  websiteUrl: string | null;
  notes: string | null;
  accountEmail: string | null;
  ownerMembershipId: string | null;
  ownerName: string | null;
  quantity: number;
  startedAt: Date | null;
  trialEndsAt: Date | null;
  cancelBeforeAt: Date | null;
  canceledAt: Date | null;
  costCenter: string | null;
  paymentMethodLabel: string | null;
  secretManagerUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
};
export type CreateCompanySubscription = Omit<
  CompanySubscriptionRecord,
  | "id"
  | "createdAt"
  | "updatedAt"
  | "ownerName"
  | "canceledAt"
  | "accountEmail"
  | "ownerMembershipId"
  | "quantity"
  | "startedAt"
  | "trialEndsAt"
  | "cancelBeforeAt"
  | "costCenter"
  | "paymentMethodLabel"
  | "secretManagerUrl"
> & {
  accountEmail?: string | null;
  ownerMembershipId?: string | null;
  quantity?: number;
  startedAt?: Date | null;
  trialEndsAt?: Date | null;
  cancelBeforeAt?: Date | null;
  costCenter?: string | null;
  paymentMethodLabel?: string | null;
  secretManagerUrl?: string | null;
};

export type CompanySubscriptionFilters = {
  status?: CompanySubscriptionStatus;
  category?: CompanySubscriptionCategory;
  ownerMembershipId?: string;
  currency?: string;
  renewalState?: "due_soon" | "missing";
};

export type CompanySubscriptionLifecycleAction = "activate" | "pause" | "resume" | "cancel";
export type TransitionCompanySubscriptionInput = {
  subscriptionId: string;
  action: CompanySubscriptionLifecycleAction;
  effectiveAt: Date;
  reason?: string;
};
export type UpdateCompanySubscriptionInput = Partial<Omit<CreateCompanySubscription, "status">> & {
  subscriptionId: string;
  expectedUpdatedAt: Date;
};
export type PersistCompanySubscriptionUpdate = Omit<CreateCompanySubscription, "status"> & {
  subscriptionId: string;
  expectedUpdatedAt: Date;
};

export class CompanySubscriptionError extends Error {
  constructor(
    public readonly code:
      | "INVALID_INPUT"
      | "COMPANY_SUBSCRIPTION_NOT_FOUND"
      | "COMPANY_SUBSCRIPTION_REFERENCE_INVALID"
      | "COMPANY_SUBSCRIPTION_INVALID_TRANSITION"
      | "COMPANY_SUBSCRIPTION_CONFLICT"
  ) {
    super(code);
  }
}

export interface CompanySubscriptionRepository {
  list(context: TenantContext, filters?: CompanySubscriptionFilters): Promise<CompanySubscriptionRecord[]>;
  create(context: TenantContext, input: CreateCompanySubscription): Promise<CompanySubscriptionRecord>;
  update(context: TenantContext, input: PersistCompanySubscriptionUpdate): Promise<CompanySubscriptionRecord>;
  getById(context: TenantContext, id: string): Promise<CompanySubscriptionRecord | null>;
  transition(
    context: TenantContext,
    input: TransitionCompanySubscriptionInput & {
      expectedStatus: CompanySubscriptionStatus;
      targetStatus: CompanySubscriptionStatus;
      eventType: "activated" | "paused" | "resumed" | "canceled";
    }
  ): Promise<CompanySubscriptionRecord>;
}

function validDate(value: Date | null | undefined): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

function normalize(input: CreateCompanySubscription): CreateCompanySubscription {
  const provider = input.provider.trim();
  const serviceName = input.serviceName.trim();
  const currency = input.currency.trim().toUpperCase();
  const websiteUrl = input.websiteUrl?.trim() || null;
  const notes = input.notes?.trim() || null;
  const accountEmail = input.accountEmail?.trim() || null;
  const costCenter = input.costCenter?.trim() || null;
  const paymentMethodLabel = input.paymentMethodLabel?.trim() || null;
  const secretManagerUrl = input.secretManagerUrl?.trim() || null;
  const quantity = input.quantity ?? 1;
  if (
    !provider ||
    provider.length > 160 ||
    !serviceName ||
    serviceName.length > 160 ||
    !companySubscriptionCategories.includes(input.category) ||
    !companySubscriptionStatuses.includes(input.status) ||
    !/^[A-Z]{3}$/.test(currency) ||
    !Number.isSafeInteger(input.amountMinor) ||
    input.amountMinor < 0 ||
    !["monthly", "quarterly", "semiannual", "annual"].includes(input.interval) ||
    !Number.isInteger(input.renewalAlertDays) ||
    input.renewalAlertDays < 0 ||
    input.renewalAlertDays > 365 ||
    (websiteUrl && (!/^https:\/\//i.test(websiteUrl) || websiteUrl.length > 2048)) ||
    (notes && notes.length > 4000) ||
    (accountEmail && accountEmail.length > 320) ||
    !Number.isInteger(quantity) ||
    quantity < 1 ||
    quantity > 1_000_000 ||
    (costCenter && costCenter.length > 120) ||
    (paymentMethodLabel && paymentMethodLabel.length > 120) ||
    (secretManagerUrl && (!/^https:\/\//i.test(secretManagerUrl) || secretManagerUrl.length > 2048)) ||
    (input.startedAt !== undefined && input.startedAt !== null && !validDate(input.startedAt)) ||
    (input.trialEndsAt !== undefined && input.trialEndsAt !== null && !validDate(input.trialEndsAt)) ||
    (input.cancelBeforeAt !== undefined && input.cancelBeforeAt !== null && !validDate(input.cancelBeforeAt)) ||
    (input.renewalAt !== null && !validDate(input.renewalAt)) ||
    (validDate(input.startedAt) && validDate(input.trialEndsAt) && input.trialEndsAt < input.startedAt) ||
    (validDate(input.startedAt) && validDate(input.renewalAt) && input.renewalAt < input.startedAt)
  )
    throw new CompanySubscriptionError("INVALID_INPUT");
  return {
    ...input,
    provider,
    serviceName,
    currency,
    websiteUrl,
    notes,
    accountEmail,
    quantity,
    costCenter,
    paymentMethodLabel,
    secretManagerUrl
  };
}

export class CompanySubscriptionService {
  constructor(private readonly repository: CompanySubscriptionRepository) {}
  list(context: TenantContext, filters: CompanySubscriptionFilters = {}) {
    if (
      (filters.status !== undefined && !companySubscriptionStatuses.includes(filters.status)) ||
      (filters.category !== undefined && !companySubscriptionCategories.includes(filters.category)) ||
      (filters.currency !== undefined && !/^[A-Z]{3}$/.test(filters.currency)) ||
      (filters.renewalState !== undefined && !["due_soon", "missing"].includes(filters.renewalState))
    )
      throw new CompanySubscriptionError("INVALID_INPUT");
    return this.repository.list(context, filters);
  }
  create(context: TenantContext, input: CreateCompanySubscription) {
    if (!["active", "trial"].includes(input.status)) throw new CompanySubscriptionError("INVALID_INPUT");
    return this.repository.create(context, normalize(input));
  }

  async update(context: TenantContext, input: UpdateCompanySubscriptionInput) {
    if (!validDate(input.expectedUpdatedAt)) throw new CompanySubscriptionError("INVALID_INPUT");
    const current = await this.repository.getById(context, input.subscriptionId);
    if (!current) throw new CompanySubscriptionError("COMPANY_SUBSCRIPTION_NOT_FOUND");
    const normalized = normalize({
      provider: input.provider ?? current.provider,
      serviceName: input.serviceName ?? current.serviceName,
      category: input.category ?? current.category,
      status: current.status,
      currency: input.currency ?? current.currency,
      amountMinor: input.amountMinor ?? current.amountMinor,
      interval: input.interval ?? current.interval,
      renewalAt: input.renewalAt !== undefined ? input.renewalAt : current.renewalAt,
      renewalAlertDays: input.renewalAlertDays ?? current.renewalAlertDays,
      autoRenew: input.autoRenew ?? current.autoRenew,
      websiteUrl: input.websiteUrl !== undefined ? input.websiteUrl : current.websiteUrl,
      notes: input.notes !== undefined ? input.notes : current.notes,
      accountEmail: input.accountEmail !== undefined ? input.accountEmail : current.accountEmail,
      ownerMembershipId: input.ownerMembershipId !== undefined ? input.ownerMembershipId : current.ownerMembershipId,
      quantity: input.quantity ?? current.quantity,
      startedAt: input.startedAt !== undefined ? input.startedAt : current.startedAt,
      trialEndsAt: input.trialEndsAt !== undefined ? input.trialEndsAt : current.trialEndsAt,
      cancelBeforeAt: input.cancelBeforeAt !== undefined ? input.cancelBeforeAt : current.cancelBeforeAt,
      costCenter: input.costCenter !== undefined ? input.costCenter : current.costCenter,
      paymentMethodLabel:
        input.paymentMethodLabel !== undefined ? input.paymentMethodLabel : current.paymentMethodLabel,
      secretManagerUrl: input.secretManagerUrl !== undefined ? input.secretManagerUrl : current.secretManagerUrl
    });
    const { status: _status, ...fields } = normalized;
    return this.repository.update(context, {
      ...fields,
      subscriptionId: input.subscriptionId,
      expectedUpdatedAt: input.expectedUpdatedAt
    });
  }

  async transition(context: TenantContext, input: TransitionCompanySubscriptionInput) {
    const reason = input.reason?.trim();
    if (
      !validDate(input.effectiveAt) ||
      (reason !== undefined && (reason.length < 3 || reason.length > 500)) ||
      (input.action === "cancel" && reason === undefined)
    )
      throw new CompanySubscriptionError("INVALID_INPUT");
    const subscription = await this.repository.getById(context, input.subscriptionId);
    if (!subscription) throw new CompanySubscriptionError("COMPANY_SUBSCRIPTION_NOT_FOUND");
    const transition =
      input.action === "activate" && subscription.status === "trial"
        ? { targetStatus: "active" as const, eventType: "activated" as const }
        : input.action === "pause" && subscription.status === "active"
          ? { targetStatus: "paused" as const, eventType: "paused" as const }
          : input.action === "resume" && subscription.status === "paused"
            ? { targetStatus: "active" as const, eventType: "resumed" as const }
            : input.action === "cancel" && subscription.status !== "canceled"
              ? { targetStatus: "canceled" as const, eventType: "canceled" as const }
              : null;
    if (!transition) throw new CompanySubscriptionError("COMPANY_SUBSCRIPTION_INVALID_TRANSITION");
    return this.repository.transition(context, {
      ...input,
      ...(reason ? { reason } : {}),
      expectedStatus: subscription.status,
      ...transition
    });
  }
}

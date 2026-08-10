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
    const provider = input.provider.trim();
    const serviceName = input.serviceName.trim();
    const currency = input.currency.trim().toUpperCase();
    const websiteUrl = input.websiteUrl?.trim() || null;
    const notes = input.notes?.trim() || null;
    const accountEmail = input.accountEmail?.trim().toLowerCase() || null;
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
      !["active", "trial"].includes(input.status) ||
      !/^[A-Z]{3}$/.test(currency) ||
      !Number.isSafeInteger(input.amountMinor) ||
      input.amountMinor < 0 ||
      !["monthly", "quarterly", "semiannual", "annual"].includes(input.interval) ||
      !Number.isInteger(input.renewalAlertDays) ||
      input.renewalAlertDays < 0 ||
      input.renewalAlertDays > 365 ||
      (websiteUrl && (!/^https:\/\//i.test(websiteUrl) || websiteUrl.length > 2048)) ||
      (notes && notes.length > 4000) ||
      (accountEmail && (!/^\S+@\S+\.\S+$/.test(accountEmail) || accountEmail.length > 320)) ||
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
    return this.repository.create(context, {
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

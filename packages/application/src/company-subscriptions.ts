import { type BillingInterval, type TenantContext } from "@control-hub/domain";

export const companySubscriptionCategories = ["saas", "api", "infrastructure", "domain", "license", "other"] as const;
export const companySubscriptionStatuses = ["active", "trial", "canceled"] as const;
export type CompanySubscriptionCategory = typeof companySubscriptionCategories[number];
export type CompanySubscriptionStatus = typeof companySubscriptionStatuses[number];
export type CompanySubscriptionRecord = {
  id: string; provider: string; serviceName: string; category: CompanySubscriptionCategory; status: CompanySubscriptionStatus;
  currency: string; amountMinor: number; interval: Exclude<BillingInterval, "free">; renewalAt: Date | null;
  renewalAlertDays: number; autoRenew: boolean; websiteUrl: string | null; notes: string | null; createdAt: Date; updatedAt: Date;
};
export type CreateCompanySubscription = Omit<CompanySubscriptionRecord, "id" | "createdAt" | "updatedAt">;

export class CompanySubscriptionError extends Error {
  constructor(public readonly code: "INVALID_INPUT" | "DUPLICATE_SUBSCRIPTION" | "COMPANY_SUBSCRIPTION_NOT_FOUND") { super(code); }
}

export interface CompanySubscriptionRepository {
  list(context: TenantContext): Promise<CompanySubscriptionRecord[]>;
  create(context: TenantContext, input: CreateCompanySubscription): Promise<CompanySubscriptionRecord>;
  updateStatus(context: TenantContext, id: string, status: CompanySubscriptionStatus): Promise<CompanySubscriptionRecord>;
}

export class CompanySubscriptionService {
  constructor(private readonly repository: CompanySubscriptionRepository) {}
  list(context: TenantContext) { return this.repository.list(context); }
  create(context: TenantContext, input: CreateCompanySubscription) {
    const provider = input.provider.trim(); const serviceName = input.serviceName.trim(); const currency = input.currency.trim().toUpperCase();
    const websiteUrl = input.websiteUrl?.trim() || null; const notes = input.notes?.trim() || null;
    if (!provider || provider.length > 160 || !serviceName || serviceName.length > 160 || !companySubscriptionCategories.includes(input.category) || !companySubscriptionStatuses.includes(input.status) || !/^[A-Z]{3}$/.test(currency) || !Number.isSafeInteger(input.amountMinor) || input.amountMinor < 0 || !["monthly", "quarterly", "semiannual", "annual"].includes(input.interval) || !Number.isInteger(input.renewalAlertDays) || input.renewalAlertDays < 0 || input.renewalAlertDays > 365 || (websiteUrl && (!/^https:\/\//i.test(websiteUrl) || websiteUrl.length > 2048)) || (notes && notes.length > 4000)) throw new CompanySubscriptionError("INVALID_INPUT");
    return this.repository.create(context, { ...input, provider, serviceName, currency, websiteUrl, notes });
  }
  updateStatus(context: TenantContext, id: string, status: CompanySubscriptionStatus) {
    if (!companySubscriptionStatuses.includes(status)) throw new CompanySubscriptionError("INVALID_INPUT");
    return this.repository.updateStatus(context, id, status);
  }
}

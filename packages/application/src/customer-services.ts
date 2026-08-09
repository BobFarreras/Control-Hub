import type { BillingInterval, CommercialModel, TenantContext } from "@control-hub/domain";

export type CustomerServiceStatus = "active" | "paused" | "completed" | "canceled";

export type CustomerContractRecord = {
  id: string;
  customerId: string;
  customerName: string;
  productId: string;
  productName: string;
  planId: string;
  planName: string;
  priceId: string;
  commercialModel: CommercialModel;
  status: CustomerServiceStatus;
  quantity: number;
  contractedAt: Date;
  startsAt: Date;
  endsAt: Date | null;
  ownerMembershipId: string | null;
  ownerName: string | null;
  projectId: string | null;
  projectName: string | null;
  canceledAt: Date | null;
  currency: string;
  amountMinor: number;
  costMinor: number;
  taxBasisPoints: number;
  interval: BillingInterval;
  currentPeriodStart: Date | null;
  renewalAt: Date | null;
  autoRenew: boolean | null;
  renewalAlertDays: number | null;
  createdAt: Date;
  updatedAt: Date;
};

export type CreateCustomerServiceInput = {
  customerId: string;
  planId: string;
  priceId: string;
  quantity: number;
  contractedAt: Date;
  startsAt: Date;
  endsAt?: Date;
  ownerMembershipId?: string;
  projectId?: string;
  currentPeriodStart?: Date;
  renewalAt?: Date;
  autoRenew?: boolean;
  renewalAlertDays?: number;
};

export type CustomerServiceFilters = {
  customerId?: string;
  productId?: string;
  commercialModel?: CommercialModel;
  status?: CustomerServiceStatus;
  ownerMembershipId?: string;
  currency?: string;
  renewalBefore?: Date;
};

export type CustomerServiceOffering = {
  commercialModel: CommercialModel;
  interval: BillingInterval;
};

export class CustomerServicesError extends Error {
  constructor(
    public readonly code: "INVALID_INPUT" | "CUSTOMER_SERVICE_OFFERING_NOT_FOUND" | "CUSTOMER_SERVICE_REFERENCE_INVALID"
  ) {
    super(code);
  }
}

export interface CustomerServicesRepository {
  list(context: TenantContext, filters: CustomerServiceFilters): Promise<CustomerContractRecord[]>;
  resolveOffering(context: TenantContext, planId: string, priceId: string): Promise<CustomerServiceOffering | null>;
  create(context: TenantContext, input: CreateCustomerServiceInput): Promise<CustomerContractRecord>;
}

const serviceStatuses: readonly CustomerServiceStatus[] = ["active", "paused", "completed", "canceled"];
const serviceModels: readonly CommercialModel[] = ["subscription", "maintenance", "one_time", "project_service"];

function validDate(value: Date | undefined): value is Date {
  return value !== undefined && !Number.isNaN(value.getTime());
}

export class CustomerServicesService {
  constructor(private readonly repository: CustomerServicesRepository) {}

  list(context: TenantContext, filters: CustomerServiceFilters = {}) {
    if (
      (filters.commercialModel !== undefined && !serviceModels.includes(filters.commercialModel)) ||
      (filters.status !== undefined && !serviceStatuses.includes(filters.status)) ||
      (filters.currency !== undefined && !/^[A-Z]{3}$/.test(filters.currency)) ||
      (filters.renewalBefore !== undefined && !validDate(filters.renewalBefore))
    )
      throw new CustomerServicesError("INVALID_INPUT");
    return this.repository.list(context, filters);
  }

  async create(context: TenantContext, input: CreateCustomerServiceInput) {
    if (
      !Number.isSafeInteger(input.quantity) ||
      input.quantity < 1 ||
      input.quantity > 1_000_000 ||
      !validDate(input.contractedAt) ||
      !validDate(input.startsAt) ||
      (input.endsAt !== undefined && (!validDate(input.endsAt) || input.endsAt < input.startsAt)) ||
      (input.renewalAt !== undefined && !validDate(input.renewalAt)) ||
      (input.renewalAlertDays !== undefined &&
        (!Number.isInteger(input.renewalAlertDays) || input.renewalAlertDays < 0 || input.renewalAlertDays > 365))
    )
      throw new CustomerServicesError("INVALID_INPUT");

    const offering = await this.repository.resolveOffering(context, input.planId, input.priceId);
    if (!offering) throw new CustomerServicesError("CUSTOMER_SERVICE_OFFERING_NOT_FOUND");
    const recurring = offering.commercialModel === "subscription" || offering.commercialModel === "maintenance";
    if (recurring && offering.interval === "one_time") throw new CustomerServicesError("INVALID_INPUT");
    if (!recurring && offering.interval !== "one_time") throw new CustomerServicesError("INVALID_INPUT");

    const hasRecurrenceInput =
      input.currentPeriodStart !== undefined ||
      input.renewalAt !== undefined ||
      input.autoRenew !== undefined ||
      input.renewalAlertDays !== undefined;
    if (!recurring && hasRecurrenceInput) throw new CustomerServicesError("INVALID_INPUT");
    if (input.currentPeriodStart !== undefined && !validDate(input.currentPeriodStart))
      throw new CustomerServicesError("INVALID_INPUT");

    return this.repository.create(context, {
      ...input,
      ...(recurring
        ? {
            currentPeriodStart: input.currentPeriodStart ?? input.startsAt,
            autoRenew: input.autoRenew ?? false,
            renewalAlertDays: input.renewalAlertDays ?? 14
          }
        : {})
    });
  }
}

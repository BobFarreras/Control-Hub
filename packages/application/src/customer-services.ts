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
  renewalState?: "due_soon" | "missing";
};

export type CustomerServiceOffering = {
  commercialModel: CommercialModel;
  interval: BillingInterval;
};

export type CustomerServiceLifecycleAction = "pause" | "resume" | "complete" | "cancel";
export type TransitionCustomerServiceInput = {
  serviceId: string;
  action: CustomerServiceLifecycleAction;
  effectiveAt: Date;
  reason?: string;
};

export class CustomerServicesError extends Error {
  constructor(
    public readonly code:
      | "INVALID_INPUT"
      | "CUSTOMER_SERVICE_OFFERING_NOT_FOUND"
      | "CUSTOMER_SERVICE_REFERENCE_INVALID"
      | "CUSTOMER_SERVICE_NOT_FOUND"
      | "CUSTOMER_SERVICE_INVALID_TRANSITION"
      | "CUSTOMER_SERVICE_CONFLICT"
  ) {
    super(code);
  }
}

export interface CustomerServicesRepository {
  list(context: TenantContext, filters: CustomerServiceFilters): Promise<CustomerContractRecord[]>;
  resolveOffering(context: TenantContext, planId: string, priceId: string): Promise<CustomerServiceOffering | null>;
  create(context: TenantContext, input: CreateCustomerServiceInput): Promise<CustomerContractRecord>;
  getById(context: TenantContext, serviceId: string): Promise<CustomerContractRecord | null>;
  transition(
    context: TenantContext,
    input: TransitionCustomerServiceInput & {
      expectedStatus: CustomerServiceStatus;
      targetStatus: CustomerServiceStatus;
      eventType: "paused" | "resumed" | "completed" | "canceled";
    }
  ): Promise<CustomerContractRecord>;
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
      (filters.renewalState !== undefined && !["due_soon", "missing"].includes(filters.renewalState)) ||
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

  async transition(context: TenantContext, input: TransitionCustomerServiceInput) {
    const reason = input.reason?.trim();
    if (
      !validDate(input.effectiveAt) ||
      (reason !== undefined && (reason.length < 3 || reason.length > 500)) ||
      (input.action === "cancel" && reason === undefined)
    )
      throw new CustomerServicesError("INVALID_INPUT");
    const service = await this.repository.getById(context, input.serviceId);
    if (!service) throw new CustomerServicesError("CUSTOMER_SERVICE_NOT_FOUND");
    const recurring = service.commercialModel === "subscription" || service.commercialModel === "maintenance";
    const transition =
      input.action === "pause" && recurring && service.status === "active"
        ? { targetStatus: "paused" as const, eventType: "paused" as const }
        : input.action === "resume" && recurring && service.status === "paused"
          ? { targetStatus: "active" as const, eventType: "resumed" as const }
          : input.action === "complete" && !recurring && service.status === "active"
            ? { targetStatus: "completed" as const, eventType: "completed" as const }
            : input.action === "cancel" && (service.status === "active" || service.status === "paused")
              ? { targetStatus: "canceled" as const, eventType: "canceled" as const }
              : null;
    if (!transition) throw new CustomerServicesError("CUSTOMER_SERVICE_INVALID_TRANSITION");
    return this.repository.transition(context, {
      ...input,
      ...(reason ? { reason } : {}),
      expectedStatus: service.status,
      ...transition
    });
  }
}

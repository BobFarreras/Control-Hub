export type { TenantContext } from "@control-hub/domain";
export * from "./commerce.js";
export * from "./connectors.js";
export * from "./customer-services.js";
export * from "./company-subscriptions.js";
export * from "./support.js";
export * from "./projects.js";
export * from "./attendance.js";
import {
  canTransitionLead,
  normalizeComparableName,
  normalizeEmail,
  normalizePhone,
  type LeadPriority,
  type LeadStatus,
  type TenantContext
} from "@control-hub/domain";

export type LeadRecord = {
  id: string;
  name: string;
  companyName: string | null;
  email: string | null;
  phone: string | null;
  source: string;
  status: LeadStatus;
  priority: LeadPriority;
  ownerMembershipId: string | null;
  convertedCustomerId: string | null;
  createdAt: Date;
  updatedAt: Date;
};
export type CustomerRecord = {
  id: string;
  displayName: string;
  legalName: string | null;
  billingEmail: string | null;
  phone: string | null;
  website: string | null;
  taxId: string | null;
  preferredLocale: "ca" | "es" | "en" | null;
  timezone: string | null;
  status: "active" | "inactive";
  ownerMembershipId: string | null;
  createdFromLeadId: string | null;
  createdAt: Date;
  updatedAt: Date;
};
export type UpdateCustomerInput = {
  displayName: string;
  legalName?: string | undefined;
  billingEmail?: string | undefined;
  phone?: string | undefined;
  website?: string | undefined;
  taxId?: string | undefined;
  preferredLocale?: "ca" | "es" | "en" | undefined;
  timezone?: string | undefined;
  status: "active" | "inactive";
  expectedUpdatedAt: Date;
};
export type Page<T> = { items: T[]; total: number; page: number; pageSize: number };
export type CrmListSort =
  | "updated_desc"
  | "created_asc"
  | "created_desc"
  | "name_asc"
  | "name_desc"
  | "company_asc"
  | "company_desc"
  | "priority_asc"
  | "priority_desc";
export type CrmListQuery = {
  search?: string;
  status?: string;
  priority?: LeadPriority;
  page: number;
  pageSize: number;
  sort: CrmListSort;
};
export type CreateLeadInput = {
  name: string;
  companyName?: string;
  email?: string;
  phone?: string;
  source: string;
  priority: LeadPriority;
  ownerMembershipId?: string;
};
export type ContactRecord = {
  id: string;
  customerId: string;
  name: string;
  role: string | null;
  email: string | null;
  phone: string | null;
  isPrimary: boolean;
  sourceLeadId: string | null;
  createdAt: Date;
};
export type NoteRecord = { id: string; body: string; authorUserId: string | null; createdAt: Date };
export type TaskRecord = {
  id: string;
  title: string;
  dueAt: Date | null;
  completedAt: Date | null;
  assigneeMembershipId: string | null;
  createdAt: Date;
};
export type ActivityRecord = { id: string; type: string; metadata: Record<string, unknown>; occurredAt: Date };
export type CustomerServiceRecord = {
  id: string;
  productId: string;
  productName: string;
  planName: string;
  projectId: string | null;
  projectName: string | null;
  status: string;
  startedAt: Date;
  renewalAt: Date | null;
};
export type CustomerProjectRecord = {
  id: string;
  code: string;
  name: string;
  status: string;
  startedAt: Date | null;
  dueAt: Date | null;
};
export type CustomerTicketRecord = {
  id: string;
  ticketNumber: number;
  subject: string;
  status: string;
  priority: string;
  openedAt: Date;
};
export const customerInterestStages = ["detected", "qualified", "proposal", "negotiation", "won", "lost"] as const;
export type CustomerInterestStage = (typeof customerInterestStages)[number];
export type CustomerProductInterestRecord = {
  id: string;
  productId: string;
  productName: string;
  stage: CustomerInterestStage;
  probability: number | null;
  estimatedAmountMinor?: number | null;
  currency?: string | null;
  nextStep: string | null;
  ownerMembershipId: string | null;
  createdAt: Date;
  updatedAt: Date;
};
export type CustomerProductOption = { id: string; name: string };
export type CustomerAddressRecord = {
  id: string;
  type: "billing" | "shipping" | "office" | "other";
  label: string | null;
  line1: string;
  line2: string | null;
  postalCode: string | null;
  city: string;
  region: string | null;
  countryCode: string;
  isPrimary: boolean;
  createdAt: Date;
  updatedAt: Date;
};
export type CreateCustomerAddressInput = {
  type: CustomerAddressRecord["type"];
  label?: string | undefined;
  line1: string;
  line2?: string | undefined;
  postalCode?: string | undefined;
  city: string;
  region?: string | undefined;
  countryCode: string;
  isPrimary: boolean;
};
export type CreateCustomerInterestInput = {
  productId: string;
  probability?: number | undefined;
  estimatedAmountMinor?: number | undefined;
  currency?: string | undefined;
  nextStep?: string | undefined;
};
export type CustomerDetail = CustomerRecord & {
  contacts: ContactRecord[];
  notes: NoteRecord[];
  tasks: TaskRecord[];
  activity: ActivityRecord[];
  services: CustomerServiceRecord[];
  projects: CustomerProjectRecord[];
  tickets: CustomerTicketRecord[];
  interests: CustomerProductInterestRecord[];
  availableProducts: CustomerProductOption[];
  addresses: CustomerAddressRecord[];
};
export type CommercialSummary = {
  leadsByStatus: Record<LeadStatus, number>;
  activeCustomers: number;
  openTasks: number;
  overdueTasks: number;
};

export class CrmError extends Error {
  constructor(
    public readonly code:
      | "INVALID_TRANSITION"
      | "DUPLICATE_EMAIL"
      | "DUPLICATE_PHONE"
      | "LEAD_NOT_FOUND"
      | "CUSTOMER_NOT_FOUND"
      | "SOURCE_LEAD_NOT_AVAILABLE"
      | "CUSTOMER_ALREADY_HAS_CONTACTS"
      | "CUSTOMER_VERSION_CONFLICT"
      | "PRODUCT_NOT_FOUND"
      | "INTEREST_NOT_FOUND"
      | "DUPLICATE_INTEREST"
      | "ADDRESS_NOT_FOUND"
      | "INVALID_INPUT"
  ) {
    super(code);
  }
}

export interface CrmRepository {
  listLeads(context: TenantContext, query: CrmListQuery): Promise<Page<LeadRecord>>;
  listCustomers(context: TenantContext, query: CrmListQuery): Promise<Page<CustomerRecord>>;
  createLead(
    context: TenantContext,
    input: CreateLeadInput & { normalizedName: string; normalizedEmail: string | null; normalizedPhone: string | null }
  ): Promise<LeadRecord>;
  importLead(
    context: TenantContext,
    input: CreateLeadInput & { normalizedName: string; normalizedEmail: string | null; normalizedPhone: string | null },
    importReference: string
  ): Promise<"imported" | "already_imported">;
  transitionLead(context: TenantContext, leadId: string, status: LeadStatus): Promise<LeadRecord>;
  reopenLead(context: TenantContext, leadId: string, reason: string): Promise<LeadRecord>;
  convertLead(context: TenantContext, leadId: string): Promise<CustomerRecord>;
  getCustomer(context: TenantContext, customerId: string): Promise<CustomerDetail>;
  addContact(
    context: TenantContext,
    customerId: string,
    input: { name: string; role?: string; email?: string; phone?: string; isPrimary: boolean }
  ): Promise<ContactRecord>;
  createContactFromSourceLead(context: TenantContext, customerId: string): Promise<ContactRecord>;
  updateCustomer(context: TenantContext, customerId: string, input: UpdateCustomerInput): Promise<CustomerRecord>;
  createCustomerInterest(
    context: TenantContext,
    customerId: string,
    input: CreateCustomerInterestInput
  ): Promise<CustomerProductInterestRecord>;
  getCustomerInterest(context: TenantContext, interestId: string): Promise<CustomerProductInterestRecord>;
  transitionCustomerInterest(
    context: TenantContext,
    interestId: string,
    stage: CustomerInterestStage
  ): Promise<CustomerProductInterestRecord>;
  createCustomerAddress(
    context: TenantContext,
    customerId: string,
    input: CreateCustomerAddressInput
  ): Promise<CustomerAddressRecord>;
  deleteCustomerAddress(context: TenantContext, customerId: string, addressId: string): Promise<void>;
  addNote(context: TenantContext, customerId: string, body: string): Promise<NoteRecord>;
  addTask(
    context: TenantContext,
    customerId: string,
    input: { title: string; dueAt?: Date; assigneeMembershipId?: string }
  ): Promise<TaskRecord>;
  completeTask(context: TenantContext, taskId: string): Promise<TaskRecord>;
  commercialSummary(context: TenantContext): Promise<CommercialSummary>;
}

export class CrmService {
  constructor(private readonly repository: CrmRepository) {}
  listLeads(context: TenantContext, query: CrmListQuery) {
    return this.repository.listLeads(context, query);
  }
  listCustomers(context: TenantContext, query: CrmListQuery) {
    return this.repository.listCustomers(context, query);
  }
  createLead(context: TenantContext, input: CreateLeadInput) {
    const name = input.name.trim();
    if (name.length < 2 || name.length > 160 || input.source.trim().length === 0) throw new CrmError("INVALID_INPUT");
    const email = input.email?.trim() || undefined;
    const phone = input.phone?.trim() || undefined;
    return this.repository.createLead(context, {
      ...input,
      name,
      source: input.source.trim(),
      normalizedName: normalizeComparableName(name),
      normalizedEmail: email ? normalizeEmail(email) : null,
      normalizedPhone: phone ? normalizePhone(phone) : null
    });
  }
  importLead(context: TenantContext, input: CreateLeadInput, importReference: string) {
    const reference = importReference.trim();
    if (reference.length === 0 || reference.length > 120) throw new CrmError("INVALID_INPUT");
    const name = input.name.trim();
    if (name.length < 2 || name.length > 160 || input.source.trim().length === 0) throw new CrmError("INVALID_INPUT");
    const email = input.email?.trim() || undefined;
    const phone = input.phone?.trim() || undefined;
    return this.repository.importLead(
      context,
      {
        ...input,
        name,
        source: input.source.trim(),
        normalizedName: normalizeComparableName(name),
        normalizedEmail: email ? normalizeEmail(email) : null,
        normalizedPhone: phone ? normalizePhone(phone) : null
      },
      reference
    );
  }
  async transitionLead(context: TenantContext, leadId: string, status: LeadStatus) {
    const current = (
      await this.repository.listLeads(context, { search: leadId, page: 1, pageSize: 1, sort: "updated_desc" })
    ).items.find((lead) => lead.id === leadId);
    if (!current) throw new CrmError("LEAD_NOT_FOUND");
    if (!canTransitionLead(current.status, status)) throw new CrmError("INVALID_TRANSITION");
    return this.repository.transitionLead(context, leadId, status);
  }
  reopenLead(context: TenantContext, leadId: string, reason: string) {
    const normalized = reason.trim();
    if (normalized.length < 3 || normalized.length > 500) throw new CrmError("INVALID_INPUT");
    return this.repository.reopenLead(context, leadId, normalized);
  }
  convertLead(context: TenantContext, leadId: string) {
    return this.repository.convertLead(context, leadId);
  }
  getCustomer(context: TenantContext, customerId: string) {
    return this.repository.getCustomer(context, customerId);
  }
  addContact(
    context: TenantContext,
    customerId: string,
    input: { name: string; role?: string; email?: string; phone?: string; isPrimary: boolean }
  ) {
    const name = input.name.trim();
    if (name.length < 2 || name.length > 160) throw new CrmError("INVALID_INPUT");
    const email = input.email?.trim() || undefined;
    const phone = input.phone?.trim() || undefined;
    return this.repository.addContact(context, customerId, {
      ...input,
      name,
      ...(email ? { email } : {}),
      ...(phone ? { phone } : {})
    });
  }
  createContactFromSourceLead(context: TenantContext, customerId: string) {
    return this.repository.createContactFromSourceLead(context, customerId);
  }
  updateCustomer(context: TenantContext, customerId: string, input: UpdateCustomerInput) {
    const displayName = input.displayName.trim();
    if (displayName.length < 2 || displayName.length > 160 || Number.isNaN(input.expectedUpdatedAt.getTime()))
      throw new CrmError("INVALID_INPUT");
    let website: string | undefined;
    if (input.website?.trim()) {
      try {
        const rawWebsite = input.website.trim();
        if (/^[a-z][a-z\d+.-]*:/i.test(rawWebsite) && !/^https?:\/\//i.test(rawWebsite)) throw new Error();
        const parsedWebsite = new URL(/^https?:\/\//i.test(rawWebsite) ? rawWebsite : `https://${rawWebsite}`);
        if (!["http:", "https:"].includes(parsedWebsite.protocol) || !parsedWebsite.hostname) throw new Error();
        website = parsedWebsite.toString();
      } catch {
        throw new CrmError("INVALID_INPUT");
      }
    }
    const timezone = input.timezone?.trim() || undefined;
    if (timezone) {
      try {
        new Intl.DateTimeFormat("en", { timeZone: timezone }).format();
      } catch {
        throw new CrmError("INVALID_INPUT");
      }
    }
    return this.repository.updateCustomer(context, customerId, {
      ...input,
      displayName,
      legalName: input.legalName?.trim() || undefined,
      billingEmail: input.billingEmail?.trim() || undefined,
      phone: input.phone?.trim() || undefined,
      website,
      taxId: input.taxId?.trim() || undefined,
      timezone
    });
  }
  createCustomerAddress(context: TenantContext, customerId: string, input: CreateCustomerAddressInput) {
    const line1 = input.line1.trim();
    const city = input.city.trim();
    const countryCode = input.countryCode.trim().toUpperCase();
    if (!line1 || line1.length > 200 || !city || city.length > 120 || !/^[A-Z]{2}$/.test(countryCode))
      throw new CrmError("INVALID_INPUT");
    return this.repository.createCustomerAddress(context, customerId, {
      ...input,
      line1,
      city,
      countryCode,
      label: input.label?.trim() || undefined,
      line2: input.line2?.trim() || undefined,
      postalCode: input.postalCode?.trim() || undefined,
      region: input.region?.trim() || undefined
    });
  }
  deleteCustomerAddress(context: TenantContext, customerId: string, addressId: string) {
    return this.repository.deleteCustomerAddress(context, customerId, addressId);
  }
  createCustomerInterest(context: TenantContext, customerId: string, input: CreateCustomerInterestInput) {
    const probability = input.probability;
    const hasAmount = input.estimatedAmountMinor !== undefined;
    const currency = input.currency?.trim().toUpperCase();
    if (
      !input.productId ||
      (probability !== undefined && (!Number.isInteger(probability) || probability < 0 || probability > 100)) ||
      (hasAmount && (!Number.isSafeInteger(input.estimatedAmountMinor) || input.estimatedAmountMinor! < 0)) ||
      hasAmount !== Boolean(currency) ||
      (currency !== undefined && !/^[A-Z]{3}$/.test(currency))
    )
      throw new CrmError("INVALID_INPUT");
    const nextStep = input.nextStep?.trim() || undefined;
    if (nextStep && nextStep.length > 500) throw new CrmError("INVALID_INPUT");
    return this.repository.createCustomerInterest(context, customerId, { ...input, currency, nextStep });
  }
  async transitionCustomerInterest(context: TenantContext, interestId: string, stage: CustomerInterestStage) {
    const current = await this.repository.getCustomerInterest(context, interestId);
    const allowed: Record<CustomerInterestStage, CustomerInterestStage[]> = {
      detected: ["qualified", "lost"],
      qualified: ["proposal", "lost"],
      proposal: ["negotiation", "lost"],
      negotiation: ["won", "lost"],
      won: [],
      lost: []
    };
    if (!customerInterestStages.includes(stage) || !allowed[current.stage].includes(stage))
      throw new CrmError("INVALID_TRANSITION");
    return this.repository.transitionCustomerInterest(context, interestId, stage);
  }
  addNote(context: TenantContext, customerId: string, body: string) {
    const normalized = body.trim();
    if (!normalized || normalized.length > 10000) throw new CrmError("INVALID_INPUT");
    return this.repository.addNote(context, customerId, normalized);
  }
  addTask(
    context: TenantContext,
    customerId: string,
    input: { title: string; dueAt?: Date; assigneeMembershipId?: string }
  ) {
    const title = input.title.trim();
    if (!title || title.length > 240) throw new CrmError("INVALID_INPUT");
    return this.repository.addTask(context, customerId, { ...input, title });
  }
  completeTask(context: TenantContext, taskId: string) {
    return this.repository.completeTask(context, taskId);
  }
  commercialSummary(context: TenantContext) {
    return this.repository.commercialSummary(context);
  }
}

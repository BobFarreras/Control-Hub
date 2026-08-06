export type { TenantContext } from "@control-hub/domain";
export * from "./commerce.js";
export * from "./company-subscriptions.js";
export * from "./support.js";
export * from "./projects.js";
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
  status: "active" | "inactive";
  ownerMembershipId: string | null;
  createdFromLeadId: string | null;
  createdAt: Date;
  updatedAt: Date;
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
export type CustomerDetail = CustomerRecord & {
  contacts: ContactRecord[];
  notes: NoteRecord[];
  tasks: TaskRecord[];
  activity: ActivityRecord[];
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
  transitionLead(context: TenantContext, leadId: string, status: LeadStatus): Promise<LeadRecord>;
  convertLead(context: TenantContext, leadId: string): Promise<CustomerRecord>;
  getCustomer(context: TenantContext, customerId: string): Promise<CustomerDetail>;
  addContact(
    context: TenantContext,
    customerId: string,
    input: { name: string; role?: string; email?: string; phone?: string; isPrimary: boolean }
  ): Promise<ContactRecord>;
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
  async transitionLead(context: TenantContext, leadId: string, status: LeadStatus) {
    const current = (
      await this.repository.listLeads(context, { search: leadId, page: 1, pageSize: 1, sort: "updated_desc" })
    ).items.find((lead) => lead.id === leadId);
    if (!current) throw new CrmError("LEAD_NOT_FOUND");
    if (!canTransitionLead(current.status, status)) throw new CrmError("INVALID_TRANSITION");
    return this.repository.transitionLead(context, leadId, status);
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

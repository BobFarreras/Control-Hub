import { randomUUID } from "node:crypto";
import { CrmError, type ActivityRecord, type CommercialSummary, type ContactRecord, type CrmListQuery, type CrmRepository, type CreateLeadInput, type CustomerDetail, type CustomerRecord, type LeadRecord, type NoteRecord, type TaskRecord } from "@control-hub/application";
import { withTenant, type DatabaseClient } from "@control-hub/database";
import { leadStatuses, normalizeEmail, normalizePhone, type LeadStatus, type TenantContext } from "@control-hub/domain";

type DatabaseError = { code?: string; constraint_name?: string };

function mapDuplicate(error: unknown): never {
  const databaseError = error as DatabaseError;
  if (databaseError.code === "23505") {
    if (databaseError.constraint_name?.includes("email")) throw new CrmError("DUPLICATE_EMAIL");
    if (databaseError.constraint_name?.includes("phone")) throw new CrmError("DUPLICATE_PHONE");
  }
  throw error;
}

export class PostgresCrmRepository implements CrmRepository {
  constructor(private readonly database: DatabaseClient) {}

  async listLeads(context: TenantContext, query: CrmListQuery) {
    return withTenant(this.database, context.tenantId, async (tx) => {
      const search = query.search?.trim() || null;
      const status = query.status || null;
      const offset = (query.page - 1) * query.pageSize;
      const rows = await tx<LeadRecord[]>`
        select id, name, company_name as "companyName", email, phone, source, status, priority,
          owner_membership_id as "ownerMembershipId", converted_customer_id as "convertedCustomerId",
          created_at as "createdAt", updated_at as "updatedAt"
        from leads where tenant_id = ${context.tenantId}
          and (${status}::text is null or status = ${status})
          and (${search}::text is null or id::text = ${search} or normalized_name like '%' || lower(${search}) || '%'
            or normalized_email like '%' || lower(${search}) || '%' or normalized_phone like '%' || ${search} || '%')
        order by case when ${query.sort} = 'name_asc' then normalized_name end asc,
          case when ${query.sort} = 'updated_desc' then updated_at end desc, id
        limit ${query.pageSize} offset ${offset}`;
      const count = await tx<{ total: number }[]>`select count(*)::int as total from leads where tenant_id = ${context.tenantId}
        and (${status}::text is null or status = ${status})
        and (${search}::text is null or id::text = ${search} or normalized_name like '%' || lower(${search}) || '%'
          or normalized_email like '%' || lower(${search}) || '%' or normalized_phone like '%' || ${search} || '%')`;
      return { items: rows, total: count[0]?.total ?? 0, page: query.page, pageSize: query.pageSize };
    });
  }

  async listCustomers(context: TenantContext, query: CrmListQuery) {
    return withTenant(this.database, context.tenantId, async (tx) => {
      const search = query.search?.trim() || null; const status = query.status || null; const offset = (query.page - 1) * query.pageSize;
      const rows = await tx<CustomerRecord[]>`select id, display_name as "displayName", legal_name as "legalName", billing_email as "billingEmail", phone, website, status,
        owner_membership_id as "ownerMembershipId", created_from_lead_id as "createdFromLeadId", created_at as "createdAt", updated_at as "updatedAt"
        from customers where tenant_id = ${context.tenantId} and (${status}::text is null or status = ${status})
        and (${search}::text is null or normalized_name like '%' || lower(${search}) || '%' or normalized_billing_email like '%' || lower(${search}) || '%' or normalized_phone like '%' || ${search} || '%')
        order by case when ${query.sort} = 'name_asc' then normalized_name end asc, case when ${query.sort} = 'updated_desc' then updated_at end desc, id
        limit ${query.pageSize} offset ${offset}`;
      const count = await tx<{ total: number }[]>`select count(*)::int as total from customers where tenant_id = ${context.tenantId} and (${status}::text is null or status = ${status})
        and (${search}::text is null or normalized_name like '%' || lower(${search}) || '%' or normalized_billing_email like '%' || lower(${search}) || '%' or normalized_phone like '%' || ${search} || '%')`;
      return { items: rows, total: count[0]?.total ?? 0, page: query.page, pageSize: query.pageSize };
    });
  }

  async createLead(context: TenantContext, input: CreateLeadInput & { normalizedName: string; normalizedEmail: string | null; normalizedPhone: string | null }) {
    try {
      return await withTenant(this.database, context.tenantId, async (tx) => {
        const id = randomUUID();
        const rows = await tx<LeadRecord[]>`insert into leads (id, tenant_id, name, normalized_name, company_name, email, normalized_email, phone, normalized_phone, source, priority, owner_membership_id)
          values (${id}, ${context.tenantId}, ${input.name}, ${input.normalizedName}, ${input.companyName ?? null}, ${input.email ?? null}, ${input.normalizedEmail}, ${input.phone ?? null}, ${input.normalizedPhone}, ${input.source}, ${input.priority}, ${input.ownerMembershipId ?? null})
          returning id, name, company_name as "companyName", email, phone, source, status, priority, owner_membership_id as "ownerMembershipId", converted_customer_id as "convertedCustomerId", created_at as "createdAt", updated_at as "updatedAt"`;
        await tx`insert into crm_activity (id, tenant_id, lead_id, actor_user_id, type) values (${randomUUID()}, ${context.tenantId}, ${id}, ${context.userId}, 'lead.created')`;
        return rows[0]!;
      });
    } catch (error) { return mapDuplicate(error); }
  }

  async transitionLead(context: TenantContext, leadId: string, status: LeadStatus) {
    return withTenant(this.database, context.tenantId, async (tx) => {
      const rows = await tx<LeadRecord[]>`update leads set status = ${status}, updated_at = now() where tenant_id = ${context.tenantId} and id = ${leadId}
        returning id, name, company_name as "companyName", email, phone, source, status, priority, owner_membership_id as "ownerMembershipId", converted_customer_id as "convertedCustomerId", created_at as "createdAt", updated_at as "updatedAt"`;
      if (!rows[0]) throw new CrmError("LEAD_NOT_FOUND");
      await tx`insert into crm_activity (id, tenant_id, lead_id, actor_user_id, type, metadata) values (${randomUUID()}, ${context.tenantId}, ${leadId}, ${context.userId}, 'lead.status.changed', ${tx.json({ status })})`;
      return rows[0];
    });
  }

  async convertLead(context: TenantContext, leadId: string) {
    try {
      return await withTenant(this.database, context.tenantId, async (tx) => {
        const leads = await tx<LeadRecord[]>`select id, name, company_name as "companyName", email, phone, source, status, priority, owner_membership_id as "ownerMembershipId", converted_customer_id as "convertedCustomerId", created_at as "createdAt", updated_at as "updatedAt" from leads where tenant_id = ${context.tenantId} and id = ${leadId} for update`;
        const lead = leads[0]; if (!lead) throw new CrmError("LEAD_NOT_FOUND");
        if (lead.convertedCustomerId) {
          const existing = await tx<CustomerRecord[]>`select id, display_name as "displayName", legal_name as "legalName", billing_email as "billingEmail", phone, website, status, owner_membership_id as "ownerMembershipId", created_from_lead_id as "createdFromLeadId", created_at as "createdAt", updated_at as "updatedAt" from customers where tenant_id = ${context.tenantId} and id = ${lead.convertedCustomerId}`;
          return existing[0]!;
        }
        const customerId = randomUUID();
        const displayName = lead.companyName ?? lead.name;
        const customers = await tx<CustomerRecord[]>`insert into customers (id, tenant_id, display_name, normalized_name, billing_email, normalized_billing_email, phone, normalized_phone, owner_membership_id, created_from_lead_id)
          select ${customerId}, tenant_id, ${displayName}, normalized_name, email, normalized_email, phone, normalized_phone, owner_membership_id, id from leads where tenant_id = ${context.tenantId} and id = ${leadId}
          returning id, display_name as "displayName", legal_name as "legalName", billing_email as "billingEmail", phone, website, status, owner_membership_id as "ownerMembershipId", created_from_lead_id as "createdFromLeadId", created_at as "createdAt", updated_at as "updatedAt"`;
        await tx`update leads set status = 'won', converted_customer_id = ${customerId}, updated_at = now() where tenant_id = ${context.tenantId} and id = ${leadId}`;
        await tx`insert into crm_activity (id, tenant_id, customer_id, actor_user_id, type, metadata) values (${randomUUID()}, ${context.tenantId}, ${customerId}, ${context.userId}, 'lead.converted', ${tx.json({ leadId })})`;
        return customers[0]!;
      });
    } catch (error) { return mapDuplicate(error); }
  }

  async getCustomer(context: TenantContext, customerId: string): Promise<CustomerDetail> {
    return withTenant(this.database, context.tenantId, async (tx) => {
      const customers = await tx<CustomerRecord[]>`select id, display_name as "displayName", legal_name as "legalName", billing_email as "billingEmail", phone, website, status, owner_membership_id as "ownerMembershipId", created_from_lead_id as "createdFromLeadId", created_at as "createdAt", updated_at as "updatedAt" from customers where tenant_id = ${context.tenantId} and id = ${customerId}`;
      const customer = customers[0]; if (!customer) throw new CrmError("CUSTOMER_NOT_FOUND");
      const [contacts, notes, tasks, activity] = await Promise.all([
        tx<ContactRecord[]>`select id, customer_id as "customerId", name, role, email, phone, is_primary as "isPrimary", created_at as "createdAt" from contacts where tenant_id = ${context.tenantId} and customer_id = ${customerId} order by is_primary desc, name`,
        tx<NoteRecord[]>`select id, body, author_user_id as "authorUserId", created_at as "createdAt" from crm_notes where tenant_id = ${context.tenantId} and customer_id = ${customerId} order by created_at desc`,
        tx<TaskRecord[]>`select id, title, due_at as "dueAt", completed_at as "completedAt", assignee_membership_id as "assigneeMembershipId", created_at as "createdAt" from crm_tasks where tenant_id = ${context.tenantId} and customer_id = ${customerId} order by completed_at nulls first, due_at nulls last`,
        tx<ActivityRecord[]>`select id, type, metadata, occurred_at as "occurredAt" from crm_activity where tenant_id = ${context.tenantId} and customer_id = ${customerId} order by occurred_at desc limit 200`
      ]);
      return { ...customer, contacts, notes, tasks, activity };
    });
  }

  async addContact(context: TenantContext, customerId: string, input: { name: string; role?: string; email?: string; phone?: string; isPrimary: boolean }) {
    try { return await withTenant(this.database, context.tenantId, async (tx) => {
      const exists = await tx`select 1 from customers where tenant_id = ${context.tenantId} and id = ${customerId}`; if (!exists[0]) throw new CrmError("CUSTOMER_NOT_FOUND");
      if (input.isPrimary) await tx`update contacts set is_primary = false, updated_at = now() where tenant_id = ${context.tenantId} and customer_id = ${customerId} and is_primary`;
      const id = randomUUID(); const rows = await tx<ContactRecord[]>`insert into contacts (id, tenant_id, customer_id, name, role, email, normalized_email, phone, normalized_phone, is_primary) values (${id}, ${context.tenantId}, ${customerId}, ${input.name}, ${input.role ?? null}, ${input.email ?? null}, ${input.email ? normalizeEmail(input.email) : null}, ${input.phone ?? null}, ${input.phone ? normalizePhone(input.phone) : null}, ${input.isPrimary}) returning id, customer_id as "customerId", name, role, email, phone, is_primary as "isPrimary", created_at as "createdAt"`;
      await tx`insert into crm_activity (id, tenant_id, customer_id, actor_user_id, type, metadata) values (${randomUUID()}, ${context.tenantId}, ${customerId}, ${context.userId}, 'contact.created', ${tx.json({ contactId: id })})`; return rows[0]!;
    }); } catch (error) { return mapDuplicate(error); }
  }

  async addNote(context: TenantContext, customerId: string, body: string) {
    return withTenant(this.database, context.tenantId, async (tx) => { const id = randomUUID();
      const rows = await tx<NoteRecord[]>`insert into crm_notes (id, tenant_id, customer_id, body, author_user_id) select ${id}, ${context.tenantId}, id, ${body}, ${context.userId} from customers where tenant_id = ${context.tenantId} and id = ${customerId} returning id, body, author_user_id as "authorUserId", created_at as "createdAt"`;
      if (!rows[0]) throw new CrmError("CUSTOMER_NOT_FOUND"); await tx`insert into crm_activity (id, tenant_id, customer_id, actor_user_id, type) values (${randomUUID()}, ${context.tenantId}, ${customerId}, ${context.userId}, 'note.created')`; return rows[0]; });
  }

  async addTask(context: TenantContext, customerId: string, input: { title: string; dueAt?: Date; assigneeMembershipId?: string }) {
    return withTenant(this.database, context.tenantId, async (tx) => { const id = randomUUID();
      const rows = await tx<TaskRecord[]>`insert into crm_tasks (id, tenant_id, customer_id, title, due_at, assignee_membership_id) select ${id}, ${context.tenantId}, id, ${input.title}, ${input.dueAt ?? null}, ${input.assigneeMembershipId ?? null} from customers where tenant_id = ${context.tenantId} and id = ${customerId} returning id, title, due_at as "dueAt", completed_at as "completedAt", assignee_membership_id as "assigneeMembershipId", created_at as "createdAt"`;
      if (!rows[0]) throw new CrmError("CUSTOMER_NOT_FOUND"); await tx`insert into crm_activity (id, tenant_id, customer_id, actor_user_id, type, metadata) values (${randomUUID()}, ${context.tenantId}, ${customerId}, ${context.userId}, 'task.created', ${tx.json({ taskId: id })})`; return rows[0]; });
  }

  async completeTask(context: TenantContext, taskId: string) {
    return withTenant(this.database, context.tenantId, async (tx) => { const rows = await tx<TaskRecord[]>`update crm_tasks set completed_at = coalesce(completed_at, now()), updated_at = now() where tenant_id = ${context.tenantId} and id = ${taskId} returning id, title, due_at as "dueAt", completed_at as "completedAt", assignee_membership_id as "assigneeMembershipId", created_at as "createdAt"`;
      if (!rows[0]) throw new CrmError("CUSTOMER_NOT_FOUND"); const entity = await tx<{ customer_id: string }[]>`select customer_id from crm_tasks where tenant_id = ${context.tenantId} and id = ${taskId}`; await tx`insert into crm_activity (id, tenant_id, customer_id, actor_user_id, type, metadata) values (${randomUUID()}, ${context.tenantId}, ${entity[0]!.customer_id}, ${context.userId}, 'task.completed', ${tx.json({ taskId })})`; return rows[0]; });
  }

  async commercialSummary(context: TenantContext): Promise<CommercialSummary> {
    return withTenant(this.database, context.tenantId, async (tx) => {
      const leadCounts = await tx<{ status: LeadStatus; count: number }[]>`select status, count(*)::int as count from leads where tenant_id = ${context.tenantId} group by status`;
      const [metrics] = await tx<{ active_customers: number; open_tasks: number; overdue_tasks: number }[]>`select (select count(*)::int from customers where tenant_id = ${context.tenantId} and status = 'active') active_customers, (select count(*)::int from crm_tasks where tenant_id = ${context.tenantId} and completed_at is null) open_tasks, (select count(*)::int from crm_tasks where tenant_id = ${context.tenantId} and completed_at is null and due_at < now()) overdue_tasks`;
      const leadsByStatus = Object.fromEntries(leadStatuses.map((status) => [status, leadCounts.find((row) => row.status === status)?.count ?? 0])) as Record<LeadStatus, number>;
      return { leadsByStatus, activeCustomers: metrics?.active_customers ?? 0, openTasks: metrics?.open_tasks ?? 0, overdueTasks: metrics?.overdue_tasks ?? 0 };
    });
  }
}

import { randomUUID } from "node:crypto";
import {
  CrmError,
  type ActivityRecord,
  type CommercialSummary,
  type ContactRecord,
  type CrmListQuery,
  type CrmRepository,
  type CreateLeadInput,
  type CreateCustomerAddressInput,
  type CreateCustomerInterestInput,
  type CustomerAddressRecord,
  type CustomerDetail,
  type CustomerInterestStage,
  type CustomerProductInterestRecord,
  type CustomerProductOption,
  type CustomerProjectRecord,
  type CustomerRecord,
  type CustomerServiceRecord,
  type CustomerTicketRecord,
  type LeadRecord,
  type NoteRecord,
  type TaskRecord,
  type UpdateCustomerInput
} from "@control-hub/application";
import { withTenant, type DatabaseClient } from "@control-hub/database";
import {
  leadStatuses,
  normalizeComparableName,
  normalizeEmail,
  normalizePhone,
  recoverLeadStatus,
  type LeadStatus,
  type TenantContext
} from "@control-hub/domain";
import type postgres from "postgres";

type DatabaseError = { code?: string; constraint_name?: string };
type CustomerProductInterestRow = Omit<CustomerProductInterestRecord, "estimatedAmountMinor" | "currency"> & {
  estimatedAmountMinor: string | number | null;
  currency: string | null;
};

function mapDuplicate(error: unknown): never {
  const databaseError = error as DatabaseError;
  if (databaseError.code === "23505") {
    if (databaseError.constraint_name?.includes("email")) throw new CrmError("DUPLICATE_EMAIL");
    if (databaseError.constraint_name?.includes("phone")) throw new CrmError("DUPLICATE_PHONE");
    if (databaseError.constraint_name?.includes("customer_product_interests_open"))
      throw new CrmError("DUPLICATE_INTEREST");
  }
  throw error;
}

export class PostgresCrmRepository implements CrmRepository {
  constructor(private readonly database: DatabaseClient) {}

  async listLeads(context: TenantContext, query: CrmListQuery) {
    return withTenant(this.database, context.tenantId, async (tx) => {
      const search = query.search?.trim() || null;
      const status = query.status || null;
      const priority = query.priority || null;
      const offset = (query.page - 1) * query.pageSize;
      const rows = await tx<LeadRecord[]>`
        select id, name, company_name as "companyName", email, phone, source, status, priority,
          owner_membership_id as "ownerMembershipId", converted_customer_id as "convertedCustomerId",
          created_at as "createdAt", updated_at as "updatedAt"
        from leads where tenant_id = ${context.tenantId}
          and (${status}::text is null or status = ${status})
          and (${priority}::text is null or priority = ${priority})
          and (${search}::text is null or id::text = ${search} or normalized_name like '%' || lower(${search}) || '%'
            or normalized_email like '%' || lower(${search}) || '%' or normalized_phone like '%' || ${search} || '%')
        order by case when ${query.sort} = 'name_asc' then normalized_name end asc, case when ${query.sort} = 'name_desc' then normalized_name end desc,
          case when ${query.sort} = 'company_asc' then lower(company_name) end asc nulls last, case when ${query.sort} = 'company_desc' then lower(company_name) end desc nulls last,
          case when ${query.sort} = 'priority_asc' then array_position(array['low','normal','high','urgent']::text[], priority) end asc,
          case when ${query.sort} = 'priority_desc' then array_position(array['low','normal','high','urgent']::text[], priority) end desc,
          case when ${query.sort} = 'created_asc' then created_at end asc, case when ${query.sort} = 'created_desc' then created_at end desc,
          case when ${query.sort} = 'updated_desc' then updated_at end desc, id
        limit ${query.pageSize} offset ${offset}`;
      const count = await tx<
        { total: number }[]
      >`select count(*)::int as total from leads where tenant_id = ${context.tenantId}
        and (${status}::text is null or status = ${status})
        and (${priority}::text is null or priority = ${priority})
        and (${search}::text is null or id::text = ${search} or normalized_name like '%' || lower(${search}) || '%'
          or normalized_email like '%' || lower(${search}) || '%' or normalized_phone like '%' || ${search} || '%')`;
      return { items: rows, total: count[0]?.total ?? 0, page: query.page, pageSize: query.pageSize };
    });
  }

  async listCustomers(context: TenantContext, query: CrmListQuery) {
    return withTenant(this.database, context.tenantId, async (tx) => {
      const search = query.search?.trim() || null;
      const status = query.status || null;
      const offset = (query.page - 1) * query.pageSize;
      const rows = await tx<
        CustomerRecord[]
      >`select id, display_name as "displayName", legal_name as "legalName", billing_email as "billingEmail", phone, website, status,
        owner_membership_id as "ownerMembershipId", created_from_lead_id as "createdFromLeadId", created_at as "createdAt", updated_at as "updatedAt"
        from customers where tenant_id = ${context.tenantId} and (${status}::text is null or status = ${status})
        and (${search}::text is null or normalized_name like '%' || lower(${search}) || '%' or normalized_billing_email like '%' || lower(${search}) || '%' or normalized_phone like '%' || ${search} || '%')
        order by case when ${query.sort} = 'name_asc' then normalized_name end asc, case when ${query.sort} = 'name_desc' then normalized_name end desc,
          case when ${query.sort} = 'created_asc' then created_at end asc, case when ${query.sort} = 'created_desc' then created_at end desc,
          case when ${query.sort} = 'updated_desc' then updated_at end desc, id
        limit ${query.pageSize} offset ${offset}`;
      const count = await tx<
        { total: number }[]
      >`select count(*)::int as total from customers where tenant_id = ${context.tenantId} and (${status}::text is null or status = ${status})
        and (${search}::text is null or normalized_name like '%' || lower(${search}) || '%' or normalized_billing_email like '%' || lower(${search}) || '%' or normalized_phone like '%' || ${search} || '%')`;
      return { items: rows, total: count[0]?.total ?? 0, page: query.page, pageSize: query.pageSize };
    });
  }

  async createLead(
    context: TenantContext,
    input: CreateLeadInput & { normalizedName: string; normalizedEmail: string | null; normalizedPhone: string | null }
  ) {
    try {
      return await withTenant(this.database, context.tenantId, async (tx) => {
        const id = randomUUID();
        const rows = await tx<
          LeadRecord[]
        >`insert into leads (id, tenant_id, name, normalized_name, company_name, email, normalized_email, phone, normalized_phone, source, priority, owner_membership_id)
          values (${id}, ${context.tenantId}, ${input.name}, ${input.normalizedName}, ${input.companyName ?? null}, ${input.email ?? null}, ${input.normalizedEmail}, ${input.phone ?? null}, ${input.normalizedPhone}, ${input.source}, ${input.priority}, ${input.ownerMembershipId ?? null})
          returning id, name, company_name as "companyName", email, phone, source, status, priority, owner_membership_id as "ownerMembershipId", converted_customer_id as "convertedCustomerId", created_at as "createdAt", updated_at as "updatedAt"`;
        await tx`insert into crm_activity (id, tenant_id, lead_id, actor_user_id, type) values (${randomUUID()}, ${context.tenantId}, ${id}, ${context.userId}, 'lead.created')`;
        return rows[0]!;
      });
    } catch (error) {
      return mapDuplicate(error);
    }
  }

  async importLead(
    context: TenantContext,
    input: CreateLeadInput & { normalizedName: string; normalizedEmail: string | null; normalizedPhone: string | null },
    importReference: string
  ) {
    try {
      return await withTenant(this.database, context.tenantId, async (tx) => {
        const id = randomUUID();
        const rows = await tx<{ id: string }[]>`
          insert into leads (id, tenant_id, name, normalized_name, company_name, email, normalized_email,
            phone, normalized_phone, source, priority, owner_membership_id, import_reference)
          values (${id}, ${context.tenantId}, ${input.name}, ${input.normalizedName}, ${input.companyName ?? null},
            ${input.email ?? null}, ${input.normalizedEmail}, ${input.phone ?? null}, ${input.normalizedPhone},
            ${input.source}, ${input.priority}, ${input.ownerMembershipId ?? null}, ${importReference})
          on conflict (tenant_id, import_reference) where import_reference is not null do nothing
          returning id`;
        if (!rows[0]) return "already_imported" as const;
        await tx`insert into crm_activity (id, tenant_id, lead_id, actor_user_id, type, metadata)
          values (${randomUUID()}, ${context.tenantId}, ${id}, ${context.userId}, 'lead.imported',
            ${tx.json({ importReference })})`;
        return "imported" as const;
      });
    } catch (error) {
      return mapDuplicate(error);
    }
  }

  async transitionLead(context: TenantContext, leadId: string, status: LeadStatus) {
    return withTenant(this.database, context.tenantId, async (tx) => {
      const current = await tx<{ status: LeadStatus }[]>`
        select status from leads where tenant_id = ${context.tenantId} and id = ${leadId} for update`;
      if (!current[0]) throw new CrmError("LEAD_NOT_FOUND");
      const rows = await tx<
        LeadRecord[]
      >`update leads set status = ${status}, updated_at = now() where tenant_id = ${context.tenantId} and id = ${leadId}
        returning id, name, company_name as "companyName", email, phone, source, status, priority, owner_membership_id as "ownerMembershipId", converted_customer_id as "convertedCustomerId", created_at as "createdAt", updated_at as "updatedAt"`;
      await tx`insert into crm_activity (id, tenant_id, lead_id, actor_user_id, type, metadata) values (${randomUUID()}, ${context.tenantId}, ${leadId}, ${context.userId}, 'lead.status.changed', ${tx.json({ fromStatus: current[0].status, toStatus: status, status })})`;
      return rows[0]!;
    });
  }

  async reopenLead(context: TenantContext, leadId: string, reason: string) {
    return withTenant(this.database, context.tenantId, async (tx) => {
      const current = await tx<{ status: LeadStatus }[]>`
        select status from leads where tenant_id = ${context.tenantId} and id = ${leadId} for update`;
      if (!current[0]) throw new CrmError("LEAD_NOT_FOUND");
      if (current[0].status !== "lost") throw new CrmError("INVALID_TRANSITION");
      const history = await tx<{ status: LeadStatus | null }[]>`
        select coalesce(metadata->>'toStatus', metadata->>'status')::text as status
        from crm_activity
        where tenant_id = ${context.tenantId} and lead_id = ${leadId} and type = 'lead.status.changed'
        order by occurred_at desc, id desc`;
      const status = recoverLeadStatus(history.map((entry) => entry.status));
      const rows = await tx<LeadRecord[]>`
        update leads set status = ${status}, updated_at = now()
        where tenant_id = ${context.tenantId} and id = ${leadId}
        returning id, name, company_name as "companyName", email, phone, source, status, priority,
          owner_membership_id as "ownerMembershipId", converted_customer_id as "convertedCustomerId",
          created_at as "createdAt", updated_at as "updatedAt"`;
      await tx`insert into crm_activity (id, tenant_id, lead_id, actor_user_id, type, metadata)
        values (${randomUUID()}, ${context.tenantId}, ${leadId}, ${context.userId}, 'lead.reopened',
          ${tx.json({ fromStatus: "lost", toStatus: status, reason })})`;
      return rows[0]!;
    });
  }

  async convertLead(context: TenantContext, leadId: string) {
    try {
      return await withTenant(this.database, context.tenantId, async (tx) => {
        const leads = await tx<
          LeadRecord[]
        >`select id, name, company_name as "companyName", email, phone, source, status, priority, owner_membership_id as "ownerMembershipId", converted_customer_id as "convertedCustomerId", created_at as "createdAt", updated_at as "updatedAt" from leads where tenant_id = ${context.tenantId} and id = ${leadId} for update`;
        const lead = leads[0];
        if (!lead) throw new CrmError("LEAD_NOT_FOUND");
        if (lead.convertedCustomerId) {
          const existing = await tx<
            CustomerRecord[]
          >`select id, display_name as "displayName", legal_name as "legalName", billing_email as "billingEmail", phone, website, status, owner_membership_id as "ownerMembershipId", created_from_lead_id as "createdFromLeadId", created_at as "createdAt", updated_at as "updatedAt" from customers where tenant_id = ${context.tenantId} and id = ${lead.convertedCustomerId}`;
          return existing[0]!;
        }
        const customerId = randomUUID();
        const displayName = lead.companyName ?? lead.name;
        const customers = await tx<
          CustomerRecord[]
        >`insert into customers (id, tenant_id, display_name, normalized_name, billing_email, normalized_billing_email, phone, normalized_phone, owner_membership_id, created_from_lead_id)
          select ${customerId}, tenant_id, ${displayName}, normalized_name, email, normalized_email, phone, normalized_phone, owner_membership_id, id from leads where tenant_id = ${context.tenantId} and id = ${leadId}
          returning id, display_name as "displayName", legal_name as "legalName", billing_email as "billingEmail", phone, website, status, owner_membership_id as "ownerMembershipId", created_from_lead_id as "createdFromLeadId", created_at as "createdAt", updated_at as "updatedAt"`;
        if (lead.companyName) {
          const contactId = randomUUID();
          await tx`insert into contacts (id, tenant_id, customer_id, name, email, normalized_email, phone,
            normalized_phone, is_primary, source_lead_id)
            values (${contactId}, ${context.tenantId}, ${customerId}, ${lead.name}, ${lead.email},
              ${lead.email ? normalizeEmail(lead.email) : null}, ${lead.phone},
              ${lead.phone ? normalizePhone(lead.phone) : null}, true, ${lead.id})`;
          await tx`insert into crm_activity (id, tenant_id, customer_id, actor_user_id, type, metadata)
            values (${randomUUID()}, ${context.tenantId}, ${customerId}, ${context.userId}, 'contact.created',
              ${tx.json({ contactId, sourceLeadId: lead.id })})`;
        }
        await tx`update leads set status = 'won', converted_customer_id = ${customerId}, updated_at = now() where tenant_id = ${context.tenantId} and id = ${leadId}`;
        await tx`insert into crm_activity (id, tenant_id, customer_id, actor_user_id, type, metadata) values (${randomUUID()}, ${context.tenantId}, ${customerId}, ${context.userId}, 'lead.converted', ${tx.json({ leadId })})`;
        return customers[0]!;
      });
    } catch (error) {
      return mapDuplicate(error);
    }
  }

  async getCustomer(context: TenantContext, customerId: string): Promise<CustomerDetail> {
    return withTenant(this.database, context.tenantId, async (tx) => {
      const customers = await tx<
        CustomerRecord[]
      >`select id, display_name as "displayName", legal_name as "legalName", billing_email as "billingEmail", phone,
        website, tax_id as "taxId", preferred_locale as "preferredLocale", timezone, status,
        owner_membership_id as "ownerMembershipId", created_from_lead_id as "createdFromLeadId",
        created_at as "createdAt", updated_at as "updatedAt"
        from customers where tenant_id = ${context.tenantId} and id = ${customerId}`;
      const customer = customers[0];
      if (!customer) throw new CrmError("CUSTOMER_NOT_FOUND");
      const [
        contacts,
        notes,
        tasks,
        activity,
        services,
        projects,
        tickets,
        interestRows,
        availableProducts,
        addresses
      ] = await Promise.all([
        tx<
          ContactRecord[]
        >`select id, customer_id as "customerId", name, role, email, phone, is_primary as "isPrimary", source_lead_id as "sourceLeadId", created_at as "createdAt" from contacts where tenant_id = ${context.tenantId} and customer_id = ${customerId} order by is_primary desc, name`,
        tx<
          NoteRecord[]
        >`select id, body, author_user_id as "authorUserId", created_at as "createdAt" from crm_notes where tenant_id = ${context.tenantId} and customer_id = ${customerId} order by created_at desc`,
        tx<
          TaskRecord[]
        >`select id, title, due_at as "dueAt", completed_at as "completedAt", assignee_membership_id as "assigneeMembershipId", created_at as "createdAt" from crm_tasks where tenant_id = ${context.tenantId} and customer_id = ${customerId} order by completed_at nulls first, due_at nulls last`,
        tx<
          ActivityRecord[]
        >`select id, type, metadata, occurred_at as "occurredAt" from crm_activity where tenant_id = ${context.tenantId} and customer_id = ${customerId} order by occurred_at desc limit 200`,
        tx<CustomerServiceRecord[]>`
          select s.id, product.name as "productName", plan.name as "planName", s.status,
            s.started_at as "startedAt", s.renewal_at as "renewalAt"
          from subscriptions s
          join plans plan on plan.tenant_id = s.tenant_id and plan.id = s.plan_id
          join product_versions version on version.tenant_id = plan.tenant_id and version.id = plan.product_version_id
          join products product on product.tenant_id = version.tenant_id and product.id = version.product_id
          where s.tenant_id = ${context.tenantId} and s.customer_id = ${customerId}
          order by (s.status = 'active') desc, s.started_at desc`,
        tx<CustomerProjectRecord[]>`
          select id, code, name, status, started_at as "startedAt", due_at as "dueAt"
          from projects where tenant_id = ${context.tenantId} and customer_id = ${customerId}
          order by (status = 'active') desc, updated_at desc limit 50`,
        tx<CustomerTicketRecord[]>`
          select id, ticket_number::int as "ticketNumber", subject, status, priority, opened_at as "openedAt"
          from tickets where tenant_id = ${context.tenantId} and customer_id = ${customerId}
          order by (status not in ('resolved', 'closed')) desc, opened_at desc limit 50`,
        tx<CustomerProductInterestRow[]>`
          select interest.id, interest.product_id as "productId", product.name as "productName", interest.stage,
            interest.probability, interest.estimated_amount_minor as "estimatedAmountMinor", interest.currency,
            interest.next_step as "nextStep", interest.owner_membership_id as "ownerMembershipId",
            interest.created_at as "createdAt", interest.updated_at as "updatedAt"
          from customer_product_interests interest
          join products product on product.tenant_id = interest.tenant_id and product.id = interest.product_id
          where interest.tenant_id = ${context.tenantId} and interest.customer_id = ${customerId}
          order by (interest.stage not in ('won', 'lost')) desc, interest.updated_at desc`,
        tx<CustomerProductOption[]>`
          select id, name from products where tenant_id = ${context.tenantId} and status = 'active' order by name`,
        tx<CustomerAddressRecord[]>`
          select id, type, label, line1, line2, postal_code as "postalCode", city, region,
            country_code as "countryCode", is_primary as "isPrimary", created_at as "createdAt", updated_at as "updatedAt"
          from customer_addresses where tenant_id = ${context.tenantId} and customer_id = ${customerId}
          order by is_primary desc, type, created_at`
      ]);
      const canReadFinancials = context.permissions.includes("financials:read");
      const interests = interestRows.map((interest) => {
        const { estimatedAmountMinor, currency, ...safe } = interest;
        return canReadFinancials
          ? {
              ...safe,
              estimatedAmountMinor: estimatedAmountMinor === null ? null : Number(estimatedAmountMinor),
              currency
            }
          : safe;
      });
      return {
        ...customer,
        contacts,
        notes,
        tasks,
        activity,
        services,
        projects,
        tickets,
        interests,
        availableProducts,
        addresses
      };
    });
  }

  async addContact(
    context: TenantContext,
    customerId: string,
    input: { name: string; role?: string; email?: string; phone?: string; isPrimary: boolean }
  ) {
    try {
      return await withTenant(this.database, context.tenantId, async (tx) => {
        const exists = await tx`select 1 from customers where tenant_id = ${context.tenantId} and id = ${customerId}`;
        if (!exists[0]) throw new CrmError("CUSTOMER_NOT_FOUND");
        if (input.isPrimary)
          await tx`update contacts set is_primary = false, updated_at = now() where tenant_id = ${context.tenantId} and customer_id = ${customerId} and is_primary`;
        const id = randomUUID();
        const rows = await tx<
          ContactRecord[]
        >`insert into contacts (id, tenant_id, customer_id, name, role, email, normalized_email, phone, normalized_phone, is_primary) values (${id}, ${context.tenantId}, ${customerId}, ${input.name}, ${input.role ?? null}, ${input.email ?? null}, ${input.email ? normalizeEmail(input.email) : null}, ${input.phone ?? null}, ${input.phone ? normalizePhone(input.phone) : null}, ${input.isPrimary}) returning id, customer_id as "customerId", name, role, email, phone, is_primary as "isPrimary", source_lead_id as "sourceLeadId", created_at as "createdAt"`;
        await tx`insert into crm_activity (id, tenant_id, customer_id, actor_user_id, type, metadata) values (${randomUUID()}, ${context.tenantId}, ${customerId}, ${context.userId}, 'contact.created', ${tx.json({ contactId: id })})`;
        return rows[0]!;
      });
    } catch (error) {
      return mapDuplicate(error);
    }
  }

  async createContactFromSourceLead(context: TenantContext, customerId: string) {
    try {
      return await withTenant(this.database, context.tenantId, async (tx) => {
        const customers = await tx<{ sourceLeadId: string | null }[]>`
          select created_from_lead_id as "sourceLeadId" from customers
          where tenant_id = ${context.tenantId} and id = ${customerId} for update`;
        const customer = customers[0];
        if (!customer) throw new CrmError("CUSTOMER_NOT_FOUND");
        if (!customer.sourceLeadId) throw new CrmError("SOURCE_LEAD_NOT_AVAILABLE");
        const recovered = await tx<ContactRecord[]>`
          select id, customer_id as "customerId", name, role, email, phone, is_primary as "isPrimary",
            source_lead_id as "sourceLeadId", created_at as "createdAt"
          from contacts where tenant_id = ${context.tenantId} and source_lead_id = ${customer.sourceLeadId}`;
        if (recovered[0]) return recovered[0];
        const contacts = await tx`select 1 from contacts
          where tenant_id = ${context.tenantId} and customer_id = ${customerId} limit 1`;
        if (contacts[0]) throw new CrmError("CUSTOMER_ALREADY_HAS_CONTACTS");
        const leads = await tx<
          { id: string; name: string; companyName: string | null; email: string | null; phone: string | null }[]
        >`select id, name, company_name as "companyName", email, phone from leads
          where tenant_id = ${context.tenantId} and id = ${customer.sourceLeadId}`;
        const lead = leads[0];
        if (!lead?.companyName) throw new CrmError("SOURCE_LEAD_NOT_AVAILABLE");
        const id = randomUUID();
        const rows = await tx<ContactRecord[]>`
          insert into contacts (id, tenant_id, customer_id, name, email, normalized_email, phone,
            normalized_phone, is_primary, source_lead_id)
          values (${id}, ${context.tenantId}, ${customerId}, ${lead.name}, ${lead.email},
            ${lead.email ? normalizeEmail(lead.email) : null}, ${lead.phone},
            ${lead.phone ? normalizePhone(lead.phone) : null}, true, ${lead.id})
          returning id, customer_id as "customerId", name, role, email, phone, is_primary as "isPrimary",
            source_lead_id as "sourceLeadId", created_at as "createdAt"`;
        await tx`insert into crm_activity (id, tenant_id, customer_id, actor_user_id, type, metadata)
          values (${randomUUID()}, ${context.tenantId}, ${customerId}, ${context.userId},
            'contact.recovered_from_lead', ${tx.json({ contactId: id, sourceLeadId: lead.id })})`;
        return rows[0]!;
      });
    } catch (error) {
      return mapDuplicate(error);
    }
  }

  async updateCustomer(context: TenantContext, customerId: string, input: UpdateCustomerInput) {
    try {
      return await withTenant(this.database, context.tenantId, async (tx) => {
        const rows = await tx<CustomerRecord[]>`
          update customers set display_name = ${input.displayName},
            normalized_name = ${normalizeComparableName(input.displayName)}, legal_name = ${input.legalName ?? null},
            billing_email = ${input.billingEmail ?? null},
            normalized_billing_email = ${input.billingEmail ? normalizeEmail(input.billingEmail) : null},
            phone = ${input.phone ?? null}, normalized_phone = ${input.phone ? normalizePhone(input.phone) : null},
            website = ${input.website ?? null}, tax_id = ${input.taxId ?? null},
            preferred_locale = ${input.preferredLocale ?? null}, timezone = ${input.timezone ?? null},
            status = ${input.status},
            updated_at = date_trunc('milliseconds', now())
          where tenant_id = ${context.tenantId} and id = ${customerId}
            and date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', ${input.expectedUpdatedAt}::timestamptz)
          returning id, display_name as "displayName", legal_name as "legalName", billing_email as "billingEmail",
            phone, website, tax_id as "taxId", preferred_locale as "preferredLocale", timezone, status,
            owner_membership_id as "ownerMembershipId",
            created_from_lead_id as "createdFromLeadId", created_at as "createdAt", updated_at as "updatedAt"`;
        if (rows[0]) return rows[0];
        const exists = await tx`select 1 from customers where tenant_id = ${context.tenantId} and id = ${customerId}`;
        if (!exists[0]) throw new CrmError("CUSTOMER_NOT_FOUND");
        throw new CrmError("CUSTOMER_VERSION_CONFLICT");
      });
    } catch (error) {
      return mapDuplicate(error);
    }
  }

  async createCustomerInterest(context: TenantContext, customerId: string, input: CreateCustomerInterestInput) {
    try {
      return await withTenant(this.database, context.tenantId, async (tx) => {
        const id = randomUUID();
        const rows = await tx<{ id: string }[]>`
          insert into customer_product_interests
            (id, tenant_id, customer_id, product_id, probability, estimated_amount_minor, currency, next_step,
              owner_membership_id)
          select ${id}, ${context.tenantId}, customer.id, product.id, ${input.probability ?? null},
            ${input.estimatedAmountMinor ?? null}, ${input.currency ?? null}, ${input.nextStep ?? null},
            null
          from customers customer cross join products product
          where customer.tenant_id = ${context.tenantId} and customer.id = ${customerId}
            and product.tenant_id = ${context.tenantId} and product.id = ${input.productId}
            and product.status = 'active' returning id`;
        if (!rows[0]) {
          const customer =
            await tx`select 1 from customers where tenant_id = ${context.tenantId} and id = ${customerId}`;
          if (!customer[0]) throw new CrmError("CUSTOMER_NOT_FOUND");
          throw new CrmError("PRODUCT_NOT_FOUND");
        }
        await tx`insert into customer_product_interest_events
          (id, tenant_id, interest_id, actor_user_id, from_stage, to_stage)
          values (${randomUUID()}, ${context.tenantId}, ${id}, ${context.userId}, null, 'detected')`;
        return this.getCustomerInterestWithTransaction(tx, context, id);
      });
    } catch (error) {
      return mapDuplicate(error);
    }
  }

  getCustomerInterest(context: TenantContext, interestId: string) {
    return withTenant(this.database, context.tenantId, (tx) =>
      this.getCustomerInterestWithTransaction(tx, context, interestId)
    );
  }

  async transitionCustomerInterest(context: TenantContext, interestId: string, stage: CustomerInterestStage) {
    return withTenant(this.database, context.tenantId, async (tx) => {
      const current = await this.getCustomerInterestWithTransaction(tx, context, interestId);
      const rows = await tx`update customer_product_interests set stage = ${stage}, updated_at = now()
        where tenant_id = ${context.tenantId} and id = ${interestId} returning id`;
      if (!rows[0]) throw new CrmError("INTEREST_NOT_FOUND");
      await tx`insert into customer_product_interest_events
        (id, tenant_id, interest_id, actor_user_id, from_stage, to_stage)
        values (${randomUUID()}, ${context.tenantId}, ${interestId}, ${context.userId}, ${current.stage}, ${stage})`;
      return this.getCustomerInterestWithTransaction(tx, context, interestId);
    });
  }

  private async getCustomerInterestWithTransaction(
    tx: postgres.TransactionSql,
    context: TenantContext,
    interestId: string
  ): Promise<CustomerProductInterestRecord> {
    const rows = await tx<CustomerProductInterestRow[]>`
      select interest.id, interest.product_id as "productId", product.name as "productName", interest.stage,
        interest.probability, interest.estimated_amount_minor as "estimatedAmountMinor", interest.currency,
        interest.next_step as "nextStep", interest.owner_membership_id as "ownerMembershipId",
        interest.created_at as "createdAt", interest.updated_at as "updatedAt"
      from customer_product_interests interest
      join products product on product.tenant_id = interest.tenant_id and product.id = interest.product_id
      where interest.tenant_id = ${context.tenantId} and interest.id = ${interestId}`;
    const row = rows[0];
    if (!row) throw new CrmError("INTEREST_NOT_FOUND");
    const { estimatedAmountMinor, currency, ...safe } = row;
    return context.permissions.includes("financials:read")
      ? { ...safe, estimatedAmountMinor: estimatedAmountMinor === null ? null : Number(estimatedAmountMinor), currency }
      : safe;
  }

  async createCustomerAddress(context: TenantContext, customerId: string, input: CreateCustomerAddressInput) {
    return withTenant(this.database, context.tenantId, async (tx) => {
      const id = randomUUID();
      if (input.isPrimary)
        await tx`update customer_addresses set is_primary = false, updated_at = now()
          where tenant_id = ${context.tenantId} and customer_id = ${customerId} and type = ${input.type} and is_primary`;
      const rows = await tx<CustomerAddressRecord[]>`
        insert into customer_addresses
          (id, tenant_id, customer_id, type, label, line1, line2, postal_code, city, region, country_code, is_primary)
        select ${id}, ${context.tenantId}, id, ${input.type}, ${input.label ?? null}, ${input.line1},
          ${input.line2 ?? null}, ${input.postalCode ?? null}, ${input.city}, ${input.region ?? null},
          ${input.countryCode}, ${input.isPrimary}
        from customers where tenant_id = ${context.tenantId} and id = ${customerId}
        returning id, type, label, line1, line2, postal_code as "postalCode", city, region,
          country_code as "countryCode", is_primary as "isPrimary", created_at as "createdAt", updated_at as "updatedAt"`;
      if (!rows[0]) throw new CrmError("CUSTOMER_NOT_FOUND");
      return rows[0];
    });
  }

  async deleteCustomerAddress(context: TenantContext, customerId: string, addressId: string) {
    return withTenant(this.database, context.tenantId, async (tx) => {
      const rows = await tx`delete from customer_addresses
        where tenant_id = ${context.tenantId} and customer_id = ${customerId} and id = ${addressId} returning id`;
      if (!rows[0]) throw new CrmError("ADDRESS_NOT_FOUND");
    });
  }

  async addNote(context: TenantContext, customerId: string, body: string) {
    return withTenant(this.database, context.tenantId, async (tx) => {
      const id = randomUUID();
      const rows = await tx<
        NoteRecord[]
      >`insert into crm_notes (id, tenant_id, customer_id, body, author_user_id) select ${id}, ${context.tenantId}, id, ${body}, ${context.userId} from customers where tenant_id = ${context.tenantId} and id = ${customerId} returning id, body, author_user_id as "authorUserId", created_at as "createdAt"`;
      if (!rows[0]) throw new CrmError("CUSTOMER_NOT_FOUND");
      await tx`insert into crm_activity (id, tenant_id, customer_id, actor_user_id, type) values (${randomUUID()}, ${context.tenantId}, ${customerId}, ${context.userId}, 'note.created')`;
      return rows[0];
    });
  }

  async addTask(
    context: TenantContext,
    customerId: string,
    input: { title: string; dueAt?: Date; assigneeMembershipId?: string }
  ) {
    return withTenant(this.database, context.tenantId, async (tx) => {
      const id = randomUUID();
      const rows = await tx<
        TaskRecord[]
      >`insert into crm_tasks (id, tenant_id, customer_id, title, due_at, assignee_membership_id) select ${id}, ${context.tenantId}, id, ${input.title}, ${input.dueAt ?? null}, ${input.assigneeMembershipId ?? null} from customers where tenant_id = ${context.tenantId} and id = ${customerId} returning id, title, due_at as "dueAt", completed_at as "completedAt", assignee_membership_id as "assigneeMembershipId", created_at as "createdAt"`;
      if (!rows[0]) throw new CrmError("CUSTOMER_NOT_FOUND");
      await tx`insert into crm_activity (id, tenant_id, customer_id, actor_user_id, type, metadata) values (${randomUUID()}, ${context.tenantId}, ${customerId}, ${context.userId}, 'task.created', ${tx.json({ taskId: id })})`;
      return rows[0];
    });
  }

  async completeTask(context: TenantContext, taskId: string) {
    return withTenant(this.database, context.tenantId, async (tx) => {
      const rows = await tx<
        TaskRecord[]
      >`update crm_tasks set completed_at = coalesce(completed_at, now()), updated_at = now() where tenant_id = ${context.tenantId} and id = ${taskId} returning id, title, due_at as "dueAt", completed_at as "completedAt", assignee_membership_id as "assigneeMembershipId", created_at as "createdAt"`;
      if (!rows[0]) throw new CrmError("CUSTOMER_NOT_FOUND");
      const entity = await tx<
        { customer_id: string }[]
      >`select customer_id from crm_tasks where tenant_id = ${context.tenantId} and id = ${taskId}`;
      await tx`insert into crm_activity (id, tenant_id, customer_id, actor_user_id, type, metadata) values (${randomUUID()}, ${context.tenantId}, ${entity[0]!.customer_id}, ${context.userId}, 'task.completed', ${tx.json({ taskId })})`;
      return rows[0];
    });
  }

  async commercialSummary(context: TenantContext): Promise<CommercialSummary> {
    return withTenant(this.database, context.tenantId, async (tx) => {
      const leadCounts = await tx<
        { status: LeadStatus; count: number }[]
      >`select status, count(*)::int as count from leads where tenant_id = ${context.tenantId} group by status`;
      const [metrics] = await tx<
        { active_customers: number; open_tasks: number; overdue_tasks: number }[]
      >`select (select count(*)::int from customers where tenant_id = ${context.tenantId} and status = 'active') active_customers, (select count(*)::int from crm_tasks where tenant_id = ${context.tenantId} and completed_at is null) open_tasks, (select count(*)::int from crm_tasks where tenant_id = ${context.tenantId} and completed_at is null and due_at < now()) overdue_tasks`;
      const leadsByStatus = Object.fromEntries(
        leadStatuses.map((status) => [status, leadCounts.find((row) => row.status === status)?.count ?? 0])
      ) as Record<LeadStatus, number>;
      return {
        leadsByStatus,
        activeCustomers: metrics?.active_customers ?? 0,
        openTasks: metrics?.open_tasks ?? 0,
        overdueTasks: metrics?.overdue_tasks ?? 0
      };
    });
  }
}

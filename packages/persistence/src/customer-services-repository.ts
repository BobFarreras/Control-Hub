import { randomUUID } from "node:crypto";
import {
  CustomerServicesError,
  type CreateCustomerServiceInput,
  type CustomerContractRecord,
  type CustomerServiceFilters,
  type CustomerServiceOffering,
  type CustomerServicesRepository
} from "@control-hub/application";
import { withTenant, type DatabaseClient } from "@control-hub/database";
import type { TenantContext } from "@control-hub/domain";

type CustomerServiceRow = Omit<CustomerContractRecord, "amountMinor" | "costMinor"> & {
  amountMinor: string | number;
  costMinor: string | number;
};

const selectCustomerServices = `select cs.id, cs.customer_id as "customerId", c.display_name as "customerName", pv.product_id as "productId", product.name as "productName", cs.plan_id as "planId", p.name as "planName", cs.price_id as "priceId", cs.commercial_model as "commercialModel", cs.status, cs.quantity, cs.contracted_at as "contractedAt", cs.starts_at as "startsAt", cs.ends_at as "endsAt", cs.owner_membership_id as "ownerMembershipId", owner_user.name as "ownerName", cs.project_id as "projectId", project.name as "projectName", cs.canceled_at as "canceledAt", pp.currency, pp.amount_minor as "amountMinor", pp.cost_minor as "costMinor", pp.tax_basis_points as "taxBasisPoints", pp.billing_interval as interval, recurrence.current_period_start as "currentPeriodStart", recurrence.renewal_at as "renewalAt", recurrence.auto_renew as "autoRenew", recurrence.renewal_alert_days as "renewalAlertDays", cs.created_at as "createdAt", cs.updated_at as "updatedAt" from customer_services cs join customers c on c.tenant_id = cs.tenant_id and c.id = cs.customer_id join plans p on p.tenant_id = cs.tenant_id and p.id = cs.plan_id join product_versions pv on pv.tenant_id = p.tenant_id and pv.id = p.product_version_id join products product on product.tenant_id = pv.tenant_id and product.id = pv.product_id join plan_prices pp on pp.tenant_id = cs.tenant_id and pp.plan_id = cs.plan_id and pp.id = cs.price_id left join customer_service_recurrence recurrence on recurrence.tenant_id = cs.tenant_id and recurrence.customer_service_id = cs.id left join memberships owner_membership on owner_membership.tenant_id = cs.tenant_id and owner_membership.id = cs.owner_membership_id left join "user" owner_user on owner_user.id = owner_membership.user_id left join projects project on project.tenant_id = cs.tenant_id and project.id = cs.project_id`;

function record(row: CustomerServiceRow): CustomerContractRecord {
  return { ...row, amountMinor: Number(row.amountMinor), costMinor: Number(row.costMinor) };
}

export class PostgresCustomerServicesRepository implements CustomerServicesRepository {
  constructor(private readonly database: DatabaseClient) {}

  list(context: TenantContext, filters: CustomerServiceFilters) {
    return withTenant(this.database, context.tenantId, async (tx) => {
      const clauses = ["cs.tenant_id = $1"];
      const values: (string | Date)[] = [context.tenantId];
      const add = (column: string, value: string | Date, operator = "=") => {
        values.push(value);
        clauses.push(`${column} ${operator} $${values.length}`);
      };
      if (filters.customerId) add("cs.customer_id", filters.customerId);
      if (filters.productId) add("pv.product_id", filters.productId);
      if (filters.commercialModel) add("cs.commercial_model", filters.commercialModel);
      if (filters.status) add("cs.status", filters.status);
      if (filters.ownerMembershipId) add("cs.owner_membership_id", filters.ownerMembershipId);
      if (filters.currency) add("pp.currency", filters.currency);
      if (filters.renewalBefore) add("recurrence.renewal_at", filters.renewalBefore, "<=");
      const rows = await tx.unsafe<CustomerServiceRow[]>(
        `${selectCustomerServices} where ${clauses.join(" and ")} order by cs.updated_at desc`,
        values
      );
      return rows.map(record);
    });
  }

  resolveOffering(context: TenantContext, planId: string, priceId: string) {
    return withTenant(this.database, context.tenantId, async (tx) => {
      const rows = await tx<CustomerServiceOffering[]>`
        select p.commercial_model as "commercialModel", pp.billing_interval as interval
        from plans p
        join plan_prices pp on pp.tenant_id = p.tenant_id and pp.plan_id = p.id
        where p.tenant_id = ${context.tenantId} and p.id = ${planId} and pp.id = ${priceId}`;
      return rows[0] ?? null;
    });
  }

  async create(context: TenantContext, input: CreateCustomerServiceInput) {
    try {
      return await withTenant(this.database, context.tenantId, async (tx) => {
        const id = randomUUID();
        const rows = await tx<{ commercialModel: CustomerContractRecord["commercialModel"] }[]>`
        select p.commercial_model as "commercialModel"
        from customers c
        join plans p on p.tenant_id = c.tenant_id and p.id = ${input.planId}
        join plan_prices pp on pp.tenant_id = p.tenant_id and pp.plan_id = p.id and pp.id = ${input.priceId}
        where c.tenant_id = ${context.tenantId} and c.id = ${input.customerId}`;
        const commercialModel = rows[0]?.commercialModel;
        if (!commercialModel) throw new CustomerServicesError("CUSTOMER_SERVICE_OFFERING_NOT_FOUND");

        const recurring = commercialModel === "subscription" || commercialModel === "maintenance";
        if (recurring !== (input.currentPeriodStart !== undefined)) throw new CustomerServicesError("INVALID_INPUT");

        await tx`insert into customer_services (id, tenant_id, customer_id, plan_id, price_id, commercial_model, quantity, contracted_at, starts_at, ends_at, owner_membership_id, project_id) values (${id}, ${context.tenantId}, ${input.customerId}, ${input.planId}, ${input.priceId}, ${commercialModel}, ${input.quantity}, ${input.contractedAt}, ${input.startsAt}, ${input.endsAt ?? null}, ${input.ownerMembershipId ?? null}, ${input.projectId ?? null})`;
        if (recurring) {
          await tx`insert into customer_service_recurrence (customer_service_id, tenant_id, current_period_start, renewal_at, auto_renew, renewal_alert_days) values (${id}, ${context.tenantId}, ${input.currentPeriodStart!}, ${input.renewalAt ?? null}, ${input.autoRenew ?? false}, ${input.renewalAlertDays ?? 14})`;
        }
        await tx`insert into customer_service_events (id, tenant_id, customer_service_id, actor_user_id, type, effective_at) values (${randomUUID()}, ${context.tenantId}, ${id}, ${context.userId}, 'created', ${input.contractedAt})`;

        const created = await tx.unsafe<CustomerServiceRow[]>(
          `${selectCustomerServices} where cs.tenant_id = $1 and cs.id = $2`,
          [context.tenantId, id]
        );
        return record(created[0]!);
      });
    } catch (error) {
      if (error instanceof CustomerServicesError) throw error;
      const code = (error as { code?: string }).code;
      if (code === "23503" || code === "23514" || code === "22P02")
        throw new CustomerServicesError("CUSTOMER_SERVICE_REFERENCE_INVALID");
      throw error;
    }
  }
}

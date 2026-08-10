import { randomUUID } from "node:crypto";
import {
  CompanySubscriptionError,
  type CompanySubscriptionFilters,
  type CompanySubscriptionRecord,
  type CompanySubscriptionRepository,
  type CreateCompanySubscription,
  type TransitionCompanySubscriptionInput
} from "@control-hub/application";
import { withTenant, type DatabaseClient } from "@control-hub/database";
import type { TenantContext } from "@control-hub/domain";

const select = `select cs.id, cs.provider, cs.service_name as "serviceName", cs.category, cs.status,
  cs.currency, cs.amount_minor as "amountMinor", cs.billing_interval as interval,
  cs.renewal_at as "renewalAt", cs.renewal_alert_days as "renewalAlertDays",
  cs.auto_renew as "autoRenew", cs.website_url as "websiteUrl", cs.notes,
  cs.account_email as "accountEmail", cs.owner_membership_id as "ownerMembershipId",
  coalesce(nullif(trim(u.name), ''), u.email) as "ownerName",
  cs.quantity, cs.started_at as "startedAt", cs.trial_ends_at as "trialEndsAt",
  cs.cancel_before_at as "cancelBeforeAt", cs.canceled_at as "canceledAt",
  cs.cost_center as "costCenter", cs.payment_method_label as "paymentMethodLabel",
  cs.secret_manager_url as "secretManagerUrl", cs.created_at as "createdAt", cs.updated_at as "updatedAt"
from company_subscriptions cs
left join memberships m on m.tenant_id = cs.tenant_id and m.id = cs.owner_membership_id
left join "user" u on u.id = m.user_id`;

function filtersSql(filters: CompanySubscriptionFilters) {
  const clauses: string[] = ["cs.tenant_id = $1"];
  const values: string[] = [];
  const add = (clause: string, value: string) => {
    values.push(value);
    clauses.push(clause.replace("?", `$${values.length + 1}`));
  };
  if (filters.status) add("cs.status = ?", filters.status);
  if (filters.category) add("cs.category = ?", filters.category);
  if (filters.ownerMembershipId) add("cs.owner_membership_id = ?", filters.ownerMembershipId);
  if (filters.currency) add("cs.currency = ?", filters.currency);
  if (filters.renewalState === "missing") clauses.push("cs.renewal_at is null");
  if (filters.renewalState === "due_soon") {
    clauses.push(
      "cs.renewal_at is not null and cs.renewal_at >= now() and cs.renewal_at <= now() + make_interval(days => cs.renewal_alert_days)"
    );
  }
  return { where: clauses.join(" and "), values };
}

export class PostgresCompanySubscriptionRepository implements CompanySubscriptionRepository {
  constructor(private readonly database: DatabaseClient) {}

  list(context: TenantContext, filters: CompanySubscriptionFilters = {}) {
    const query = filtersSql(filters);
    return withTenant(this.database, context.tenantId, (tx) =>
      tx.unsafe<CompanySubscriptionRecord[]>(
        `${select} where ${query.where} order by coalesce(cs.renewal_at, 'infinity'), cs.service_name`,
        [context.tenantId, ...query.values]
      )
    );
  }

  async create(context: TenantContext, input: CreateCompanySubscription) {
    try {
      return await withTenant(this.database, context.tenantId, async (tx) => {
        const id = randomUUID();
        const rows = await tx.unsafe<CompanySubscriptionRecord[]>(
          `insert into company_subscriptions (
          id, tenant_id, provider, service_name, category, status, currency, amount_minor,
          billing_interval, renewal_at, renewal_alert_days, auto_renew, website_url, notes,
          account_email, owner_membership_id, quantity, started_at, trial_ends_at,
          cancel_before_at, cost_center, payment_method_label, secret_manager_url
        ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
        returning id, provider, service_name as "serviceName", category, status, currency,
          amount_minor as "amountMinor", billing_interval as interval, renewal_at as "renewalAt",
          renewal_alert_days as "renewalAlertDays", auto_renew as "autoRenew",
          website_url as "websiteUrl", notes, account_email as "accountEmail",
          owner_membership_id as "ownerMembershipId", null::text as "ownerName", quantity,
          started_at as "startedAt", trial_ends_at as "trialEndsAt", cancel_before_at as "cancelBeforeAt",
          canceled_at as "canceledAt", cost_center as "costCenter",
          payment_method_label as "paymentMethodLabel", secret_manager_url as "secretManagerUrl",
          created_at as "createdAt", updated_at as "updatedAt"`,
          [
            id,
            context.tenantId,
            input.provider,
            input.serviceName,
            input.category,
            input.status,
            input.currency,
            input.amountMinor,
            input.interval,
            input.renewalAt,
            input.renewalAlertDays,
            input.autoRenew,
            input.websiteUrl,
            input.notes,
            input.accountEmail ?? null,
            input.ownerMembershipId ?? null,
            input.quantity ?? 1,
            input.startedAt ?? null,
            input.trialEndsAt ?? null,
            input.cancelBeforeAt ?? null,
            input.costCenter ?? null,
            input.paymentMethodLabel ?? null,
            input.secretManagerUrl ?? null
          ]
        );
        await tx`
        insert into company_subscription_events
          (id, tenant_id, company_subscription_id, actor_user_id, type, effective_at)
        values (${randomUUID()}, ${context.tenantId}, ${id}, ${context.userId}, 'created', now())
      `;
        return rows[0]!;
      });
    } catch (error) {
      if (typeof error === "object" && error && "code" in error && error.code === "23503")
        throw new CompanySubscriptionError("COMPANY_SUBSCRIPTION_REFERENCE_INVALID");
      throw error;
    }
  }

  async getById(context: TenantContext, id: string) {
    const rows = await withTenant(this.database, context.tenantId, (tx) =>
      tx.unsafe<CompanySubscriptionRecord[]>(`${select} where cs.tenant_id = $1 and cs.id = $2`, [context.tenantId, id])
    );
    return rows[0] ?? null;
  }

  transition(
    context: TenantContext,
    input: TransitionCompanySubscriptionInput & {
      expectedStatus: CompanySubscriptionRecord["status"];
      targetStatus: CompanySubscriptionRecord["status"];
      eventType: "activated" | "paused" | "resumed" | "canceled";
    }
  ) {
    return withTenant(this.database, context.tenantId, async (tx) => {
      const rows = await tx.unsafe<CompanySubscriptionRecord[]>(
        `update company_subscriptions cs
         set status = $4, canceled_at = case when $4 = 'canceled' then $5 else null end, updated_at = now()
         where cs.tenant_id = $1 and cs.id = $2 and cs.status = $3
         returning cs.id, cs.provider, cs.service_name as "serviceName", cs.category, cs.status,
           cs.currency, cs.amount_minor as "amountMinor", cs.billing_interval as interval,
           cs.renewal_at as "renewalAt", cs.renewal_alert_days as "renewalAlertDays",
           cs.auto_renew as "autoRenew", cs.website_url as "websiteUrl", cs.notes,
           cs.account_email as "accountEmail", cs.owner_membership_id as "ownerMembershipId",
           null::text as "ownerName", cs.quantity, cs.started_at as "startedAt",
           cs.trial_ends_at as "trialEndsAt", cs.cancel_before_at as "cancelBeforeAt",
           cs.canceled_at as "canceledAt", cs.cost_center as "costCenter",
           cs.payment_method_label as "paymentMethodLabel", cs.secret_manager_url as "secretManagerUrl",
           cs.created_at as "createdAt", cs.updated_at as "updatedAt"`,
        [context.tenantId, input.subscriptionId, input.expectedStatus, input.targetStatus, input.effectiveAt]
      );
      if (!rows[0]) throw new CompanySubscriptionError("COMPANY_SUBSCRIPTION_CONFLICT");
      await tx`
        insert into company_subscription_events
          (id, tenant_id, company_subscription_id, actor_user_id, type, effective_at, metadata)
        values (${randomUUID()}, ${context.tenantId}, ${input.subscriptionId}, ${context.userId},
          ${input.eventType}, ${input.effectiveAt}, ${tx.json(input.reason ? { reason: input.reason } : {})})
      `;
      return rows[0];
    });
  }
}

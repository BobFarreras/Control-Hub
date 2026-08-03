import { randomUUID } from "node:crypto";
import { CompanySubscriptionError, type CompanySubscriptionRecord, type CompanySubscriptionRepository, type CreateCompanySubscription, type CompanySubscriptionStatus } from "@control-hub/application";
import { withTenant, type DatabaseClient } from "@control-hub/database";
import type { TenantContext } from "@control-hub/domain";

const select = `select id, provider, service_name as "serviceName", category, status, currency, amount_minor as "amountMinor", billing_interval as interval, renewal_at as "renewalAt", renewal_alert_days as "renewalAlertDays", auto_renew as "autoRenew", website_url as "websiteUrl", notes, created_at as "createdAt", updated_at as "updatedAt" from company_subscriptions`;

export class PostgresCompanySubscriptionRepository implements CompanySubscriptionRepository {
  constructor(private readonly database: DatabaseClient) {}
  list(context: TenantContext) { return withTenant(this.database, context.tenantId, (tx) => tx.unsafe<CompanySubscriptionRecord[]>(`${select} where tenant_id = $1 order by coalesce(renewal_at, 'infinity'), service_name`, [context.tenantId])); }
  async create(context: TenantContext, input: CreateCompanySubscription) {
    try {
      return await withTenant(this.database, context.tenantId, async (tx) => {
        const rows = await tx.unsafe<CompanySubscriptionRecord[]>(`insert into company_subscriptions (id, tenant_id, provider, service_name, category, status, currency, amount_minor, billing_interval, renewal_at, renewal_alert_days, auto_renew, website_url, notes) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) returning id, provider, service_name as "serviceName", category, status, currency, amount_minor as "amountMinor", billing_interval as interval, renewal_at as "renewalAt", renewal_alert_days as "renewalAlertDays", auto_renew as "autoRenew", website_url as "websiteUrl", notes, created_at as "createdAt", updated_at as "updatedAt"`, [randomUUID(), context.tenantId, input.provider, input.serviceName, input.category, input.status, input.currency, input.amountMinor, input.interval, input.renewalAt, input.renewalAlertDays, input.autoRenew, input.websiteUrl, input.notes]);
        return rows[0]!;
      });
    } catch (error) { if (typeof error === "object" && error && "code" in error && error.code === "23505") throw new CompanySubscriptionError("DUPLICATE_SUBSCRIPTION"); throw error; }
  }
  updateStatus(context: TenantContext, id: string, status: CompanySubscriptionStatus) {
    return withTenant(this.database, context.tenantId, async (tx) => { const rows = await tx.unsafe<CompanySubscriptionRecord[]>(`update company_subscriptions set status = $3, updated_at = now() where tenant_id = $1 and id = $2 returning id, provider, service_name as "serviceName", category, status, currency, amount_minor as "amountMinor", billing_interval as interval, renewal_at as "renewalAt", renewal_alert_days as "renewalAlertDays", auto_renew as "autoRenew", website_url as "websiteUrl", notes, created_at as "createdAt", updated_at as "updatedAt"`, [context.tenantId, id, status]); if (!rows[0]) throw new CompanySubscriptionError("COMPANY_SUBSCRIPTION_NOT_FOUND"); return rows[0]; });
  }
}

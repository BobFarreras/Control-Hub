import type { CompanySubscriptionRecord } from "@control-hub/application";
import { createCompanyExpensesWorkbook } from "../company-expenses-export.js";
import { requirePermission, resolveTenantContext, writeAudit } from "../security.js";
import type { CompanySubscriptionContext } from "./context.js";

export function companySubscriptionResponse(subscription: CompanySubscriptionRecord, canReadFinancials: boolean) {
  const { amountMinor, currency, interval, ...operational } = subscription;
  return {
    ...operational,
    ...(canReadFinancials ? { financials: { amountMinor, currency, interval } } : {})
  };
}

/** What the company itself pays for: recurring spend, renewals and cancellations. */
export function registerCompanySubscriptionRoutes({
  app,
  database,
  auth,
  companySubscriptions
}: CompanySubscriptionContext) {
  app.get<{
    Querystring: {
      status?: "active" | "trial" | "paused" | "canceled";
      category?: "saas" | "api" | "infrastructure" | "domain" | "license" | "other";
      ownerMembershipId?: string;
      currency?: string;
      renewalState?: "due_soon" | "missing";
    };
  }>(
    "/api/v1/company-subscriptions",
    {
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            status: { type: "string", enum: ["active", "trial", "paused", "canceled"] },
            category: { type: "string", enum: ["saas", "api", "infrastructure", "domain", "license", "other"] },
            ownerMembershipId: { type: "string", format: "uuid" },
            currency: { type: "string", pattern: "^[A-Z]{3}$" },
            renewalState: { type: "string", enum: ["due_soon", "missing"] }
          }
        }
      }
    },
    async (request) => {
      const context = await resolveTenantContext(auth, database, request);
      requirePermission(context, "subscriptions:manage");
      const subscriptions = await companySubscriptions.list(context, request.query);
      const canReadFinancials = context.permissions.includes("financials:read");
      return {
        subscriptions: subscriptions.map((subscription) => companySubscriptionResponse(subscription, canReadFinancials))
      };
    }
  );

  app.get<{
    Querystring: {
      status?: "active" | "trial" | "paused" | "canceled";
      category?: "saas" | "api" | "infrastructure" | "domain" | "license" | "other";
      ownerMembershipId?: string;
      currency?: string;
      renewalState?: "due_soon" | "missing";
      locale?: "ca" | "es" | "en";
    };
  }>(
    "/api/v1/company-subscriptions/export",
    {
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            status: { type: "string", enum: ["active", "trial", "paused", "canceled"] },
            category: { type: "string", enum: ["saas", "api", "infrastructure", "domain", "license", "other"] },
            ownerMembershipId: { type: "string", format: "uuid" },
            currency: { type: "string", pattern: "^[A-Z]{3}$" },
            renewalState: { type: "string", enum: ["due_soon", "missing"] },
            locale: { type: "string", enum: ["ca", "es", "en"], default: "ca" }
          }
        }
      }
    },
    async (request, reply) => {
      const context = await resolveTenantContext(auth, database, request);
      requirePermission(context, "subscriptions:manage");
      const { locale = "ca", ...filters } = request.query;
      const subscriptions = await companySubscriptions.list(context, filters);
      const exportedAt = new Date();
      const workbook = await createCompanyExpensesWorkbook({
        subscriptions,
        locale,
        tenantId: context.tenantId,
        filters,
        exportedAt,
        includeFinancials: context.permissions.includes("financials:read")
      });
      await writeAudit(database, context, request, {
        action: "company_subscription.exported",
        targetType: "company_subscription",
        outcome: "success",
        metadata: {
          rows: subscriptions.length,
          status: filters.status ?? null,
          renewalState: filters.renewalState ?? null
        }
      });
      return reply
        .type("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        .header(
          "content-disposition",
          `attachment; filename=control-hub-company-expenses-${exportedAt.toISOString().slice(0, 10)}.xlsx`
        )
        .send(Buffer.from(workbook));
    }
  );

  app.post<{
    Body: {
      provider: string;
      serviceName: string;
      category: "saas" | "api" | "infrastructure" | "domain" | "license" | "other";
      status: "active" | "trial";
      currency: string;
      amountMinor: number;
      interval: "monthly" | "quarterly" | "semiannual" | "annual";
      renewalAt?: string;
      renewalAlertDays: number;
      autoRenew: boolean;
      websiteUrl?: string | null;
      notes?: string | null;
      accountEmail?: string | null;
      ownerMembershipId?: string | null;
      quantity?: number;
      startedAt?: string;
      trialEndsAt?: string;
      cancelBeforeAt?: string;
      costCenter?: string | null;
      paymentMethodLabel?: string | null;
      secretManagerUrl?: string | null;
    };
  }>(
    "/api/v1/company-subscriptions",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: [
            "provider",
            "serviceName",
            "category",
            "status",
            "currency",
            "amountMinor",
            "interval",
            "renewalAlertDays",
            "autoRenew"
          ],
          properties: {
            provider: { type: "string", minLength: 1, maxLength: 160 },
            serviceName: { type: "string", minLength: 1, maxLength: 160 },
            category: { type: "string", enum: ["saas", "api", "infrastructure", "domain", "license", "other"] },
            status: { type: "string", enum: ["active", "trial"] },
            currency: { type: "string", pattern: "^[A-Za-z]{3}$" },
            amountMinor: { type: "integer", minimum: 0, maximum: 9007199254740991 },
            interval: { type: "string", enum: ["monthly", "quarterly", "semiannual", "annual"] },
            renewalAt: { type: "string", format: "date-time" },
            renewalAlertDays: { type: "integer", minimum: 0, maximum: 365 },
            autoRenew: { type: "boolean" },
            websiteUrl: { type: ["string", "null"], format: "uri", maxLength: 2048 },
            notes: { type: ["string", "null"], maxLength: 4000 },
            accountEmail: { type: ["string", "null"], maxLength: 320 },
            ownerMembershipId: { type: ["string", "null"], format: "uuid" },
            quantity: { type: "integer", minimum: 1, maximum: 1000000 },
            startedAt: { type: "string", format: "date-time" },
            trialEndsAt: { type: "string", format: "date-time" },
            cancelBeforeAt: { type: "string", format: "date-time" },
            costCenter: { type: ["string", "null"], maxLength: 120 },
            paymentMethodLabel: { type: ["string", "null"], maxLength: 120 },
            secretManagerUrl: { type: ["string", "null"], format: "uri", maxLength: 2048 }
          }
        }
      }
    },
    async (request, reply) => {
      const context = await resolveTenantContext(auth, database, request);
      requirePermission(context, "subscriptions:manage");
      const { startedAt, trialEndsAt, cancelBeforeAt, renewalAt, ...fields } = request.body;
      const subscription = await companySubscriptions.create(context, {
        ...fields,
        currency: request.body.currency.toUpperCase(),
        renewalAt: renewalAt ? new Date(renewalAt) : null,
        websiteUrl: request.body.websiteUrl ?? null,
        notes: request.body.notes ?? null,
        ...(startedAt ? { startedAt: new Date(startedAt) } : {}),
        ...(trialEndsAt ? { trialEndsAt: new Date(trialEndsAt) } : {}),
        ...(cancelBeforeAt ? { cancelBeforeAt: new Date(cancelBeforeAt) } : {})
      });
      await writeAudit(database, context, request, {
        action: "company_subscription.created",
        targetType: "company_subscription",
        targetId: subscription.id,
        outcome: "success",
        metadata: { category: subscription.category, status: subscription.status }
      });
      return reply.code(201).send({
        subscription: companySubscriptionResponse(subscription, context.permissions.includes("financials:read"))
      });
    }
  );

  app.patch<{
    Params: { subscriptionId: string };
    Body: {
      expectedUpdatedAt: string;
      provider?: string;
      serviceName?: string;
      category?: "saas" | "api" | "infrastructure" | "domain" | "license" | "other";
      currency?: string;
      amountMinor?: number;
      interval?: "monthly" | "quarterly" | "semiannual" | "annual";
      renewalAt?: string;
      renewalAlertDays?: number;
      autoRenew?: boolean;
      websiteUrl?: string | null;
      notes?: string | null;
      accountEmail?: string | null;
      ownerMembershipId?: string | null;
      quantity?: number;
      startedAt?: string;
      trialEndsAt?: string;
      cancelBeforeAt?: string;
      costCenter?: string | null;
      paymentMethodLabel?: string | null;
      secretManagerUrl?: string | null;
    };
  }>(
    "/api/v1/company-subscriptions/:subscriptionId",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["subscriptionId"],
          properties: { subscriptionId: { type: "string", format: "uuid" } }
        },
        body: {
          type: "object",
          additionalProperties: false,
          required: ["expectedUpdatedAt"],
          properties: {
            expectedUpdatedAt: { type: "string", format: "date-time" },
            provider: { type: "string", minLength: 1, maxLength: 160 },
            serviceName: { type: "string", minLength: 1, maxLength: 160 },
            category: { type: "string", enum: ["saas", "api", "infrastructure", "domain", "license", "other"] },
            currency: { type: "string", pattern: "^[A-Za-z]{3}$" },
            amountMinor: { type: "integer", minimum: 0, maximum: 9007199254740991 },
            interval: { type: "string", enum: ["monthly", "quarterly", "semiannual", "annual"] },
            renewalAt: { type: "string", format: "date-time" },
            renewalAlertDays: { type: "integer", minimum: 0, maximum: 365 },
            autoRenew: { type: "boolean" },
            websiteUrl: { type: ["string", "null"], format: "uri", maxLength: 2048 },
            notes: { type: ["string", "null"], maxLength: 4000 },
            accountEmail: { type: ["string", "null"], maxLength: 320 },
            ownerMembershipId: { type: ["string", "null"], format: "uuid" },
            quantity: { type: "integer", minimum: 1, maximum: 1000000 },
            startedAt: { type: "string", format: "date-time" },
            trialEndsAt: { type: "string", format: "date-time" },
            cancelBeforeAt: { type: "string", format: "date-time" },
            costCenter: { type: ["string", "null"], maxLength: 120 },
            paymentMethodLabel: { type: ["string", "null"], maxLength: 120 },
            secretManagerUrl: { type: ["string", "null"], format: "uri", maxLength: 2048 }
          }
        }
      }
    },
    async (request) => {
      const context = await resolveTenantContext(auth, database, request);
      requirePermission(context, "subscriptions:manage");
      const { expectedUpdatedAt, startedAt, trialEndsAt, cancelBeforeAt, renewalAt, ...fields } = request.body;
      const subscription = await companySubscriptions.update(context, {
        ...fields,
        subscriptionId: request.params.subscriptionId,
        expectedUpdatedAt: new Date(expectedUpdatedAt),
        ...(fields.currency ? { currency: fields.currency.toUpperCase() } : {}),
        ...(renewalAt ? { renewalAt: new Date(renewalAt) } : {}),
        ...(startedAt ? { startedAt: new Date(startedAt) } : {}),
        ...(trialEndsAt ? { trialEndsAt: new Date(trialEndsAt) } : {}),
        ...(cancelBeforeAt ? { cancelBeforeAt: new Date(cancelBeforeAt) } : {})
      });
      await writeAudit(database, context, request, {
        action: "company_subscription.updated",
        targetType: "company_subscription",
        targetId: subscription.id,
        outcome: "success",
        metadata: { category: subscription.category, status: subscription.status }
      });
      return {
        subscription: companySubscriptionResponse(subscription, context.permissions.includes("financials:read"))
      };
    }
  );

  app.patch<{
    Params: { subscriptionId: string };
    Body: { action: "activate" | "pause" | "resume" | "cancel"; effectiveAt?: string; reason?: string };
  }>(
    "/api/v1/company-subscriptions/:subscriptionId/status",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["subscriptionId"],
          properties: { subscriptionId: { type: "string", format: "uuid" } }
        },
        body: {
          type: "object",
          additionalProperties: false,
          required: ["action"],
          properties: {
            action: { type: "string", enum: ["activate", "pause", "resume", "cancel"] },
            effectiveAt: { type: "string", format: "date-time" },
            reason: { type: "string", minLength: 3, maxLength: 500 }
          }
        }
      }
    },
    async (request) => {
      const context = await resolveTenantContext(auth, database, request);
      requirePermission(context, "subscriptions:manage");
      const subscription = await companySubscriptions.transition(context, {
        subscriptionId: request.params.subscriptionId,
        action: request.body.action,
        effectiveAt: request.body.effectiveAt ? new Date(request.body.effectiveAt) : new Date(),
        ...(request.body.reason ? { reason: request.body.reason } : {})
      });
      await writeAudit(database, context, request, {
        action: `company_subscription.${request.body.action}`,
        targetType: "company_subscription",
        targetId: subscription.id,
        outcome: "success",
        metadata: { status: subscription.status }
      });
      return {
        subscription: companySubscriptionResponse(subscription, context.permissions.includes("financials:read"))
      };
    }
  );
}

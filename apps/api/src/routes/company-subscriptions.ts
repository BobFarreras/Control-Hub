import { requirePermission, resolveTenantContext, writeAudit } from "../security.js";
import type { CompanySubscriptionContext } from "./context.js";

/** What the company itself pays for: recurring spend, renewals and cancellations. */
export function registerCompanySubscriptionRoutes({
  app,
  database,
  auth,
  companySubscriptions
}: CompanySubscriptionContext) {
  app.get("/api/v1/company-subscriptions", async (request) => {
    const context = await resolveTenantContext(auth, database, request);
    requirePermission(context, "financials:read");
    return { subscriptions: await companySubscriptions.list(context) };
  });
  app.post<{
    Body: {
      provider: string;
      serviceName: string;
      category: "saas" | "api" | "infrastructure" | "domain" | "license" | "other";
      status: "active" | "trial" | "canceled";
      currency: string;
      amountMinor: number;
      interval: "monthly" | "quarterly" | "semiannual" | "annual";
      renewalAt?: string;
      renewalAlertDays: number;
      autoRenew: boolean;
      websiteUrl?: string;
      notes?: string;
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
            status: { type: "string", enum: ["active", "trial", "canceled"] },
            currency: { type: "string", pattern: "^[A-Za-z]{3}$" },
            amountMinor: { type: "integer", minimum: 0, maximum: 9007199254740991 },
            interval: { type: "string", enum: ["monthly", "quarterly", "semiannual", "annual"] },
            renewalAt: { type: "string", format: "date-time" },
            renewalAlertDays: { type: "integer", minimum: 0, maximum: 365 },
            autoRenew: { type: "boolean" },
            websiteUrl: { type: "string", format: "uri", maxLength: 2048 },
            notes: { type: "string", maxLength: 4000 }
          }
        }
      }
    },
    async (request, reply) => {
      const context = await resolveTenantContext(auth, database, request);
      requirePermission(context, "subscriptions:manage");
      const subscription = await companySubscriptions.create(context, {
        ...request.body,
        currency: request.body.currency.toUpperCase(),
        renewalAt: request.body.renewalAt ? new Date(request.body.renewalAt) : null,
        websiteUrl: request.body.websiteUrl ?? null,
        notes: request.body.notes ?? null
      });
      await writeAudit(database, context, request, {
        action: "company_subscription.created",
        targetType: "company_subscription",
        targetId: subscription.id,
        outcome: "success"
      });
      return reply.code(201).send({ subscription });
    }
  );
  app.patch<{ Params: { subscriptionId: string }; Body: { status: "active" | "trial" | "canceled" } }>(
    "/api/v1/company-subscriptions/:subscriptionId/status",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["status"],
          properties: { status: { type: "string", enum: ["active", "trial", "canceled"] } }
        }
      }
    },
    async (request) => {
      const context = await resolveTenantContext(auth, database, request);
      requirePermission(context, "subscriptions:manage");
      const subscription = await companySubscriptions.updateStatus(
        context,
        request.params.subscriptionId,
        request.body.status
      );
      await writeAudit(database, context, request, {
        action: "company_subscription.status_changed",
        targetType: "company_subscription",
        targetId: subscription.id,
        outcome: "success",
        metadata: { status: subscription.status }
      });
      return { subscription };
    }
  );
}

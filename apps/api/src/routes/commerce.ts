import { requirePermission, resolveTenantContext, writeAudit } from "../security.js";
import type { CommerceContext } from "./context.js";

/** Catalogue, plans, prices and customer subscriptions. */
export function registerCommerceRoutes({ app, database, auth, commerce }: CommerceContext) {
  app.get("/api/v1/commerce/catalog", async (request) => {
    const context = await resolveTenantContext(auth, database, request);
    requirePermission(context, "products:manage");
    return commerce.catalog(context);
  });
  app.post<{ Body: { code: string; name: string; description?: string } }>(
    "/api/v1/commerce/products",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["code", "name"],
          properties: {
            code: { type: "string", minLength: 3, maxLength: 64 },
            name: { type: "string", minLength: 1, maxLength: 160 },
            description: { type: "string", maxLength: 2000 }
          }
        }
      }
    },
    async (request, reply) => {
      const context = await resolveTenantContext(auth, database, request);
      requirePermission(context, "products:manage");
      const product = await commerce.createProduct(context, request.body);
      await writeAudit(database, context, request, {
        action: "product.created",
        targetType: "product",
        targetId: product.id,
        outcome: "success"
      });
      return reply.code(201).send({ product });
    }
  );
  app.post<{
    Params: { productId: string };
    Body: { version: string; status: "draft" | "active"; releasedAt?: string };
  }>(
    "/api/v1/commerce/products/:productId/versions",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["version", "status"],
          properties: {
            version: { type: "string", minLength: 1, maxLength: 80 },
            status: { type: "string", enum: ["draft", "active"] },
            releasedAt: { type: "string", format: "date-time" }
          }
        }
      }
    },
    async (request, reply) => {
      const context = await resolveTenantContext(auth, database, request);
      requirePermission(context, "products:manage");
      const version = await commerce.createVersion(context, request.params.productId, {
        version: request.body.version,
        status: request.body.status,
        ...(request.body.releasedAt ? { releasedAt: new Date(request.body.releasedAt) } : {})
      });
      await writeAudit(database, context, request, {
        action: "product.version.created",
        targetType: "product_version",
        targetId: version.id,
        outcome: "success"
      });
      return reply.code(201).send({ version });
    }
  );
  app.post<{ Params: { versionId: string }; Body: { code: string; name: string; description?: string } }>(
    "/api/v1/commerce/versions/:versionId/plans",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["code", "name"],
          properties: {
            code: { type: "string", minLength: 3, maxLength: 64 },
            name: { type: "string", minLength: 1, maxLength: 160 },
            description: { type: "string", maxLength: 2000 }
          }
        }
      }
    },
    async (request, reply) => {
      const context = await resolveTenantContext(auth, database, request);
      requirePermission(context, "products:manage");
      const plan = await commerce.createPlan(context, request.params.versionId, request.body);
      await writeAudit(database, context, request, {
        action: "plan.created",
        targetType: "plan",
        targetId: plan.id,
        outcome: "success"
      });
      return reply.code(201).send({ plan });
    }
  );
  app.post<{
    Params: { planId: string };
    Body: {
      currency: string;
      amountMinor: number;
      costMinor: number;
      taxBasisPoints: number;
      interval: "free" | "monthly" | "quarterly" | "semiannual" | "annual";
      effectiveFrom?: string;
    };
  }>(
    "/api/v1/commerce/plans/:planId/prices",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["currency", "amountMinor", "costMinor", "taxBasisPoints", "interval"],
          properties: {
            currency: { type: "string", pattern: "^[A-Za-z]{3}$" },
            amountMinor: { type: "integer", minimum: 0, maximum: 9007199254740991 },
            costMinor: { type: "integer", minimum: 0, maximum: 9007199254740991 },
            taxBasisPoints: { type: "integer", minimum: 0, maximum: 10000 },
            interval: { type: "string", enum: ["free", "monthly", "quarterly", "semiannual", "annual"] },
            effectiveFrom: { type: "string", format: "date-time" }
          }
        }
      }
    },
    async (request, reply) => {
      const context = await resolveTenantContext(auth, database, request);
      requirePermission(context, "products:manage");
      const price = await commerce.createPrice(context, request.params.planId, {
        currency: request.body.currency,
        amountMinor: request.body.amountMinor,
        costMinor: request.body.costMinor,
        taxBasisPoints: request.body.taxBasisPoints,
        interval: request.body.interval,
        ...(request.body.effectiveFrom ? { effectiveFrom: new Date(request.body.effectiveFrom) } : {})
      });
      await writeAudit(database, context, request, {
        action: "plan.price.published",
        targetType: "plan_price",
        targetId: price.id,
        outcome: "success",
        metadata: { currency: price.currency, amountMinor: price.amountMinor }
      });
      return reply.code(201).send({ price });
    }
  );
  app.get("/api/v1/commerce/subscriptions", async (request) => {
    const context = await resolveTenantContext(auth, database, request);
    requirePermission(context, "subscriptions:manage");
    return { subscriptions: await commerce.listSubscriptions(context) };
  });
  app.post<{
    Body: {
      customerId: string;
      planId: string;
      priceId: string;
      quantity: number;
      startedAt?: string;
      renewalAt?: string;
      renewalAlertDays?: number;
    };
  }>(
    "/api/v1/commerce/subscriptions",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["customerId", "planId", "priceId", "quantity"],
          properties: {
            customerId: { type: "string", format: "uuid" },
            planId: { type: "string", format: "uuid" },
            priceId: { type: "string", format: "uuid" },
            quantity: { type: "integer", minimum: 1, maximum: 1000000 },
            startedAt: { type: "string", format: "date-time" },
            renewalAt: { type: "string", format: "date-time" },
            renewalAlertDays: { type: "integer", minimum: 0, maximum: 365 }
          }
        }
      }
    },
    async (request, reply) => {
      const context = await resolveTenantContext(auth, database, request);
      requirePermission(context, "subscriptions:manage");
      const subscription = await commerce.createSubscription(context, {
        customerId: request.body.customerId,
        planId: request.body.planId,
        priceId: request.body.priceId,
        quantity: request.body.quantity,
        ...(request.body.startedAt ? { startedAt: new Date(request.body.startedAt) } : {}),
        ...(request.body.renewalAt ? { renewalAt: new Date(request.body.renewalAt) } : {}),
        ...(request.body.renewalAlertDays !== undefined ? { renewalAlertDays: request.body.renewalAlertDays } : {})
      });
      await writeAudit(database, context, request, {
        action: "subscription.created",
        targetType: "subscription",
        targetId: subscription.id,
        outcome: "success"
      });
      return reply.code(201).send({ subscription });
    }
  );
  app.patch<{
    Params: { subscriptionId: string };
    Body: { status: "active" | "paused" | "canceled"; effectiveAt?: string };
  }>(
    "/api/v1/commerce/subscriptions/:subscriptionId/status",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["status"],
          properties: {
            status: { type: "string", enum: ["active", "paused", "canceled"] },
            effectiveAt: { type: "string", format: "date-time" }
          }
        }
      }
    },
    async (request) => {
      const context = await resolveTenantContext(auth, database, request);
      requirePermission(context, "subscriptions:manage");
      const subscription = await commerce.transitionSubscription(
        context,
        request.params.subscriptionId,
        request.body.status,
        request.body.effectiveAt ? new Date(request.body.effectiveAt) : new Date()
      );
      await writeAudit(database, context, request, {
        action: `subscription.${request.body.status}`,
        targetType: "subscription",
        targetId: subscription.id,
        outcome: "success"
      });
      return { subscription };
    }
  );
  app.patch<{
    Params: { subscriptionId: string };
    Body: { planId: string; priceId: string; effectiveAt?: string; renewalAt?: string };
  }>(
    "/api/v1/commerce/subscriptions/:subscriptionId/plan",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["planId", "priceId"],
          properties: {
            planId: { type: "string", format: "uuid" },
            priceId: { type: "string", format: "uuid" },
            effectiveAt: { type: "string", format: "date-time" },
            renewalAt: { type: "string", format: "date-time" }
          }
        }
      }
    },
    async (request) => {
      const context = await resolveTenantContext(auth, database, request);
      requirePermission(context, "subscriptions:manage");
      const subscription = await commerce.changePlan(context, request.params.subscriptionId, {
        planId: request.body.planId,
        priceId: request.body.priceId,
        ...(request.body.effectiveAt ? { effectiveAt: new Date(request.body.effectiveAt) } : {}),
        ...(request.body.renewalAt ? { renewalAt: new Date(request.body.renewalAt) } : {})
      });
      await writeAudit(database, context, request, {
        action: "subscription.plan.changed",
        targetType: "subscription",
        targetId: subscription.id,
        outcome: "success",
        metadata: { planId: request.body.planId }
      });
      return { subscription };
    }
  );
  app.post<{ Params: { subscriptionId: string } }>(
    "/api/v1/commerce/subscriptions/:subscriptionId/renew",
    async (request) => {
      const context = await resolveTenantContext(auth, database, request);
      requirePermission(context, "subscriptions:manage");
      const subscription = await commerce.renewSubscription(context, request.params.subscriptionId);
      await writeAudit(database, context, request, {
        action: "subscription.renewed",
        targetType: "subscription",
        targetId: subscription.id,
        outcome: "success",
        metadata: { renewalAt: subscription.renewalAt?.toISOString() ?? null }
      });
      return { subscription };
    }
  );
  app.get("/api/v1/commerce/financial-summary", async (request) => {
    const context = await resolveTenantContext(auth, database, request);
    requirePermission(context, "financials:read");
    return { metrics: await commerce.financialSummary(context) };
  });
  app.get("/api/v1/commerce/renewal-alerts", async (request) => {
    const context = await resolveTenantContext(auth, database, request);
    requirePermission(context, "subscriptions:manage");
    return { alerts: await commerce.renewalAlerts(context) };
  });
}

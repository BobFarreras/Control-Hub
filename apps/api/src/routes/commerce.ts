import type { CustomerContractRecord } from "@control-hub/application";
import { requirePermission, resolveTenantContext, writeAudit } from "../security.js";
import type { CommerceContext } from "./context.js";

export function customerServiceResponse(service: CustomerContractRecord, canReadFinancials: boolean) {
  const { amountMinor, costMinor, taxBasisPoints, ...publicService } = service;
  return {
    ...publicService,
    ...(canReadFinancials ? { financials: { amountMinor, costMinor, taxBasisPoints } } : {})
  };
}

/** Catalogue, plans, prices and customer subscriptions. */
export function registerCommerceRoutes({ app, database, auth, commerce, customerServices }: CommerceContext) {
  app.get("/api/v1/commerce/catalog", async (request) => {
    const context = await resolveTenantContext(auth, database, request);
    requirePermission(context, "products:manage");
    return commerce.catalog(context);
  });
  app.get<{
    Querystring: {
      customerId?: string;
      productId?: string;
      commercialModel?: "subscription" | "maintenance" | "one_time" | "project_service";
      status?: "active" | "paused" | "completed" | "canceled";
      ownerMembershipId?: string;
      currency?: string;
      renewalBefore?: string;
    };
  }>(
    "/api/v1/commerce/customer-services",
    {
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            customerId: { type: "string", format: "uuid" },
            productId: { type: "string", format: "uuid" },
            commercialModel: {
              type: "string",
              enum: ["subscription", "maintenance", "one_time", "project_service"]
            },
            status: { type: "string", enum: ["active", "paused", "completed", "canceled"] },
            ownerMembershipId: { type: "string", format: "uuid" },
            currency: { type: "string", pattern: "^[A-Z]{3}$" },
            renewalBefore: { type: "string", format: "date-time" }
          }
        }
      }
    },
    async (request) => {
      const context = await resolveTenantContext(auth, database, request);
      requirePermission(context, "subscriptions:manage");
      const { renewalBefore, ...filters } = request.query;
      const services = await customerServices.list(context, {
        ...filters,
        ...(renewalBefore ? { renewalBefore: new Date(renewalBefore) } : {})
      });
      const canReadFinancials = context.permissions.includes("financials:read");
      return {
        services: services.map((service) => customerServiceResponse(service, canReadFinancials))
      };
    }
  );
  app.post<{
    Body: {
      customerId: string;
      planId: string;
      priceId: string;
      quantity: number;
      contractedAt?: string;
      startsAt?: string;
      endsAt?: string;
      ownerMembershipId?: string;
      projectId?: string;
      currentPeriodStart?: string;
      renewalAt?: string;
      autoRenew?: boolean;
      renewalAlertDays?: number;
    };
  }>(
    "/api/v1/commerce/customer-services",
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
            contractedAt: { type: "string", format: "date-time" },
            startsAt: { type: "string", format: "date-time" },
            endsAt: { type: "string", format: "date-time" },
            ownerMembershipId: { type: "string", format: "uuid" },
            projectId: { type: "string", format: "uuid" },
            currentPeriodStart: { type: "string", format: "date-time" },
            renewalAt: { type: "string", format: "date-time" },
            autoRenew: { type: "boolean" },
            renewalAlertDays: { type: "integer", minimum: 0, maximum: 365 }
          }
        }
      }
    },
    async (request, reply) => {
      const context = await resolveTenantContext(auth, database, request);
      requirePermission(context, "subscriptions:manage");
      const now = new Date();
      const service = await customerServices.create(context, {
        customerId: request.body.customerId,
        planId: request.body.planId,
        priceId: request.body.priceId,
        quantity: request.body.quantity,
        contractedAt: request.body.contractedAt ? new Date(request.body.contractedAt) : now,
        startsAt: request.body.startsAt ? new Date(request.body.startsAt) : now,
        ...(request.body.endsAt ? { endsAt: new Date(request.body.endsAt) } : {}),
        ...(request.body.ownerMembershipId ? { ownerMembershipId: request.body.ownerMembershipId } : {}),
        ...(request.body.projectId ? { projectId: request.body.projectId } : {}),
        ...(request.body.currentPeriodStart ? { currentPeriodStart: new Date(request.body.currentPeriodStart) } : {}),
        ...(request.body.renewalAt ? { renewalAt: new Date(request.body.renewalAt) } : {}),
        ...(request.body.autoRenew !== undefined ? { autoRenew: request.body.autoRenew } : {}),
        ...(request.body.renewalAlertDays !== undefined ? { renewalAlertDays: request.body.renewalAlertDays } : {})
      });
      await writeAudit(database, context, request, {
        action: "customer_service.created",
        targetType: "customer_service",
        targetId: service.id,
        outcome: "success",
        metadata: { commercialModel: service.commercialModel, planId: service.planId }
      });
      return reply.code(201).send({
        service: customerServiceResponse(service, context.permissions.includes("financials:read"))
      });
    }
  );
  app.get<{ Params: { productId: string } }>("/api/v1/commerce/products/:productId", async (request) => {
    const context = await resolveTenantContext(auth, database, request);
    requirePermission(context, "products:manage");
    return commerce.productDetail(context, request.params.productId);
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
    Body: {
      product: { code: string; name: string; description?: string };
      version: { version: string };
      plan: {
        code: string;
        name: string;
        description?: string;
        commercialModel: "subscription" | "maintenance" | "one_time" | "project_service";
      };
      price: {
        currency: string;
        amountMinor: number;
        costMinor: number;
        taxBasisPoints: number;
        interval: "free" | "one_time" | "monthly" | "quarterly" | "semiannual" | "annual";
      };
    };
  }>(
    "/api/v1/commerce/products/with-offer",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["product", "version", "plan", "price"],
          properties: {
            product: {
              type: "object",
              additionalProperties: false,
              required: ["code", "name"],
              properties: {
                code: { type: "string", minLength: 3, maxLength: 64 },
                name: { type: "string", minLength: 1, maxLength: 160 },
                description: { type: "string", maxLength: 2000 }
              }
            },
            version: {
              type: "object",
              additionalProperties: false,
              required: ["version"],
              properties: { version: { type: "string", minLength: 1, maxLength: 80 } }
            },
            plan: {
              type: "object",
              additionalProperties: false,
              required: ["code", "name", "commercialModel"],
              properties: {
                code: { type: "string", minLength: 3, maxLength: 64 },
                name: { type: "string", minLength: 1, maxLength: 160 },
                description: { type: "string", maxLength: 2000 },
                commercialModel: {
                  type: "string",
                  enum: ["subscription", "maintenance", "one_time", "project_service"]
                }
              }
            },
            price: {
              type: "object",
              additionalProperties: false,
              required: ["currency", "amountMinor", "costMinor", "taxBasisPoints", "interval"],
              properties: {
                currency: { type: "string", pattern: "^[A-Za-z]{3}$" },
                amountMinor: { type: "integer", minimum: 0, maximum: 9007199254740991 },
                costMinor: { type: "integer", minimum: 0, maximum: 9007199254740991 },
                taxBasisPoints: { type: "integer", minimum: 0, maximum: 10000 },
                interval: {
                  type: "string",
                  enum: ["free", "one_time", "monthly", "quarterly", "semiannual", "annual"]
                }
              }
            }
          }
        }
      }
    },
    async (request, reply) => {
      const context = await resolveTenantContext(auth, database, request);
      requirePermission(context, "products:manage");
      const offer = await commerce.createProductOffer(context, request.body);
      await writeAudit(database, context, request, {
        action: "product.offer.created",
        targetType: "product",
        targetId: offer.product.id,
        outcome: "success",
        metadata: { planId: offer.plan.id, currency: offer.price.currency, interval: offer.price.interval }
      });
      return reply.code(201).send({ offer });
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
  app.post<{
    Params: { versionId: string };
    Body: {
      code: string;
      name: string;
      description?: string;
      commercialModel?: "subscription" | "maintenance" | "one_time" | "project_service";
    };
  }>(
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
            description: { type: "string", maxLength: 2000 },
            commercialModel: {
              type: "string",
              enum: ["subscription", "maintenance", "one_time", "project_service"]
            }
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
      interval: "free" | "one_time" | "monthly" | "quarterly" | "semiannual" | "annual";
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
            interval: {
              type: "string",
              enum: ["free", "one_time", "monthly", "quarterly", "semiannual", "annual"]
            },
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

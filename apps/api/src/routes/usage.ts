import type { UsageCostRecord, UsageEventRecord } from "@control-hub/application";
import { requirePermission, resolveTenantContext, writeAudit } from "../security.js";
import type { UsageContext } from "./context.js";

const uuid = { type: "string", format: "uuid" } as const;
const currency = { type: "string", pattern: "^[A-Z]{3}$" } as const;
const integer = { type: "string", pattern: "^\\d+$" } as const;

export function usageEventResponse(event: UsageEventRecord) {
  const { reportedCost: _reportedCost, ...safe } = event;
  return {
    ...safe,
    quantities: safe.quantities.map((quantity) => ({ ...quantity, quantity: quantity.quantity.toString() }))
  };
}

export function usageCostResponse(cost: UsageCostRecord) {
  return {
    ...cost,
    originalCostMinor: cost.originalCostMinor?.toString() ?? null,
    reportCostMinor: cost.reportCostMinor?.toString() ?? null
  };
}

export function registerUsageRoutes({ app, database, auth, usage }: UsageContext) {
  app.get<{ Querystring: { eventId?: string; from?: string; to?: string; limit?: number } }>(
    "/api/v1/usage/events",
    {
      schema: {
        tags: ["usage"],
        summary: "List usage quantities without financial fields",
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            eventId: uuid,
            from: { type: "string", format: "date-time" },
            to: { type: "string", format: "date-time" },
            limit: { type: "integer", minimum: 1, maximum: 500 }
          }
        }
      }
    },
    async (request) => {
      const context = await resolveTenantContext(auth, database, request);
      requirePermission(context, "usage:read");
      const events = await usage.listEvents(context, {
        ...(request.query.eventId ? { eventId: request.query.eventId } : {}),
        ...(request.query.from ? { from: new Date(request.query.from) } : {}),
        ...(request.query.to ? { to: new Date(request.query.to) } : {}),
        ...(request.query.limit ? { limit: request.query.limit } : {})
      });
      return { events: events.map(usageEventResponse) };
    }
  );

  app.get<{ Querystring: { eventId?: string; from?: string; to?: string; limit?: number } }>(
    "/api/v1/usage/costs",
    {
      schema: {
        tags: ["usage"],
        summary: "List versioned usage valuations",
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            eventId: uuid,
            from: { type: "string", format: "date-time" },
            to: { type: "string", format: "date-time" },
            limit: { type: "integer", minimum: 1, maximum: 500 }
          }
        }
      }
    },
    async (request) => {
      const context = await resolveTenantContext(auth, database, request);
      requirePermission(context, "financials:read");
      const costs = await usage.listCosts(context, {
        ...(request.query.eventId ? { eventId: request.query.eventId } : {}),
        ...(request.query.from ? { from: new Date(request.query.from) } : {}),
        ...(request.query.to ? { to: new Date(request.query.to) } : {}),
        ...(request.query.limit ? { limit: request.query.limit } : {})
      });
      return { costs: costs.map(usageCostResponse) };
    }
  );

  app.get("/api/v1/usage/rates", { schema: { tags: ["usage"], summary: "List usage tariffs" } }, async (request) => {
    const context = await resolveTenantContext(auth, database, request);
    requirePermission(context, "financials:read");
    return {
      rates: (await usage.listRates(context)).map((rate) => ({
        ...rate,
        unitSize: rate.unitSize.toString(),
        tiers: rate.tiers.map((tier) => ({
          startsAt: tier.startsAt.toString(),
          priceMinor: tier.priceMinor.toString()
        }))
      }))
    };
  });

  app.post<{
    Body: {
      provider: string;
      sku: string;
      unit:
        | "input_token"
        | "output_token"
        | "cached_input_token"
        | "request"
        | "image"
        | "audio_second"
        | "compute_millisecond"
        | "byte"
        | "provider_unit";
      unitSize: string;
      currency: string;
      effectiveFrom: string;
      tiers: Array<{ startsAt: string; priceMinor: string }>;
    };
  }>(
    "/api/v1/usage/rates",
    {
      schema: {
        tags: ["usage"],
        summary: "Publish an immutable usage tariff",
        body: {
          type: "object",
          additionalProperties: false,
          required: ["provider", "sku", "unit", "unitSize", "currency", "effectiveFrom", "tiers"],
          properties: {
            provider: { type: "string", minLength: 1, maxLength: 100 },
            sku: { type: "string", minLength: 1, maxLength: 160 },
            unit: {
              type: "string",
              enum: [
                "input_token",
                "output_token",
                "cached_input_token",
                "request",
                "image",
                "audio_second",
                "compute_millisecond",
                "byte",
                "provider_unit"
              ]
            },
            unitSize: integer,
            currency,
            effectiveFrom: { type: "string", format: "date-time" },
            tiers: {
              type: "array",
              minItems: 1,
              maxItems: 100,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["startsAt", "priceMinor"],
                properties: { startsAt: integer, priceMinor: integer }
              }
            }
          }
        }
      }
    },
    async (request, reply) => {
      const context = await resolveTenantContext(auth, database, request);
      requirePermission(context, "usage:manage");
      const created = await usage.createRate(context, {
        ...request.body,
        unitSize: BigInt(request.body.unitSize),
        effectiveFrom: new Date(request.body.effectiveFrom),
        tiers: request.body.tiers.map((tier) => ({
          startsAt: BigInt(tier.startsAt),
          priceMinor: BigInt(tier.priceMinor)
        }))
      });
      await writeAudit(database, context, request, {
        action: "usage_rate.created",
        targetType: "usage_rate",
        targetId: created.id,
        outcome: "success",
        metadata: { provider: request.body.provider, sku: request.body.sku }
      });
      return reply.code(201).send(created);
    }
  );

  app.post<{ Params: { rateId: string } }>(
    "/api/v1/usage/rates/:rateId/annul",
    {
      schema: {
        tags: ["usage"],
        summary: "Annul a usage tariff",
        params: { type: "object", required: ["rateId"], properties: { rateId: uuid } }
      }
    },
    async (request) => {
      const context = await resolveTenantContext(auth, database, request);
      requirePermission(context, "usage:manage");
      const annulled = await usage.annulRate(context, request.params.rateId);
      await writeAudit(database, context, request, {
        action: "usage_rate.annulled",
        targetType: "usage_rate",
        targetId: request.params.rateId,
        outcome: annulled ? "success" : "failure",
        metadata: {}
      });
      return { annulled };
    }
  );

  app.get(
    "/api/v1/usage/exchange-rates",
    { schema: { tags: ["usage"], summary: "List versioned exchange rates" } },
    async (request) => {
      const context = await resolveTenantContext(auth, database, request);
      requirePermission(context, "financials:read");
      return {
        exchangeRates: (await usage.listExchangeRates(context)).map((rate) => ({
          ...rate,
          numerator: rate.numerator.toString(),
          denominator: rate.denominator.toString()
        }))
      };
    }
  );

  app.post<{
    Body: {
      baseCurrency: string;
      quoteCurrency: string;
      rateDay: string;
      numerator: string;
      denominator: string;
      source: string;
    };
  }>(
    "/api/v1/usage/exchange-rates",
    {
      schema: {
        tags: ["usage"],
        summary: "Publish an immutable exchange rate",
        body: {
          type: "object",
          additionalProperties: false,
          required: ["baseCurrency", "quoteCurrency", "rateDay", "numerator", "denominator", "source"],
          properties: {
            baseCurrency: currency,
            quoteCurrency: currency,
            rateDay: { type: "string", format: "date" },
            numerator: integer,
            denominator: integer,
            source: { type: "string", minLength: 1, maxLength: 200 }
          }
        }
      }
    },
    async (request, reply) => {
      const context = await resolveTenantContext(auth, database, request);
      requirePermission(context, "usage:manage");
      const created = await usage.createExchangeRate(context, {
        ...request.body,
        numerator: BigInt(request.body.numerator),
        denominator: BigInt(request.body.denominator)
      });
      await writeAudit(database, context, request, {
        action: "usage_fx.created",
        targetType: "exchange_rate",
        targetId: created.id,
        outcome: "success",
        metadata: { pair: `${request.body.baseCurrency}/${request.body.quoteCurrency}`, day: request.body.rateDay }
      });
      return reply.code(201).send(created);
    }
  );

  app.post<{ Params: { exchangeRateId: string } }>(
    "/api/v1/usage/exchange-rates/:exchangeRateId/annul",
    {
      schema: {
        tags: ["usage"],
        summary: "Annul an exchange rate",
        params: { type: "object", required: ["exchangeRateId"], properties: { exchangeRateId: uuid } }
      }
    },
    async (request) => {
      const context = await resolveTenantContext(auth, database, request);
      requirePermission(context, "usage:manage");
      const annulled = await usage.annulExchangeRate(context, request.params.exchangeRateId);
      await writeAudit(database, context, request, {
        action: "usage_fx.annulled",
        targetType: "exchange_rate",
        targetId: request.params.exchangeRateId,
        outcome: annulled ? "success" : "failure",
        metadata: {}
      });
      return { annulled };
    }
  );

  app.post<{ Params: { eventId: string }; Body: { reportCurrency: string } }>(
    "/api/v1/usage/events/:eventId/valuations",
    {
      schema: {
        tags: ["usage"],
        summary: "Create an explicit usage valuation version",
        params: { type: "object", required: ["eventId"], properties: { eventId: uuid } },
        body: {
          type: "object",
          additionalProperties: false,
          required: ["reportCurrency"],
          properties: { reportCurrency: currency }
        }
      }
    },
    async (request, reply) => {
      const context = await resolveTenantContext(auth, database, request);
      requirePermission(context, "usage:manage");
      const valuation = await usage.valueEvent(context, request.params.eventId, request.body.reportCurrency);
      await writeAudit(database, context, request, {
        action: "usage_event.valued",
        targetType: "usage_event",
        targetId: request.params.eventId,
        outcome: "success",
        metadata: { version: valuation.version, state: valuation.state }
      });
      return reply.code(201).send(usageCostResponse(valuation));
    }
  );

  app.get(
    "/api/v1/usage/budgets",
    { schema: { tags: ["usage"], summary: "List informative usage budgets" } },
    async (request) => {
      const context = await resolveTenantContext(auth, database, request);
      requirePermission(context, "financials:read");
      return {
        budgets: (await usage.listBudgets(context)).map((budget) => ({
          ...budget,
          amountMinor: budget.amountMinor.toString()
        }))
      };
    }
  );

  app.post<{
    Body: {
      name: string;
      amountMinor: string;
      currency: string;
      period: "monthly" | "quarterly" | "annual";
      warningBasisPoints: number;
      sources: Array<{ sourceId: string; required: boolean; maxAgeMinutes: number }>;
      customerId?: string;
      productId?: string;
      customerServiceId?: string;
      projectId?: string;
    };
  }>(
    "/api/v1/usage/budgets",
    {
      schema: {
        tags: ["usage"],
        summary: "Create an informative usage budget",
        body: {
          type: "object",
          additionalProperties: false,
          required: ["name", "amountMinor", "currency", "period", "warningBasisPoints", "sources"],
          properties: {
            name: { type: "string", minLength: 1, maxLength: 160 },
            amountMinor: integer,
            currency,
            period: { type: "string", enum: ["monthly", "quarterly", "annual"] },
            warningBasisPoints: { type: "integer", minimum: 1, maximum: 9999 },
            sources: {
              type: "array",
              minItems: 1,
              maxItems: 100,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["sourceId", "required", "maxAgeMinutes"],
                properties: {
                  sourceId: uuid,
                  required: { type: "boolean" },
                  maxAgeMinutes: { type: "integer", minimum: 1, maximum: 43200 }
                }
              }
            },
            customerId: uuid,
            productId: uuid,
            customerServiceId: uuid,
            projectId: uuid
          }
        }
      }
    },
    async (request, reply) => {
      const context = await resolveTenantContext(auth, database, request);
      requirePermission(context, "budgets:manage");
      const created = await usage.createBudget(context, {
        ...request.body,
        amountMinor: BigInt(request.body.amountMinor)
      });
      await writeAudit(database, context, request, {
        action: "usage_budget.created",
        targetType: "usage_budget",
        targetId: created.id,
        outcome: "success",
        metadata: { period: request.body.period, sourceCount: request.body.sources.length }
      });
      return reply.code(201).send(created);
    }
  );

  app.post<{ Params: { budgetId: string } }>(
    "/api/v1/usage/budgets/:budgetId/evaluate",
    {
      schema: {
        tags: ["usage"],
        summary: "Evaluate budget coverage and thresholds",
        params: { type: "object", required: ["budgetId"], properties: { budgetId: uuid } }
      }
    },
    async (request) => {
      const context = await resolveTenantContext(auth, database, request);
      requirePermission(context, "financials:read");
      const evaluation = await usage.evaluateBudget(context, request.params.budgetId);
      return {
        ...evaluation,
        amountMinor: evaluation.amountMinor.toString(),
        spentMinor: evaluation.spentMinor.toString()
      };
    }
  );
}

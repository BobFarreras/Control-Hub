import { randomUUID } from "node:crypto";
import type {
  UsageBudgetInput,
  UsageCostRecord,
  UsageEventInput,
  UsageEventRecord,
  UsageListQuery,
  UsageBudgetEvidence,
  UsageBudgetEvaluation,
  UsageBudgetRecord,
  UsageExchangeRateInput,
  UsageExchangeRateRecord,
  UsageRateInput,
  UsageRateRecord,
  UsageRepository,
  UsageSourceRecord,
  UsageValuationEvidence,
  UsageValuationInput
} from "@control-hub/application";
import { withTenant, type DatabaseClient } from "@control-hub/database";
import type { TenantContext, UsageUnit } from "@control-hub/domain";

type EventRow = Omit<UsageEventRecord, "quantities" | "reportedCost"> & {
  quantities: Array<{ unit: UsageUnit; quantity: string; qualifier: string }>;
  reportedCostMinor: string | null;
  reportedCurrency: string | null;
};
type CostRow = Omit<UsageCostRecord, "originalCostMinor" | "reportCostMinor"> & {
  originalCostMinor: string | null;
  reportCostMinor: string | null;
};

function eventRecord(row: EventRow): UsageEventRecord {
  const { reportedCostMinor, reportedCurrency, ...event } = row;
  return {
    ...event,
    quantities: event.quantities.map((quantity) => ({ ...quantity, quantity: BigInt(quantity.quantity) })),
    ...(reportedCostMinor !== null && reportedCurrency !== null
      ? { reportedCost: { amountMinor: BigInt(reportedCostMinor), currency: reportedCurrency } }
      : {})
  };
}

export class PostgresUsageRepository implements UsageRepository {
  constructor(private readonly database: DatabaseClient) {}

  ensureConnectorSource(context: TenantContext, input: { instanceId: string; operation: string }) {
    return withTenant(this.database, context.tenantId, async (tx) => {
      const [source] = await tx<
        Array<{ id: string; instanceId: string; operation: string; lastCompleteAt: Date | null }>
      >`
        insert into usage_sources (id, tenant_id, kind, connector_instance_id, operation)
        values (${randomUUID()}, ${context.tenantId}, 'connector', ${input.instanceId}, ${input.operation})
        on conflict (tenant_id, connector_instance_id, operation) where kind = 'connector'
        do update set updated_at = usage_sources.updated_at
        returning id, connector_instance_id as "instanceId", operation, last_complete_at as "lastCompleteAt"`;
      return source!;
    });
  }

  completeSource(context: TenantContext, sourceId: string, completedAt: Date) {
    return withTenant(this.database, context.tenantId, async (tx) => {
      await tx`update usage_sources set last_complete_at = greatest(coalesce(last_complete_at, '-infinity'), ${completedAt}),
        updated_at = now() where tenant_id = ${context.tenantId} and id = ${sourceId}`;
    });
  }

  ingestEvent(context: TenantContext, input: UsageEventInput) {
    return withTenant(this.database, context.tenantId, async (tx) => {
      const id = randomUUID();
      const inserted = await tx<{ id: string }[]>`
        insert into usage_events (
          id, tenant_id, source_id, external_id, occurred_at, operation, sku, provider_status,
          customer_id, product_id, customer_service_id, project_id, reported_cost_minor, reported_currency
        ) values (
          ${id}, ${context.tenantId}, ${input.sourceId}, ${input.externalId}, ${input.occurredAt},
          ${input.operation}, ${input.sku}, ${input.status}, ${input.customerId ?? null},
          ${input.productId ?? null}, ${input.customerServiceId ?? null}, ${input.projectId ?? null},
          ${input.reportedCost?.amountMinor.toString() ?? null}, ${input.reportedCost?.currency ?? null}
        ) on conflict (tenant_id, source_id, external_id) do nothing returning id`;
      const eventId = inserted[0]?.id;
      if (eventId) {
        for (const quantity of input.quantities) {
          await tx`insert into usage_event_quantities
            (id, tenant_id, event_id, unit, quantity, qualifier)
            values (${randomUUID()}, ${context.tenantId}, ${eventId}, ${quantity.unit}, ${quantity.quantity.toString()}, ${quantity.qualifier ?? "total"})`;
        }
      }
      const [row] = await tx<EventRow[]>`
        select e.id, e.source_id as "sourceId", e.external_id as "externalId", e.occurred_at as "occurredAt",
          e.operation, e.sku, e.provider_status as status, e.customer_id as "customerId",
          e.product_id as "productId", e.customer_service_id as "customerServiceId", e.project_id as "projectId",
          e.reported_cost_minor::text as "reportedCostMinor", e.reported_currency as "reportedCurrency",
          e.created_at as "createdAt",
          coalesce(jsonb_agg(jsonb_build_object('unit', q.unit, 'quantity', q.quantity::text,
            'qualifier', q.qualifier)) filter (where q.id is not null), '[]'::jsonb) as quantities
        from usage_events e left join usage_event_quantities q
          on q.tenant_id = e.tenant_id and q.event_id = e.id
        where e.tenant_id = ${context.tenantId} and e.source_id = ${input.sourceId} and e.external_id = ${input.externalId}
        group by e.id`;
      if (!row) throw new Error("USAGE_EVENT_NOT_FOUND_AFTER_INGEST");
      return { record: eventRecord(row), inserted: Boolean(eventId) };
    });
  }

  listEvents(context: TenantContext, query: UsageListQuery) {
    const limit = Math.min(Math.max(query.limit ?? 100, 1), 500);
    return withTenant(this.database, context.tenantId, async (tx) => {
      const rows = await tx<EventRow[]>`
        select e.id, e.source_id as "sourceId", e.external_id as "externalId", e.occurred_at as "occurredAt",
          e.operation, e.sku, e.provider_status as status, e.customer_id as "customerId",
          e.product_id as "productId", e.customer_service_id as "customerServiceId", e.project_id as "projectId",
          e.reported_cost_minor::text as "reportedCostMinor", e.reported_currency as "reportedCurrency",
          e.created_at as "createdAt",
          coalesce(jsonb_agg(jsonb_build_object('unit', q.unit, 'quantity', q.quantity::text,
            'qualifier', q.qualifier)) filter (where q.id is not null), '[]'::jsonb) as quantities
        from usage_events e left join usage_event_quantities q
          on q.tenant_id = e.tenant_id and q.event_id = e.id
        where e.tenant_id = ${context.tenantId}
          and (${query.eventId ?? null}::uuid is null or e.id = ${query.eventId ?? null})
          and (${query.from ?? null}::timestamptz is null or e.occurred_at >= ${query.from ?? null})
          and (${query.to ?? null}::timestamptz is null or e.occurred_at < ${query.to ?? null})
        group by e.id order by e.occurred_at desc, e.id limit ${limit}`;
      return rows.map(eventRecord);
    });
  }

  listSources(context: TenantContext) {
    return withTenant(
      this.database,
      context.tenantId,
      async (tx) =>
        await tx<UsageSourceRecord[]>`
        select id, connector_instance_id as "instanceId", operation, last_complete_at as "lastCompleteAt"
        from usage_sources
        where tenant_id = ${context.tenantId} and kind = 'connector'
        order by last_complete_at desc nulls last, id`
    );
  }

  listCosts(context: TenantContext, query: UsageListQuery) {
    const limit = Math.min(Math.max(query.limit ?? 100, 1), 500);
    return withTenant(this.database, context.tenantId, async (tx) => {
      const rows = await tx<CostRow[]>`
        select v.id, v.event_id as "eventId", v.adjustment_id as "adjustmentId", v.state,
          v.original_cost_minor::text as "originalCostMinor", v.original_currency as "originalCurrency",
          v.report_cost_minor::text as "reportCostMinor", v.report_currency as "reportCurrency"
        from usage_valuations v left join usage_events e
          on e.tenant_id = v.tenant_id and e.id = v.event_id
        where v.tenant_id = ${context.tenantId}
          and (${query.eventId ?? null}::uuid is null or v.event_id = ${query.eventId ?? null})
          and (${query.from ?? null}::timestamptz is null or e.occurred_at >= ${query.from ?? null})
          and (${query.to ?? null}::timestamptz is null or e.occurred_at < ${query.to ?? null})
        order by v.valued_at desc, v.id limit ${limit}`;
      return rows.map((row) => ({
        ...row,
        originalCostMinor: row.originalCostMinor === null ? null : BigInt(row.originalCostMinor),
        reportCostMinor: row.reportCostMinor === null ? null : BigInt(row.reportCostMinor)
      }));
    });
  }

  createRate(context: TenantContext, input: UsageRateInput) {
    return withTenant(this.database, context.tenantId, async (tx) => {
      const id = randomUUID();
      await tx`insert into usage_rates
        (id, tenant_id, provider, sku, unit, unit_size, currency, effective_from, source)
        values (${id}, ${context.tenantId}, ${input.provider}, ${input.sku}, ${input.unit}, ${input.unitSize.toString()},
          ${input.currency}, ${input.effectiveFrom}, 'manual')`;
      for (const tier of input.tiers) {
        await tx`insert into usage_rate_tiers (id, tenant_id, rate_id, starts_at, price_minor)
          values (${randomUUID()}, ${context.tenantId}, ${id}, ${tier.startsAt.toString()}, ${tier.priceMinor.toString()})`;
      }
      return { id };
    });
  }

  listRates(context: TenantContext) {
    return withTenant(this.database, context.tenantId, async (tx): Promise<UsageRateRecord[]> => {
      const rates = await tx<
        Array<{
          id: string;
          provider: string;
          sku: string;
          unit: UsageUnit;
          unitSize: string;
          currency: string;
          effectiveFrom: Date;
          annulledAt: Date | null;
          tiers: Array<{ startsAt: string; priceMinor: string }>;
        }>
      >`select r.id, r.provider, r.sku, r.unit, r.unit_size::text as "unitSize", r.currency,
          r.effective_from as "effectiveFrom", r.annulled_at as "annulledAt",
          jsonb_agg(jsonb_build_object('startsAt', t.starts_at::text, 'priceMinor', t.price_minor::text)
            order by t.starts_at) as tiers
        from usage_rates r join usage_rate_tiers t on t.tenant_id = r.tenant_id and t.rate_id = r.id
        where r.tenant_id = ${context.tenantId} group by r.id order by r.effective_from desc, r.id`;
      return rates.map((rate) => ({
        ...rate,
        unitSize: BigInt(rate.unitSize),
        tiers: rate.tiers.map((tier) => ({ startsAt: BigInt(tier.startsAt), priceMinor: BigInt(tier.priceMinor) }))
      }));
    });
  }

  annulRate(context: TenantContext, rateId: string) {
    return withTenant(this.database, context.tenantId, async (tx) => {
      const rows =
        await tx`update usage_rates set annulled_at = now(), annulled_by_membership_id = ${context.membershipId}
        where tenant_id = ${context.tenantId} and id = ${rateId} and annulled_at is null returning id`;
      return rows.length === 1;
    });
  }

  createExchangeRate(context: TenantContext, input: UsageExchangeRateInput) {
    return withTenant(this.database, context.tenantId, async (tx) => {
      const id = randomUUID();
      await tx`insert into exchange_rates
        (id, tenant_id, base_currency, quote_currency, rate_day, numerator, denominator, source)
        values (${id}, ${context.tenantId}, ${input.baseCurrency}, ${input.quoteCurrency}, ${input.rateDay},
          ${input.numerator.toString()}, ${input.denominator.toString()}, ${input.source})`;
      return { id };
    });
  }

  listExchangeRates(context: TenantContext) {
    return withTenant(this.database, context.tenantId, async (tx): Promise<UsageExchangeRateRecord[]> => {
      const rows = await tx<
        Array<{
          id: string;
          baseCurrency: string;
          quoteCurrency: string;
          rateDay: string;
          numerator: string;
          denominator: string;
          source: string;
          annulledAt: Date | null;
        }>
      >`select id, base_currency as "baseCurrency", quote_currency as "quoteCurrency", rate_day::text as "rateDay",
          numerator::text as numerator, denominator::text as denominator, source, annulled_at as "annulledAt"
        from exchange_rates where tenant_id = ${context.tenantId} order by rate_day desc, id`;
      return rows.map((row) => ({ ...row, numerator: BigInt(row.numerator), denominator: BigInt(row.denominator) }));
    });
  }

  annulExchangeRate(context: TenantContext, exchangeRateId: string) {
    return withTenant(this.database, context.tenantId, async (tx) => {
      const rows =
        await tx`update exchange_rates set annulled_at = now(), annulled_by_membership_id = ${context.membershipId}
        where tenant_id = ${context.tenantId} and id = ${exchangeRateId} and annulled_at is null returning id`;
      return rows.length === 1;
    });
  }

  valuationEvidence(context: TenantContext, eventId: string, _reportCurrency: string) {
    return withTenant(this.database, context.tenantId, async (tx): Promise<UsageValuationEvidence | null> => {
      const [event] = await tx<EventRow[]>`
        select e.id, e.source_id as "sourceId", e.external_id as "externalId", e.occurred_at as "occurredAt",
          e.operation, e.sku, e.provider_status as status, e.customer_id as "customerId",
          e.product_id as "productId", e.customer_service_id as "customerServiceId", e.project_id as "projectId",
          e.reported_cost_minor::text as "reportedCostMinor", e.reported_currency as "reportedCurrency",
          e.created_at as "createdAt", '[]'::jsonb as quantities
        from usage_events e where e.tenant_id = ${context.tenantId} and e.id = ${eventId}`;
      if (!event) return null;
      const quantities = await tx<
        Array<{ id: string; unit: UsageUnit; qualifier: string; quantity: string }>
      >`select id, unit, qualifier, quantity::text as quantity from usage_event_quantities
        where tenant_id = ${context.tenantId} and event_id = ${eventId} order by id`;
      const [source] = await tx<{ provider: string }[]>`
        select coalesce(ci.connector_type, s.manual_code) as provider from usage_sources s
        left join connector_instances ci on ci.tenant_id = s.tenant_id and ci.id = s.connector_instance_id
        where s.tenant_id = ${context.tenantId} and s.id = ${event.sourceId}`;
      const rates = await tx<
        Array<{
          id: string;
          currency: string;
          unit: UsageUnit;
          unitSize: string;
          effectiveFrom: Date;
          tiers: Array<{ startsAt: string; priceMinor: string }>;
        }>
      >`select r.id, r.currency, r.unit, r.unit_size::text as "unitSize", r.effective_from as "effectiveFrom",
          jsonb_agg(jsonb_build_object('startsAt', t.starts_at::text, 'priceMinor', t.price_minor::text)
            order by t.starts_at) as tiers
        from usage_rates r join usage_rate_tiers t on t.tenant_id = r.tenant_id and t.rate_id = r.id
        where r.tenant_id = ${context.tenantId} and r.provider = ${source!.provider}
          and r.sku = ${event.sku} and r.effective_from <= ${event.occurredAt} and r.annulled_at is null
        group by r.id order by r.effective_from`;
      const exchangeRates = await tx<
        Array<{
          id: string;
          baseCurrency: string;
          quoteCurrency: string;
          rateDay: string;
          numerator: string;
          denominator: string;
        }>
      >`select id, base_currency as "baseCurrency", quote_currency as "quoteCurrency",
          rate_day::text as "rateDay", numerator::text as numerator, denominator::text as denominator
        from exchange_rates where tenant_id = ${context.tenantId}
          and rate_day = (${event.occurredAt}::timestamptz at time zone 'UTC')::date and annulled_at is null`;
      return {
        event: eventRecord(event),
        provider: source!.provider,
        quantities: quantities.map((quantity) => ({ ...quantity, quantity: BigInt(quantity.quantity) })),
        rates: rates.map((rate) => ({
          id: rate.id,
          currency: rate.currency,
          unit: rate.unit,
          unitSize: BigInt(rate.unitSize),
          effectiveFrom: rate.effectiveFrom.toISOString(),
          tiers: rate.tiers.map((tier, index) => ({
            upTo: rate.tiers[index + 1] ? BigInt(rate.tiers[index + 1]!.startsAt) : null,
            priceMinor: BigInt(tier.priceMinor)
          }))
        })),
        exchangeRates: exchangeRates.map((rate) => ({
          ...rate,
          numerator: BigInt(rate.numerator),
          denominator: BigInt(rate.denominator)
        }))
      };
    });
  }

  saveValuation(context: TenantContext, input: UsageValuationInput) {
    return withTenant(this.database, context.tenantId, async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended(${`${context.tenantId}:${input.eventId}`}, 0))`;
      const [versionRow] = await tx<{ version: number }[]>`select coalesce(max(version), 0)::integer + 1 as version
        from usage_valuations where tenant_id = ${context.tenantId} and event_id = ${input.eventId}`;
      const id = randomUUID();
      const rateIds = [...new Set(input.lines.flatMap((line) => (line.rateId ? [line.rateId] : [])))];
      const exchangeIds = [
        ...new Set(input.lines.flatMap((line) => (line.exchangeRateId ? [line.exchangeRateId] : [])))
      ];
      await tx`insert into usage_valuations
        (id, tenant_id, event_id, version, state, original_cost_minor, original_currency,
          report_cost_minor, report_currency, rate_id, exchange_rate_id, missing)
        values (${id}, ${context.tenantId}, ${input.eventId}, ${versionRow!.version}, ${input.state},
          ${input.originalCostMinor?.toString() ?? null}, ${input.originalCurrency},
          ${input.reportCostMinor?.toString() ?? null}, ${input.reportCurrency},
          ${rateIds.length === 1 ? rateIds[0]! : null}, ${exchangeIds.length === 1 ? exchangeIds[0]! : null},
          ${tx.json(input.missing)})`;
      for (const line of input.lines) {
        await tx`insert into usage_valuation_lines
          (id, tenant_id, valuation_id, quantity_id, unit, qualifier, quantity, original_cost_minor,
            original_currency, report_cost_minor, report_currency, rate_id, exchange_rate_id, state, missing)
          values (${randomUUID()}, ${context.tenantId}, ${id}, ${line.quantityId}, ${line.unit}, ${line.qualifier},
            ${line.quantity.toString()}, ${line.originalCostMinor?.toString() ?? null}, ${line.originalCurrency},
            ${line.reportCostMinor?.toString() ?? null}, ${line.reportCurrency}, ${line.rateId},
            ${line.exchangeRateId}, ${line.state}, ${line.missing})`;
      }
      return {
        id,
        eventId: input.eventId,
        adjustmentId: null,
        version: versionRow!.version,
        state: input.state,
        originalCostMinor: input.originalCostMinor,
        originalCurrency: input.originalCurrency,
        reportCostMinor: input.reportCostMinor,
        reportCurrency: input.reportCurrency
      };
    });
  }

  createBudget(context: TenantContext, input: UsageBudgetInput) {
    return withTenant(this.database, context.tenantId, async (tx) => {
      const id = randomUUID();
      await tx`insert into usage_budgets
        (id, tenant_id, name, period, amount_minor, currency, warning_basis_points,
          customer_id, product_id, customer_service_id, project_id)
        values (${id}, ${context.tenantId}, ${input.name}, ${input.period}, ${input.amountMinor.toString()},
          ${input.currency}, ${input.warningBasisPoints}, ${input.customerId ?? null}, ${input.productId ?? null},
          ${input.customerServiceId ?? null}, ${input.projectId ?? null})`;
      for (const source of input.sources) {
        await tx`insert into usage_budget_sources (tenant_id, budget_id, source_id, required, max_age_seconds)
          values (${context.tenantId}, ${id}, ${source.sourceId}, ${source.required}, ${source.maxAgeMinutes * 60})`;
      }
      return { id };
    });
  }

  listBudgets(context: TenantContext) {
    return withTenant(this.database, context.tenantId, async (tx): Promise<UsageBudgetRecord[]> => {
      const budgets = await tx<
        Array<{
          id: string;
          name: string;
          amountMinor: string;
          currency: string;
          period: "monthly" | "quarterly" | "annual";
          warningBasisPoints: number;
          enabled: boolean;
          customerId: string | null;
          productId: string | null;
          customerServiceId: string | null;
          projectId: string | null;
        }>
      >`select id, name, amount_minor::text as "amountMinor", currency, period,
          warning_basis_points as "warningBasisPoints", enabled, customer_id as "customerId",
          product_id as "productId", customer_service_id as "customerServiceId", project_id as "projectId"
        from usage_budgets where tenant_id = ${context.tenantId} order by created_at desc, id`;
      const sources = await tx<Array<{ budgetId: string; sourceId: string; required: boolean; maxAgeMinutes: number }>>`
        select budget_id as "budgetId", source_id as "sourceId", required,
          (max_age_seconds / 60)::integer as "maxAgeMinutes" from usage_budget_sources
        where tenant_id = ${context.tenantId} order by source_id`;
      return budgets.map((budget) => ({
        id: budget.id,
        name: budget.name,
        amountMinor: BigInt(budget.amountMinor),
        currency: budget.currency,
        period: budget.period,
        warningBasisPoints: budget.warningBasisPoints,
        enabled: budget.enabled,
        sources: sources.filter((source) => source.budgetId === budget.id).map(({ budgetId: _, ...source }) => source),
        ...(budget.customerId ? { customerId: budget.customerId } : {}),
        ...(budget.productId ? { productId: budget.productId } : {}),
        ...(budget.customerServiceId ? { customerServiceId: budget.customerServiceId } : {}),
        ...(budget.projectId ? { projectId: budget.projectId } : {})
      }));
    });
  }

  budgetEvidence(context: TenantContext, budgetId: string, at: Date) {
    return withTenant(this.database, context.tenantId, async (tx): Promise<UsageBudgetEvidence | null> => {
      const [budget] = await tx<
        Array<{
          id: string;
          amountMinor: string;
          currency: string;
          warningBasisPoints: number;
          period: "monthly" | "quarterly" | "annual";
          customerId: string | null;
          productId: string | null;
          customerServiceId: string | null;
          projectId: string | null;
        }>
      >`select id, amount_minor::text as "amountMinor", currency, warning_basis_points as "warningBasisPoints",
          period, customer_id as "customerId", product_id as "productId",
          customer_service_id as "customerServiceId", project_id as "projectId"
        from usage_budgets where tenant_id = ${context.tenantId} and id = ${budgetId} and enabled`;
      if (!budget) return null;
      const { start, end } = budgetPeriod(budget.period, at);
      const [total] = await tx<{ spentMinor: string; missing: boolean }[]>`
        select coalesce(sum(case when latest.report_currency = ${budget.currency} then latest.report_cost_minor else 0 end), 0)::text as "spentMinor",
          bool_or(latest.id is null or latest.state <> 'priced' or latest.report_currency <> ${budget.currency}) as missing
        from usage_events e
        left join lateral (
          select id, state, report_cost_minor, report_currency from usage_valuations
          where tenant_id = e.tenant_id and event_id = e.id order by version desc limit 1
        ) latest on true
        where e.tenant_id = ${context.tenantId} and e.occurred_at >= ${start} and e.occurred_at < ${end}
          and (${budget.customerId}::uuid is null or e.customer_id = ${budget.customerId})
          and (${budget.productId}::uuid is null or e.product_id = ${budget.productId})
          and (${budget.customerServiceId}::uuid is null or e.customer_service_id = ${budget.customerServiceId})
          and (${budget.projectId}::uuid is null or e.project_id = ${budget.projectId})`;
      const sources = await tx<Array<{ required: boolean; lastCompleteAt: Date | null; maxAgeMinutes: number }>>`
        select bs.required, s.last_complete_at as "lastCompleteAt",
          (bs.max_age_seconds / 60)::integer as "maxAgeMinutes"
        from usage_budget_sources bs join usage_sources s
          on s.tenant_id = bs.tenant_id and s.id = bs.source_id
        where bs.tenant_id = ${context.tenantId} and bs.budget_id = ${budgetId} order by s.id`;
      return {
        budgetId,
        amountMinor: BigInt(budget.amountMinor),
        currency: budget.currency,
        warningBasisPoints: budget.warningBasisPoints,
        periodStart: start.toISOString(),
        spentMinor: BigInt(total?.spentMinor ?? "0"),
        hasMissingValuation: total?.missing ?? false,
        sources
      };
    });
  }

  recordBudgetState(context: TenantContext, evaluation: UsageBudgetEvaluation) {
    return withTenant(this.database, context.tenantId, async (tx) => {
      await tx`select id from usage_budgets where tenant_id = ${context.tenantId} and id = ${evaluation.budgetId} for update`;
      const [latest] = await tx<{ id: string; state: string }[]>`select id, state from usage_budget_events
        where tenant_id = ${context.tenantId} and budget_id = ${evaluation.budgetId}
        order by created_at desc, id desc limit 1`;
      if (latest?.state === evaluation.state) return { changed: false };
      const idempotencyKey = `${evaluation.periodStart}:${evaluation.state}:${latest?.id ?? "initial"}`;
      await tx`insert into usage_budget_events
        (id, tenant_id, budget_id, idempotency_key, previous_state, state, observed_through)
        values (${randomUUID()}, ${context.tenantId}, ${evaluation.budgetId}, ${idempotencyKey},
          ${latest?.state ?? null}, ${evaluation.state}, ${evaluation.observedThrough})
        on conflict (tenant_id, budget_id, idempotency_key) do nothing`;
      return { changed: true };
    });
  }

  finalizeMonthlySnapshot(context: TenantContext, input: { month: string; reportCurrency: string; finalizedAt: Date }) {
    return withTenant(this.database, context.tenantId, async (tx) => {
      const start = new Date(`${input.month}T00:00:00.000Z`);
      const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
      await tx`select pg_advisory_xact_lock(hashtextextended(${`${context.tenantId}:${input.month}:${input.reportCurrency}`}, 0))`;
      const [incomplete] = await tx<{ incomplete: boolean }[]>`
        select exists (
          select 1 from usage_events e left join lateral (
            select state from usage_valuations where tenant_id = e.tenant_id and event_id = e.id
            order by version desc limit 1
          ) v on true
          where e.tenant_id = ${context.tenantId} and e.occurred_at >= ${start} and e.occurred_at < ${end}
            and (v.state is null or v.state <> 'priced')
        ) or exists (select 1 from usage_sources where tenant_id = ${context.tenantId} and last_complete_at is null)
        as incomplete`;
      if (incomplete!.incomplete) throw new Error("USAGE_SNAPSHOT_INCOMPLETE_EVIDENCE");
      const [revisionRow] = await tx<{ revision: number }[]>`select coalesce(max(revision), 0)::integer + 1 as revision
        from usage_monthly_snapshots where tenant_id = ${context.tenantId} and month = ${input.month}`;
      const rows = await tx`
        insert into usage_monthly_snapshots
          (id, tenant_id, month, revision, source_id, sku, customer_id, product_id, customer_service_id,
            project_id, original_currency, report_currency, quantities, original_cost_minor,
            report_cost_minor, attributed_basis_points, observed_through, missing, finalized_at)
        select gen_random_uuid(), e.tenant_id, ${input.month}::date, ${revisionRow!.revision}, e.source_id, e.sku,
          e.customer_id, e.product_id, e.customer_service_id, e.project_id, v.original_currency,
          ${input.reportCurrency}, (
            select jsonb_object_agg(t.key, t.quantity) from (
              select q.unit || ':' || q.qualifier as key, sum(q.quantity)::text as quantity
              from usage_events qe join usage_event_quantities q
                on q.tenant_id = qe.tenant_id and q.event_id = qe.id
              where qe.tenant_id = e.tenant_id and qe.source_id = e.source_id and qe.sku = e.sku
                and qe.customer_id is not distinct from e.customer_id
                and qe.product_id is not distinct from e.product_id
                and qe.customer_service_id is not distinct from e.customer_service_id
                and qe.project_id is not distinct from e.project_id
                and qe.occurred_at >= ${start} and qe.occurred_at < ${end}
              group by q.unit, q.qualifier
            ) t
          ), sum(v.original_cost_minor), sum(v.report_cost_minor),
          case when num_nonnulls(e.customer_id, e.product_id, e.customer_service_id, e.project_id) = 1 then 10000 else 0 end,
          max(e.occurred_at), '[]'::jsonb, ${input.finalizedAt}
        from usage_events e join lateral (
          select original_currency, original_cost_minor, report_cost_minor, report_currency
          from usage_valuations where tenant_id = e.tenant_id and event_id = e.id
          order by version desc limit 1
        ) v on v.report_currency = ${input.reportCurrency}
        where e.tenant_id = ${context.tenantId} and e.occurred_at >= ${start} and e.occurred_at < ${end}
        group by e.tenant_id, e.source_id, e.sku, e.customer_id, e.product_id, e.customer_service_id,
          e.project_id, v.original_currency`;
      return { revision: revisionRow!.revision, rows: rows.count };
    });
  }
}

function budgetPeriod(period: "monthly" | "quarterly" | "annual", at: Date) {
  const year = at.getUTCFullYear();
  const month = at.getUTCMonth();
  const startMonth = period === "annual" ? 0 : period === "quarterly" ? Math.floor(month / 3) * 3 : month;
  const months = period === "annual" ? 12 : period === "quarterly" ? 3 : 1;
  return {
    start: new Date(Date.UTC(year, startMonth, 1)),
    end: new Date(Date.UTC(year, startMonth + months, 1))
  };
}

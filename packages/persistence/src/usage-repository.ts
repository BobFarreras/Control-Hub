import { randomUUID } from "node:crypto";
import type {
  UsageBudgetInput,
  UsageCostRecord,
  UsageEventInput,
  UsageEventRecord,
  UsageListQuery,
  UsageRateInput,
  UsageRepository
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

  createBudget(context: TenantContext, input: UsageBudgetInput) {
    return withTenant(this.database, context.tenantId, async (tx) => {
      const id = randomUUID();
      await tx`insert into usage_budgets
        (id, tenant_id, name, period, amount_minor, currency, warning_basis_points)
        values (${id}, ${context.tenantId}, ${input.name}, ${input.period}, ${input.amountMinor.toString()},
          ${input.currency}, ${input.warningBasisPoints})`;
      return { id };
    });
  }
}

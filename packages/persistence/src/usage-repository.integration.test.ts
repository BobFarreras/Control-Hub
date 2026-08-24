import { randomUUID } from "node:crypto";
import { UsageService } from "@control-hub/application";
import { createDatabaseClient, withTenant, type DatabaseClient } from "@control-hub/database";
import type { TenantContext } from "@control-hub/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresUsageRepository } from "./usage-repository.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const adminUrl = process.env.TEST_DATABASE_ADMIN_URL;
if (process.env.CI && !(databaseUrl && adminUrl))
  throw new Error("TEST_DATABASE_URL and TEST_DATABASE_ADMIN_URL are required in CI");
const suite = databaseUrl && adminUrl ? describe : describe.skip;

suite("PostgresUsageRepository", () => {
  let database: DatabaseClient;
  let admin: DatabaseClient;
  let repository: PostgresUsageRepository;
  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const sourceA = randomUUID();
  const sourceB = randomUUID();
  const connectorA = randomUUID();
  const userId = randomUUID();
  const membershipA = randomUUID();
  const context = (
    tenantId: string,
    permissions: TenantContext["permissions"] = ["usage:read", "usage:manage", "budgets:manage", "financials:read"]
  ): TenantContext => ({
    tenantId,
    membershipId: tenantId === tenantA ? membershipA : randomUUID(),
    userId,
    roles: ["owner"],
    permissions,
    mfaEnabled: true
  });
  const event = (sourceId: string) => ({
    sourceId,
    externalId: "provider-event-1",
    occurredAt: new Date("2026-08-23T12:00:00Z"),
    operation: "usage",
    sku: "model-a",
    status: "observed" as const,
    quantities: [{ unit: "input_token" as const, quantity: 120n }]
  });

  beforeAll(async () => {
    database = createDatabaseClient(databaseUrl!);
    admin = createDatabaseClient(adminUrl!);
    repository = new PostgresUsageRepository(database);
    await admin`insert into tenants (id, slug, name) values
      (${tenantA}, ${`usage-${tenantA}`}, 'Usage A'), (${tenantB}, ${`usage-${tenantB}`}, 'Usage B')`;
    await admin`insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
      values (${userId}, 'Usage Test', ${`${userId}@test.local`}, true, now(), now())`;
    await admin`insert into memberships (id, tenant_id, user_id) values (${membershipA}, ${tenantA}, ${userId})`;
    await admin`insert into usage_sources (id, tenant_id, kind, manual_code) values
      (${sourceA}, ${tenantA}, 'manual', 'test'), (${sourceB}, ${tenantB}, 'manual', 'test')`;
    await admin`insert into connector_instances (id, tenant_id, connector_type, name)
      values (${connectorA}, ${tenantA}, 'test', 'Usage connector')`;
  });

  afterAll(async () => {
    const evidenceTables = [
      "usage_valuation_lines",
      "usage_valuations",
      "usage_budget_events",
      "usage_monthly_snapshots",
      "usage_adjustment_quantities",
      "usage_adjustments",
      "usage_event_quantities",
      "usage_events",
      "usage_rate_tiers",
      "usage_rates",
      "exchange_rates"
    ];
    for (const table of evidenceTables) {
      await admin.unsafe(`alter table ${table} disable trigger user`);
    }
    try {
      await admin`delete from usage_valuation_lines where tenant_id in (${tenantA}, ${tenantB})`;
      await admin`delete from usage_valuations where tenant_id in (${tenantA}, ${tenantB})`;
      await admin`delete from usage_budget_events where tenant_id in (${tenantA}, ${tenantB})`;
      await admin`delete from usage_monthly_snapshots where tenant_id in (${tenantA}, ${tenantB})`;
      await admin`delete from usage_budget_sources where tenant_id in (${tenantA}, ${tenantB})`;
      await admin`delete from usage_budgets where tenant_id in (${tenantA}, ${tenantB})`;
      await admin`delete from usage_event_quantities where tenant_id in (${tenantA}, ${tenantB})`;
      await admin`delete from usage_events where tenant_id in (${tenantA}, ${tenantB})`;
      await admin`delete from usage_rate_tiers where tenant_id in (${tenantA}, ${tenantB})`;
      await admin`delete from usage_rates where tenant_id in (${tenantA}, ${tenantB})`;
      await admin`delete from exchange_rates where tenant_id in (${tenantA}, ${tenantB})`;
      await admin`delete from usage_sources where tenant_id in (${tenantA}, ${tenantB})`;
      await admin`delete from connector_instances where tenant_id in (${tenantA}, ${tenantB})`;
      await admin`delete from memberships where tenant_id in (${tenantA}, ${tenantB})`;
      await admin`delete from tenants where id in (${tenantA}, ${tenantB})`;
      await admin`delete from "user" where id = ${userId}`;
    } finally {
      for (const table of evidenceTables) {
        await admin.unsafe(`alter table ${table} enable trigger user`);
      }
      await database.end({ timeout: 5 });
      await admin.end({ timeout: 5 });
    }
  });

  it("isolates both tenant directions", async () => {
    await repository.ingestEvent(context(tenantA), event(sourceA));
    expect(await repository.listEvents(context(tenantA), {})).toHaveLength(1);
    expect(await repository.listEvents(context(tenantB), {})).toHaveLength(0);
    await repository.ingestEvent(context(tenantB), event(sourceB));
    expect(await repository.listEvents(context(tenantA), {})).toHaveLength(1);
    expect(await repository.listEvents(context(tenantB), {})).toHaveLength(1);
  });

  it("rejects a source from another tenant", async () => {
    await expect(
      repository.ingestEvent(context(tenantA), { ...event(sourceB), externalId: "foreign" })
    ).rejects.toThrow();
  });

  it("deduplicates concurrent ingestion with one database constraint", async () => {
    const input = { ...event(sourceA), externalId: "concurrent" };
    const results = await Promise.all([
      repository.ingestEvent(context(tenantA), input),
      repository.ingestEvent(context(tenantA), input)
    ]);
    expect(results.filter((result) => result.inserted)).toHaveLength(1);
    expect(
      (await repository.listEvents(context(tenantA), {})).filter((item) => item.externalId === "concurrent")
    ).toHaveLength(1);
  });

  it("retains reported cost and advances source completeness monotonically", async () => {
    const source = await repository.ensureConnectorSource(context(tenantA), {
      instanceId: connectorA,
      operation: "pull_usage"
    });
    const completedAt = new Date("2026-08-23T14:00:00Z");
    await repository.completeSource(context(tenantA), source.id, completedAt);
    await repository.completeSource(context(tenantA), source.id, new Date("2026-08-23T13:00:00Z"));
    expect(await repository.listSources(context(tenantA))).toContainEqual({
      id: source.id,
      instanceId: connectorA,
      operation: "pull_usage",
      lastCompleteAt: completedAt
    });
    expect(await repository.listSources(context(tenantB))).toEqual([]);
    const result = await repository.ingestEvent(context(tenantA), {
      ...event(source.id),
      externalId: "reported-cost",
      reportedCost: { amountMinor: 17n, currency: "EUR" }
    });
    expect(result.record.reportedCost).toEqual({ amountMinor: 17n, currency: "EUR" });
    const [stored] = await withTenant(
      database,
      tenantA,
      (tx) => tx<{ lastCompleteAt: Date }[]>`select last_complete_at as "lastCompleteAt"
        from usage_sources where id = ${source.id}`
    );
    expect(stored!.lastCompleteAt).toEqual(completedAt);
  });

  it("preserves OpenCode reasoning and cache categories", async () => {
    const result = await repository.ingestEvent(context(tenantA), {
      ...event(sourceA),
      externalId: "opencode-qualifiers",
      quantities: [
        { unit: "output_token", quantity: 3n, qualifier: "reasoning" },
        { unit: "cached_input_token", quantity: 5n, qualifier: "cache_read" },
        { unit: "cached_input_token", quantity: 2n, qualifier: "cache_write" }
      ]
    });
    expect(result.record.quantities).toEqual([
      { unit: "output_token", quantity: 3n, qualifier: "reasoning" },
      { unit: "cached_input_token", quantity: 5n, qualifier: "cache_read" },
      { unit: "cached_input_token", quantity: 2n, qualifier: "cache_write" }
    ]);
  });

  it("does not let the application role mutate evidence", async () => {
    const [record] = await repository.listEvents(context(tenantA), {});
    await expect(
      withTenant(database, tenantA, (tx) => tx`update usage_events set sku = 'changed' where id = ${record!.id}`)
    ).rejects.toThrow();
    await expect(
      withTenant(database, tenantA, (tx) => tx`delete from usage_events where id = ${record!.id}`)
    ).rejects.toThrow();
  });

  it("denies financial lookup before the repository even when Technical knows the id", () => {
    const service = new UsageService(repository);
    expect(() => service.listCosts(context(tenantA, ["usage:read"]), { eventId: randomUUID() })).toThrow(
      expect.objectContaining({ code: "FORBIDDEN" })
    );
  });

  it("freezes tariff and FX evidence across explicit revaluations", async () => {
    const service = new UsageService(repository);
    const owner = context(tenantA);
    const rate = await service.createRate(owner, {
      provider: "test",
      sku: "valued-model",
      unit: "input_token",
      unitSize: 1_000n,
      currency: "USD",
      effectiveFrom: new Date("2026-01-01T00:00:00Z"),
      tiers: [{ startsAt: 0n, priceMinor: 10n }]
    });
    const fx = await service.createExchangeRate(owner, {
      baseCurrency: "USD",
      quoteCurrency: "EUR",
      rateDay: "2026-08-23",
      numerator: 9n,
      denominator: 10n,
      source: "manual-test"
    });
    const ingested = await service.ingestEvent(owner, {
      ...event(sourceA),
      externalId: "valued-event",
      sku: "valued-model",
      quantities: [{ unit: "input_token", quantity: 1_500n }]
    });
    const first = await service.valueEvent(owner, ingested.record.id, "EUR");
    expect(first).toMatchObject({ version: 1, state: "priced", originalCostMinor: 15n, reportCostMinor: 14n });
    const replacement = await service.createRate(owner, {
      provider: "test",
      sku: "valued-model",
      unit: "input_token",
      unitSize: 1_000n,
      currency: "USD",
      effectiveFrom: new Date("2026-08-01T00:00:00Z"),
      tiers: [{ startsAt: 0n, priceMinor: 20n }]
    });
    const [stillFirst] = await withTenant(
      database,
      tenantA,
      (tx) => tx<{ version: number; reportCostMinor: string }[]>`select version,
        report_cost_minor::text as "reportCostMinor" from usage_valuations
        where event_id = ${ingested.record.id} order by version desc limit 1`
    );
    expect(stillFirst).toEqual({ version: 1, reportCostMinor: "14" });
    const second = await service.valueEvent(owner, ingested.record.id, "EUR");
    expect(second).toMatchObject({ version: 2, originalCostMinor: 30n, reportCostMinor: 27n });
    await expect(service.annulRate(owner, replacement.id)).resolves.toBe(true);
    await expect(service.annulRate(owner, replacement.id)).resolves.toBe(false);
    await expect(service.annulExchangeRate(owner, fx.id)).resolves.toBe(true);
    await expect(service.annulExchangeRate(owner, fx.id)).resolves.toBe(false);
    expect(rate.id).toBeTruthy();
  });

  it("evaluates budget freshness before thresholds and records only transitions", async () => {
    const service = new UsageService(repository);
    const owner = context(tenantA);
    const at = new Date("2026-08-23T16:00:00Z");
    const budget = await service.createBudget(owner, {
      name: "Provider budget",
      amountMinor: 10n,
      currency: "EUR",
      period: "monthly",
      warningBasisPoints: 8_000,
      sources: [{ sourceId: sourceA, required: true, maxAgeMinutes: 60 }]
    });
    expect((await service.evaluateBudget(owner, budget.id, at)).state).toBe("stale");
    await repository.completeSource(owner, sourceA, at);
    expect((await service.evaluateBudget(owner, budget.id, at)).state).toBe("partial");
    await service.evaluateBudget(owner, budget.id, at);
    const [events] = await withTenant(
      database,
      tenantA,
      (tx) =>
        tx<{ count: string }[]>`select count(*)::text as count from usage_budget_events where budget_id = ${budget.id}`
    );
    expect(events!.count).toBe("2");
  });

  it("finalizes versioned monthly snapshots only with complete valuation evidence", async () => {
    const service = new UsageService(repository);
    const owner = context(tenantA);
    await service.createRate(owner, {
      provider: "test",
      sku: "snapshot-model",
      unit: "input_token",
      unitSize: 1_000n,
      currency: "EUR",
      effectiveFrom: new Date("2026-09-01T00:00:00Z"),
      tiers: [{ startsAt: 0n, priceMinor: 10n }]
    });
    const september = await service.ingestEvent(owner, {
      ...event(sourceA),
      externalId: "snapshot-event",
      occurredAt: new Date("2026-09-10T10:00:00Z"),
      sku: "snapshot-model",
      quantities: [{ unit: "input_token", quantity: 2_000n }]
    });
    await service.valueEvent(owner, september.record.id, "EUR");
    const sourceIds = await withTenant(
      database,
      tenantA,
      (tx) => tx<{ id: string }[]>`select id from usage_sources where tenant_id = ${tenantA}`
    );
    for (const source of sourceIds) await repository.completeSource(owner, source.id, new Date("2026-10-01T00:00:00Z"));
    await expect(service.finalizeMonthlySnapshot(owner, "2026-09-01", "EUR")).resolves.toMatchObject({
      revision: 1,
      rows: 1
    });
    const [snapshot] = await withTenant(
      database,
      tenantA,
      (tx) => tx<{ quantities: Record<string, string>; reportCostMinor: string }[]>`
        select quantities, report_cost_minor::text as "reportCostMinor" from usage_monthly_snapshots
        where month = '2026-09-01' order by revision desc limit 1`
    );
    expect(snapshot).toEqual({ quantities: { "input_token:total": "2000" }, reportCostMinor: "20" });

    await service.ingestEvent(owner, {
      ...event(sourceA),
      externalId: "unvalued-october",
      occurredAt: new Date("2026-10-10T10:00:00Z")
    });
    await expect(service.finalizeMonthlySnapshot(owner, "2026-10-01", "EUR")).rejects.toMatchObject({
      code: "INCOMPLETE_EVIDENCE"
    });
  });
});

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
  const context = (
    tenantId: string,
    permissions: TenantContext["permissions"] = ["usage:read", "usage:manage", "financials:read"]
  ): TenantContext => ({
    tenantId,
    membershipId: randomUUID(),
    userId: randomUUID(),
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
    await admin`insert into usage_sources (id, tenant_id, kind, manual_code) values
      (${sourceA}, ${tenantA}, 'manual', 'test'), (${sourceB}, ${tenantB}, 'manual', 'test')`;
    await admin`insert into connector_instances (id, tenant_id, connector_type, name)
      values (${connectorA}, ${tenantA}, 'test', 'Usage connector')`;
  });

  afterAll(async () => {
    for (const table of ["usage_event_quantities", "usage_events"]) {
      await admin.unsafe(`alter table ${table} disable trigger ${table}_append_only`);
    }
    try {
      await admin`delete from usage_event_quantities where tenant_id in (${tenantA}, ${tenantB})`;
      await admin`delete from usage_events where tenant_id in (${tenantA}, ${tenantB})`;
      await admin`delete from usage_sources where tenant_id in (${tenantA}, ${tenantB})`;
      await admin`delete from connector_instances where tenant_id in (${tenantA}, ${tenantB})`;
      await admin`delete from tenants where id in (${tenantA}, ${tenantB})`;
    } finally {
      for (const table of ["usage_event_quantities", "usage_events"]) {
        await admin.unsafe(`alter table ${table} enable trigger ${table}_append_only`);
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
});

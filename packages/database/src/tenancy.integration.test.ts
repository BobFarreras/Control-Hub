import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabaseClient, withTenant, type DatabaseClient } from "./index.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const adminDatabaseUrl = process.env.TEST_DATABASE_ADMIN_URL;
// Skipping locally is a convenience; skipping in CI would mean tenant isolation ships unproven.
if (process.env.CI && !(databaseUrl && adminDatabaseUrl))
  throw new Error("TEST_DATABASE_URL and TEST_DATABASE_ADMIN_URL are required in CI");
const suite = databaseUrl && adminDatabaseUrl ? describe : describe.skip;

suite("tenant RLS", () => {
  let database: DatabaseClient;
  let adminDatabase: DatabaseClient;
  const tenantA = randomUUID();
  const tenantB = randomUUID();
  beforeAll(async () => {
    database = createDatabaseClient(databaseUrl!);
    adminDatabase = createDatabaseClient(adminDatabaseUrl!);
    await adminDatabase`insert into tenants (id, slug, name) values (${tenantA}, ${`test-${tenantA}`}, 'Tenant A'), (${tenantB}, ${`test-${tenantB}`}, 'Tenant B')`;
    await withTenant(
      database,
      tenantA,
      (tx) => tx`insert into tenant_settings (tenant_id, brand_name) values (${tenantA}, 'A')`
    );
    await withTenant(
      database,
      tenantB,
      (tx) => tx`insert into tenant_settings (tenant_id, brand_name) values (${tenantB}, 'B')`
    );
  });
  afterAll(async () => {
    await withTenant(database, tenantA, (tx) => tx`delete from tenant_settings where tenant_id = ${tenantA}`);
    await withTenant(database, tenantB, (tx) => tx`delete from tenant_settings where tenant_id = ${tenantB}`);
    await adminDatabase`delete from tenants where id in (${tenantA}, ${tenantB})`;
    await database.end({ timeout: 5 });
    await adminDatabase.end({ timeout: 5 });
  });
  it("does not expose another tenant when its identifier is manipulated", async () => {
    const rows = await withTenant(
      database,
      tenantA,
      (tx) => tx`select brand_name from tenant_settings where tenant_id = ${tenantB}`
    );
    expect(rows).toHaveLength(0);
  });
  it("keeps audit events append-only", async () => {
    const auditId = randomUUID();
    await expect(
      withTenant(database, tenantA, async (tx) => {
        await tx`insert into audit_log (id, tenant_id, action, target_type, outcome) values (${auditId}, ${tenantA}, 'test.created', 'test', 'success')`;
        await tx`update audit_log set action = 'test.modified' where id = ${auditId}`;
      })
    ).rejects.toThrow();
  });
});

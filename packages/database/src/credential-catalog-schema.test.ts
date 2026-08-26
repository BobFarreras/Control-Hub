import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrationUrl = new URL("../migrations/0059_credential_catalog.sql", import.meta.url);

describe("credential catalog schema", () => {
  it("forces tenant RLS and composite references on every catalog table", async () => {
    const source = await readFile(fileURLToPath(migrationUrl), "utf8");
    for (const table of ["password_manager_installations", "credential_catalog_entries", "credential_catalog_events"]) {
      expect(source).toContain(`alter table ${table} enable row level security`);
      expect(source).toContain(`alter table ${table} force row level security`);
      expect(source).toContain(`create policy ${table}_isolation`);
    }
    for (const parent of ["password_manager_installations", "customers", "company_subscriptions", "memberships"])
      expect(source).toContain(`references ${parent}(tenant_id, id)`);
  });

  it("stores only an authenticated envelope and makes history append-only", async () => {
    const source = await readFile(fileURLToPath(migrationUrl), "utf8");
    expect(source).toContain("reference_key_id text not null");
    expect(source).toContain("reference_nonce bytea not null");
    expect(source).toContain("reference_ciphertext bytea not null");
    expect(source).not.toMatch(/\b(password|master_password|totp|recovery_code)\s+(text|bytea)/u);
    expect(source).toContain("credential_catalog_events_immutable");
    expect(source).toContain("grant select, insert on credential_catalog_events");
    expect(source).not.toContain("grant select, insert, update on credential_catalog_events");
  });

  it("backfills least-privilege role grants", async () => {
    const source = await readFile(fileURLToPath(migrationUrl), "utf8");
    expect(source).toContain("r.code = 'owner'");
    expect(source).toContain("r.code = 'administrator'");
    expect(source).toContain("r.code = 'technical'");
    expect(source).toContain("'vault:manage'");
  });
});

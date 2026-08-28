import { randomUUID } from "node:crypto";
import { createDatabaseClient, type DatabaseClient } from "@control-hub/database";
import type { TenantContext } from "@control-hub/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresCredentialCatalogRepository } from "./credential-catalog-repository.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const adminUrl = process.env.TEST_DATABASE_ADMIN_URL;
if (process.env.CI && !(databaseUrl && adminUrl))
  throw new Error("TEST_DATABASE_URL and TEST_DATABASE_ADMIN_URL are required in CI");
const suite = databaseUrl && adminUrl ? describe : describe.skip;

suite("PostgresCredentialCatalogRepository", () => {
  let database: DatabaseClient;
  let admin: DatabaseClient;
  let repository: PostgresCredentialCatalogRepository;
  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const userId = randomUUID();
  const membershipA = randomUUID();
  const membershipB = randomUUID();

  const context = (tenantId: string, membershipId: string): TenantContext => ({
    tenantId,
    membershipId,
    userId,
    roles: ["owner"],
    permissions: ["credentials:read", "credentials:open", "credentials:manage", "vault:manage"],
    mfaEnabled: true
  });

  beforeAll(async () => {
    database = createDatabaseClient(databaseUrl!);
    admin = createDatabaseClient(adminUrl!);
    repository = new PostgresCredentialCatalogRepository(database);
    await admin`insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
      values (${userId}, 'Credential Catalog Test', ${`${userId}@test.local`}, true, now(), now())`;
    await admin`insert into tenants (id, slug, name) values
      (${tenantA}, ${`catalog-a-${tenantA}`}, 'Catalog A'), (${tenantB}, ${`catalog-b-${tenantB}`}, 'Catalog B')`;
    await admin`insert into memberships (id, tenant_id, user_id) values
      (${membershipA}, ${tenantA}, ${userId}), (${membershipB}, ${tenantB}, ${userId})`;
  });

  afterAll(async () => {
    await admin`set session_replication_role = 'replica'`;
    try {
      await admin`delete from tenants where id in (${tenantA}, ${tenantB})`;
    } finally {
      await admin`set session_replication_role = 'origin'`;
    }
    await admin`delete from "user" where id = ${userId}`;
    await database.end({ timeout: 5 });
    await admin.end({ timeout: 5 });
  });

  it("stores only the envelope, isolates tenants and filters assigned readers", async () => {
    const installation = await repository.createInstallation(context(tenantA, membershipA), {
      id: randomUUID(),
      displayName: "Main vault",
      baseUrl: "https://vault.example.test",
      deploymentMode: "self_hosted_shared_vps",
      status: "active",
      createdByMembershipId: membershipA
    });
    const plaintext = "https://vault.example.test/#/vault?itemId=never-return-this";
    const entry = await repository.createEntry(context(tenantA, membershipA), {
      id: randomUUID(),
      installationId: installation.id,
      clientId: null,
      companySubscriptionId: null,
      applicationName: "Hostinger",
      category: "hosting",
      environment: "production",
      accountLabel: "admin account",
      ownerMembershipId: membershipA,
      reviewDueAt: null,
      createdByMembershipId: membershipA,
      reference: { keyId: "workspace", nonce: Buffer.alloc(12, 1), ciphertext: Buffer.from(`sealed:${plaintext}`) }
    });

    expect(JSON.stringify(entry)).not.toContain("never-return-this");
    expect(await repository.listEntries(context(tenantB, membershipB), { mode: "all" })).toEqual([]);
    expect(
      await repository.listEntries(context(tenantA, membershipA), { mode: "assigned", membershipId: membershipB })
    ).toEqual([]);

    const [stored] = await admin<{ ciphertext: Buffer }[]>`
      select reference_ciphertext as ciphertext from credential_catalog_entries where id = ${entry.id}`;
    expect(stored?.ciphertext.equals(Buffer.from(`sealed:${plaintext}`))).toBe(true);
    expect((await repository.readReference(context(tenantA, membershipA), entry.id))?.keyId).toBe("workspace");
    expect(await repository.readReference(context(tenantB, membershipB), entry.id)).toBeNull();

    const reviewed = await repository.reviewEntry(context(tenantA, membershipA), {
      entryId: entry.id,
      expectedVersion: 1,
      actorMembershipId: membershipA,
      reviewedAt: new Date("2026-08-26T09:00:00.000Z")
    });
    expect(reviewed?.version).toBe(2);
    await repository.recordOpen(context(tenantA, membershipA), entry.id, membershipA);
    const updatedInstallation = await repository.updateInstallation(context(tenantA, membershipA), {
      installationId: installation.id,
      displayName: "Renamed vault",
      baseUrl: "https://new-vault.example.test",
      deploymentMode: "self_hosted_dedicated_vps",
      status: "active",
      expectedVersion: 1
    });
    expect(updatedInstallation).toMatchObject({ displayName: "Renamed vault", version: 2 });

    const events = await admin<{ eventType: string }[]>`select event_type as "eventType"
      from credential_catalog_events where tenant_id=${tenantA} and entry_id=${entry.id}`;
    expect(events.map((event) => event.eventType)).toEqual(
      expect.arrayContaining(["created", "reviewed", "open_attempted"])
    );
  });

  it("rejects cross-tenant references and keeps events immutable", async () => {
    const foreignInstallation = await repository.createInstallation(context(tenantB, membershipB), {
      id: randomUUID(),
      displayName: "Foreign vault",
      baseUrl: "https://foreign-vault.example.test",
      deploymentMode: "cloud",
      status: "active",
      createdByMembershipId: membershipB
    });
    await expect(
      repository.createEntry(context(tenantA, membershipA), {
        id: randomUUID(),
        installationId: foreignInstallation.id,
        clientId: null,
        companySubscriptionId: null,
        applicationName: "Cross tenant",
        category: "other",
        environment: "production",
        accountLabel: null,
        ownerMembershipId: membershipA,
        reviewDueAt: null,
        createdByMembershipId: membershipA,
        reference: { keyId: "workspace", nonce: Buffer.alloc(12, 2), ciphertext: Buffer.alloc(32, 2) }
      })
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });

    await expect(
      admin`update credential_catalog_events set outcome = 'failed' where tenant_id = ${tenantA}`
    ).rejects.toThrow();
  });
});

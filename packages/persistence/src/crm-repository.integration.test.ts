import { randomUUID } from "node:crypto";
import { type CrmError } from "@control-hub/application";
import { createDatabaseClient, type DatabaseClient } from "@control-hub/database";
import type { TenantContext } from "@control-hub/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresCrmRepository } from "./crm-repository.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const adminUrl = process.env.TEST_DATABASE_ADMIN_URL;
// Skipping locally is a convenience; skipping in CI would mean tenant isolation ships unproven.
if (process.env.CI && !(databaseUrl && adminUrl))
  throw new Error("TEST_DATABASE_URL and TEST_DATABASE_ADMIN_URL are required in CI");
const suite = databaseUrl && adminUrl ? describe : describe.skip;

suite("PostgresCrmRepository", () => {
  let database: DatabaseClient;
  let admin: DatabaseClient;
  let repository: PostgresCrmRepository;
  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const userId = randomUUID();
  const context = (tenantId: string): TenantContext => ({
    tenantId,
    userId,
    membershipId: randomUUID(),
    roles: ["owner"],
    permissions: ["leads:read", "leads:manage", "customers:read", "customers:manage"],
    mfaEnabled: true
  });
  beforeAll(async () => {
    database = createDatabaseClient(databaseUrl!);
    admin = createDatabaseClient(adminUrl!);
    repository = new PostgresCrmRepository(database);
    await admin`insert into "user" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt") values (${userId}, 'CRM Test', ${`${userId}@test.local`}, true, now(), now())`;
    await admin`insert into tenants (id, slug, name) values (${tenantA}, ${`crm-${tenantA}`}, 'CRM A'), (${tenantB}, ${`crm-${tenantB}`}, 'CRM B')`;
  });
  afterAll(async () => {
    await admin`alter table crm_activity disable trigger crm_activity_append_only`;
    await admin`delete from crm_activity where tenant_id in (${tenantA}, ${tenantB})`;
    await admin`alter table crm_activity enable trigger crm_activity_append_only`;
    await admin`alter table customer_product_interest_events disable trigger customer_product_interest_events_append_only`;
    await admin`delete from customer_product_interest_events where tenant_id in (${tenantA}, ${tenantB})`;
    await admin`alter table customer_product_interest_events enable trigger customer_product_interest_events_append_only`;
    await admin`delete from tenants where id in (${tenantA}, ${tenantB})`;
    await admin`delete from "user" where id = ${userId}`;
    await database.end({ timeout: 5 });
    await admin.end({ timeout: 5 });
  });

  it("isolates lists and strong duplicate keys by tenant", async () => {
    const input = {
      name: "Avant",
      email: "sales@example.com",
      source: "manual",
      priority: "normal" as const,
      normalizedName: "avant",
      normalizedEmail: "sales@example.com",
      normalizedPhone: null
    };
    await repository.createLead(context(tenantA), input);
    await repository.createLead(context(tenantB), input);
    await expect(repository.createLead(context(tenantA), input)).rejects.toEqual(
      expect.objectContaining({ code: "DUPLICATE_EMAIL" } satisfies Partial<CrmError>)
    );
    expect((await repository.listLeads(context(tenantA), { page: 1, pageSize: 25, sort: "updated_desc" })).total).toBe(
      1
    );
  });

  it("converts a lead exactly once", async () => {
    const created = await repository.createLead(context(tenantA), {
      name: "Idempotent",
      source: "manual",
      priority: "high",
      normalizedName: "idempotent",
      normalizedEmail: null,
      normalizedPhone: null
    });
    const first = await repository.convertLead(context(tenantA), created.id);
    const second = await repository.convertLead(context(tenantA), created.id);
    expect(second.id).toBe(first.id);
    expect(
      (await repository.listCustomers(context(tenantA), { page: 1, pageSize: 25, sort: "updated_desc" })).total
    ).toBe(1);
  });

  it("creates and recovers the primary contact from an unambiguous company lead", async () => {
    const lead = await repository.createLead(context(tenantA), {
      name: "Maria Bosch",
      companyName: "Bosch Atelier",
      email: "maria@bosch.example",
      source: "website",
      priority: "high",
      normalizedName: "maria bosch",
      normalizedEmail: "maria@bosch.example",
      normalizedPhone: null
    });
    const customer = await repository.convertLead(context(tenantA), lead.id);
    const created = (await repository.getCustomer(context(tenantA), customer.id)).contacts[0]!;
    expect(created).toMatchObject({ name: "Maria Bosch", isPrimary: true, sourceLeadId: lead.id });
    expect((await repository.createContactFromSourceLead(context(tenantA), customer.id)).id).toBe(created.id);
  });

  it("updates customers only in their tenant and rejects stale versions", async () => {
    const lead = await repository.createLead(context(tenantA), {
      name: "Editable customer",
      source: "manual",
      priority: "normal",
      normalizedName: "editable customer",
      normalizedEmail: null,
      normalizedPhone: null
    });
    const customer = await repository.convertLead(context(tenantA), lead.id);
    const input = {
      displayName: "Updated customer",
      legalName: "Updated Customer, SL",
      billingEmail: "billing@updated.example",
      phone: "+34 600 100 200",
      website: "https://updated.example",
      taxId: "B12345678",
      preferredLocale: "ca" as const,
      timezone: "Europe/Madrid",
      status: "inactive" as const,
      expectedUpdatedAt: new Date(customer.updatedAt)
    };

    const updated = await repository.updateCustomer(context(tenantA), customer.id, input);
    expect(updated).toMatchObject({ displayName: "Updated customer", status: "inactive", taxId: "B12345678" });
    await expect(repository.updateCustomer(context(tenantA), customer.id, input)).rejects.toEqual(
      expect.objectContaining({ code: "CUSTOMER_VERSION_CONFLICT" } satisfies Partial<CrmError>)
    );
    await expect(repository.updateCustomer(context(tenantB), customer.id, input)).rejects.toEqual(
      expect.objectContaining({ code: "CUSTOMER_NOT_FOUND" } satisfies Partial<CrmError>)
    );
  });

  it("creates and removes customer addresses without crossing tenants", async () => {
    const lead = await repository.createLead(context(tenantA), {
      name: "Address customer",
      source: "manual",
      priority: "normal",
      normalizedName: "address customer",
      normalizedEmail: null,
      normalizedPhone: null
    });
    const customer = await repository.convertLead(context(tenantA), lead.id);
    const address = await repository.createCustomerAddress(context(tenantA), customer.id, {
      type: "billing",
      line1: "Carrer Major 1",
      city: "Barcelona",
      countryCode: "ES",
      isPrimary: true
    });
    expect((await repository.getCustomer(context(tenantA), customer.id)).addresses[0]).toMatchObject({
      id: address.id,
      type: "billing",
      isPrimary: true
    });
    await expect(repository.deleteCustomerAddress(context(tenantB), customer.id, address.id)).rejects.toEqual(
      expect.objectContaining({ code: "ADDRESS_NOT_FOUND" } satisfies Partial<CrmError>)
    );
    await repository.deleteCustomerAddress(context(tenantA), customer.id, address.id);
    expect((await repository.getCustomer(context(tenantA), customer.id)).addresses).toEqual([]);
  });

  it("keeps product opportunities tenant-scoped, unique while open and financially redacted", async () => {
    const productId = randomUUID();
    await admin`insert into products (id, tenant_id, code, name) values (${productId}, ${tenantA}, 'crm-interest', 'CRM Interest')`;
    const lead = await repository.createLead(context(tenantA), {
      name: "Opportunity customer",
      source: "manual",
      priority: "normal",
      normalizedName: "opportunity customer",
      normalizedEmail: null,
      normalizedPhone: null
    });
    const customer = await repository.convertLead(context(tenantA), lead.id);
    const baseContext = context(tenantA);
    const financialContext: TenantContext = {
      ...baseContext,
      permissions: [...baseContext.permissions, "financials:read"]
    };
    const interest = await repository.createCustomerInterest(financialContext, customer.id, {
      productId,
      probability: 35,
      estimatedAmountMinor: 125_000,
      currency: "EUR",
      nextStep: "Prepare discovery"
    });
    expect(interest).toMatchObject({ stage: "detected", estimatedAmountMinor: 125_000 });
    await expect(repository.createCustomerInterest(financialContext, customer.id, { productId })).rejects.toEqual(
      expect.objectContaining({ code: "DUPLICATE_INTEREST" } satisfies Partial<CrmError>)
    );
    expect(Object.hasOwn((await repository.getCustomer(context(tenantA), customer.id)).interests[0]!, "currency")).toBe(
      false
    );
    expect((await repository.getCustomer(financialContext, customer.id)).interests[0]).toMatchObject({
      estimatedAmountMinor: 125_000,
      currency: "EUR"
    });
    await expect(repository.getCustomerInterest(context(tenantB), interest.id)).rejects.toEqual(
      expect.objectContaining({ code: "INTEREST_NOT_FOUND" } satisfies Partial<CrmError>)
    );
    expect((await repository.transitionCustomerInterest(financialContext, interest.id, "qualified")).stage).toBe(
      "qualified"
    );
  });

  it("imports the same batch row exactly once within each tenant", async () => {
    const input = {
      name: "Batch-only lead",
      source: "spreadsheet",
      priority: "normal" as const,
      normalizedName: "batch-only lead",
      normalizedEmail: null,
      normalizedPhone: null
    };
    await expect(repository.importLead(context(tenantA), input, "batch-a:2")).resolves.toBe("imported");
    await expect(repository.importLead(context(tenantA), input, "batch-a:2")).resolves.toBe("already_imported");
    await expect(repository.importLead(context(tenantB), input, "batch-a:2")).resolves.toBe("imported");
  });

  it("reopens a lost lead to its latest active state with an append-only reason", async () => {
    const created = await repository.createLead(context(tenantA), {
      name: "Recoverable",
      source: "manual",
      priority: "normal",
      normalizedName: "recoverable",
      normalizedEmail: null,
      normalizedPhone: null
    });
    await repository.transitionLead(context(tenantA), created.id, "proposal");
    await repository.transitionLead(context(tenantA), created.id, "lost");

    const reopened = await repository.reopenLead(context(tenantA), created.id, "The customer requested a new call");
    expect(reopened.status).toBe("proposal");
    const activity = await admin<{ metadata: { fromStatus: string; toStatus: string; reason: string } }[]>`
      select metadata from crm_activity where tenant_id = ${tenantA} and lead_id = ${created.id}
        and type = 'lead.reopened'`;
    expect(activity[0]?.metadata).toEqual({
      fromStatus: "lost",
      toStatus: "proposal",
      reason: "The customer requested a new call"
    });
    await expect(repository.reopenLead(context(tenantA), created.id, "Again")).rejects.toEqual(
      expect.objectContaining({ code: "INVALID_TRANSITION" } satisfies Partial<CrmError>)
    );
    await expect(repository.reopenLead(context(tenantB), created.id, "Cross tenant")).rejects.toEqual(
      expect.objectContaining({ code: "LEAD_NOT_FOUND" } satisfies Partial<CrmError>)
    );
  });

  it("falls back to new when a legacy lost lead has no previous status event", async () => {
    const created = await repository.createLead(context(tenantA), {
      name: "Legacy Lost",
      source: "manual",
      priority: "normal",
      normalizedName: "legacy lost",
      normalizedEmail: null,
      normalizedPhone: null
    });
    await repository.transitionLead(context(tenantA), created.id, "lost");
    expect((await repository.reopenLead(context(tenantA), created.id, "Restart qualification")).status).toBe("new");
  });

  it("builds customer activity without crossing tenant boundaries", async () => {
    const created = await repository.createLead(context(tenantA), {
      name: "Activity",
      source: "manual",
      priority: "normal",
      normalizedName: "activity",
      normalizedEmail: null,
      normalizedPhone: null
    });
    const customer = await repository.convertLead(context(tenantA), created.id);
    await repository.addContact(context(tenantA), customer.id, {
      name: "Primary Contact",
      email: "contact@example.com",
      isPrimary: true
    });
    await repository.addNote(context(tenantA), customer.id, "Commercial note");
    const task = await repository.addTask(context(tenantA), customer.id, {
      title: "Follow up",
      dueAt: new Date(Date.now() - 60_000)
    });
    expect((await repository.getCustomer(context(tenantA), customer.id)).activity.length).toBeGreaterThanOrEqual(4);
    expect((await repository.commercialSummary(context(tenantA))).overdueTasks).toBe(1);
    await repository.completeTask(context(tenantA), task.id);
    expect((await repository.commercialSummary(context(tenantA))).overdueTasks).toBe(0);
    await expect(repository.getCustomer(context(tenantB), customer.id)).rejects.toEqual(
      expect.objectContaining({ code: "CUSTOMER_NOT_FOUND" } satisfies Partial<CrmError>)
    );
  });
});

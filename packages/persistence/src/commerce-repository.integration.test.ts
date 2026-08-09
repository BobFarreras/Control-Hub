import { randomUUID } from "node:crypto";
import { type CommerceError, CommerceService } from "@control-hub/application";
import { createDatabaseClient, withTenant, type DatabaseClient } from "@control-hub/database";
import type { TenantContext } from "@control-hub/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresCommerceRepository } from "./commerce-repository.js";
import { PostgresCustomerServicesRepository } from "./customer-services-repository.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const adminUrl = process.env.TEST_DATABASE_ADMIN_URL;
// Skipping locally is a convenience; skipping in CI would mean tenant isolation ships unproven.
if (process.env.CI && !(databaseUrl && adminUrl))
  throw new Error("TEST_DATABASE_URL and TEST_DATABASE_ADMIN_URL are required in CI");
const suite = databaseUrl && adminUrl ? describe : describe.skip;

suite("PostgresCommerceRepository", () => {
  let database: DatabaseClient;
  let admin: DatabaseClient;
  let repository: PostgresCommerceRepository;
  let service: CommerceService;
  let customerServices: PostgresCustomerServicesRepository;
  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const userId = randomUUID();
  const customerA = randomUUID();
  const context = (tenantId: string): TenantContext => ({
    tenantId,
    userId,
    membershipId: randomUUID(),
    roles: ["owner"],
    permissions: ["products:manage", "subscriptions:manage", "financials:read"],
    mfaEnabled: true
  });

  beforeAll(async () => {
    database = createDatabaseClient(databaseUrl!);
    admin = createDatabaseClient(adminUrl!);
    repository = new PostgresCommerceRepository(database);
    customerServices = new PostgresCustomerServicesRepository(database);
    service = new CommerceService(repository);
    await admin`insert into "user" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt") values (${userId}, 'Commerce Test', ${`${userId}@test.local`}, true, now(), now())`;
    await admin`insert into tenants (id, slug, name) values (${tenantA}, ${`commerce-${tenantA}`}, 'Commerce A'), (${tenantB}, ${`commerce-${tenantB}`}, 'Commerce B')`;
    await admin`insert into customers (id, tenant_id, display_name, normalized_name) values (${customerA}, ${tenantA}, 'Customer A', 'customer a')`;
  });

  afterAll(async () => {
    await admin`alter table subscription_events disable trigger subscription_events_append_only`;
    await admin`alter table customer_service_events disable trigger customer_service_events_append_only`;
    await admin`alter table plan_prices disable trigger plan_prices_append_only`;
    try {
      await admin`delete from subscription_events where tenant_id in (${tenantA}, ${tenantB})`;
      await admin`delete from customer_service_events where tenant_id in (${tenantA}, ${tenantB})`;
      await admin`delete from customer_service_recurrence where tenant_id in (${tenantA}, ${tenantB})`;
      await admin`delete from customer_services where tenant_id in (${tenantA}, ${tenantB})`;
      await admin`delete from subscriptions where tenant_id in (${tenantA}, ${tenantB})`;
      await admin`delete from plan_prices where tenant_id in (${tenantA}, ${tenantB})`;
      await admin`delete from plans where tenant_id in (${tenantA}, ${tenantB})`;
      await admin`delete from product_versions where tenant_id in (${tenantA}, ${tenantB})`;
      await admin`delete from products where tenant_id in (${tenantA}, ${tenantB})`;
    } finally {
      await admin`alter table subscription_events enable trigger subscription_events_append_only`;
      await admin`alter table customer_service_events enable trigger customer_service_events_append_only`;
      await admin`alter table plan_prices enable trigger plan_prices_append_only`;
    }
    await admin`delete from tenants where id in (${tenantA}, ${tenantB})`;
    await admin`delete from "user" where id = ${userId}`;
    await database.end({ timeout: 5 });
    await admin.end({ timeout: 5 });
  });

  it("isolates a versioned catalog and keeps prices immutable", async () => {
    const product = await service.createProduct(context(tenantA), { code: "control-hub", name: "Control Hub" });
    const version = await service.createVersion(context(tenantA), product.id, {
      version: "1.0",
      status: "active",
      releasedAt: new Date()
    });
    const plan = await service.createPlan(context(tenantA), version.id, { code: "business-monthly", name: "Business" });
    const price = await service.createPrice(context(tenantA), plan.id, {
      currency: "EUR",
      amountMinor: 2500,
      costMinor: 500,
      taxBasisPoints: 2100,
      interval: "monthly"
    });
    expect((await service.catalog(context(tenantA))).prices).toHaveLength(1);
    expect((await service.catalog(context(tenantB))).products).toHaveLength(0);
    await expect(
      withTenant(database, tenantA, (tx) => tx`update plan_prices set amount_minor = 1 where id = ${price.id}`)
    ).rejects.toThrow();
  });

  it("creates the first complete offer atomically and rolls every row back on a late conflict", async () => {
    const offer = await service.createProductOffer(context(tenantA), {
      product: { code: "atomic-offer", name: "Atomic Offer" },
      version: { version: "1.0" },
      plan: { code: "atomic-plan", name: "Atomic Plan", commercialModel: "subscription" },
      price: { currency: "EUR", amountMinor: 4900, costMinor: 900, taxBasisPoints: 2100, interval: "monthly" }
    });
    expect(offer.price.planId).toBe(offer.plan.id);

    await expect(
      service.createProductOffer(context(tenantA), {
        product: { code: "must-roll-back", name: "Must Roll Back" },
        version: { version: "1.0" },
        plan: { code: "atomic-plan", name: "Duplicated Plan", commercialModel: "subscription" },
        price: { currency: "EUR", amountMinor: 1000, costMinor: 0, taxBasisPoints: 0, interval: "monthly" }
      })
    ).rejects.toEqual(expect.objectContaining({ code: "DUPLICATE_CODE" }));
    expect(
      (await service.catalog(context(tenantA))).products.some((product) => product.code === "must-roll-back")
    ).toBe(false);
    const detail = await service.productDetail(context(tenantA), offer.product.id);
    expect(detail).toMatchObject({ product: { id: offer.product.id }, plans: [{ commercialModel: "subscription" }] });
    await expect(service.productDetail(context(tenantB), offer.product.id)).rejects.toEqual(
      expect.objectContaining({ code: "PRODUCT_NOT_FOUND" })
    );
  });

  it("calculates metrics, renewal alerts and immutable state changes", async () => {
    const catalog = await service.catalog(context(tenantA));
    const plan = catalog.plans[0]!;
    const price = catalog.prices[0]!;
    const renewalAt = new Date(Date.now() + 3 * 86400_000);
    const subscription = await service.createSubscription(context(tenantA), {
      customerId: customerA,
      planId: plan.id,
      priceId: price.id,
      quantity: 2,
      renewalAt,
      renewalAlertDays: 7
    });
    await expect(service.financialSummary(context(tenantA))).resolves.toEqual([
      {
        currency: "EUR",
        mrrMinor: 5000,
        arrMinor: 60000,
        annualCostMinor: 12000,
        annualMarginMinor: 48000,
        activeSubscriptions: 1
      }
    ]);
    expect(await service.renewalAlerts(context(tenantA))).toHaveLength(1);
    const renewed = await service.renewSubscription(context(tenantA), subscription.id);
    expect(renewed.renewalAt?.getTime()).toBeGreaterThan(renewalAt.getTime());
    await service.transitionSubscription(context(tenantA), subscription.id, "paused");
    await expect(service.financialSummary(context(tenantA))).resolves.toEqual([]);
    await service.transitionSubscription(context(tenantA), subscription.id, "active");
    await service.transitionSubscription(context(tenantA), subscription.id, "canceled");
    await expect(service.transitionSubscription(context(tenantA), subscription.id, "active")).rejects.toEqual(
      expect.objectContaining({ code: "INVALID_SUBSCRIPTION_TRANSITION" } satisfies Partial<CommerceError>)
    );
    const history = await withTenant(
      database,
      tenantA,
      (tx) =>
        tx`select type from subscription_events where tenant_id = ${tenantA} and subscription_id = ${subscription.id}`
    );
    expect(history).toHaveLength(5);
  });

  it("persists recurring customer services and isolates their commercial data by tenant", async () => {
    const catalog = await service.catalog(context(tenantA));
    const plan = catalog.plans[0]!;
    const price = catalog.prices[0]!;
    const now = new Date();
    const created = await customerServices.create(context(tenantA), {
      customerId: customerA,
      planId: plan.id,
      priceId: price.id,
      quantity: 1,
      contractedAt: now,
      startsAt: now,
      currentPeriodStart: now,
      autoRenew: true,
      renewalAt: new Date(now.getTime() + 30 * 86400_000),
      renewalAlertDays: 14
    });

    expect(created).toMatchObject({
      customerId: customerA,
      commercialModel: "subscription",
      autoRenew: true,
      currency: "EUR"
    });
    await expect(customerServices.list(context(tenantA), {})).resolves.toContainEqual(created);
    await expect(customerServices.list(context(tenantB), {})).resolves.toEqual([]);
  });
});

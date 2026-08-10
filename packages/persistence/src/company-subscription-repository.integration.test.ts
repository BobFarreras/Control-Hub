import { randomUUID } from "node:crypto";
import { createDatabaseClient, withTenant, type DatabaseClient } from "@control-hub/database";
import type { TenantContext } from "@control-hub/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresCompanySubscriptionRepository } from "./company-subscription-repository.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const adminUrl = process.env.TEST_DATABASE_ADMIN_URL;
if (process.env.CI && !(databaseUrl && adminUrl))
  throw new Error("TEST_DATABASE_URL and TEST_DATABASE_ADMIN_URL are required in CI");
const suite = databaseUrl && adminUrl ? describe : describe.skip;

suite("PostgresCompanySubscriptionRepository", () => {
  let database: DatabaseClient;
  let admin: DatabaseClient;
  let repository: PostgresCompanySubscriptionRepository;
  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const userId = randomUUID();
  const membershipId = randomUUID();
  const context = (tenantId: string): TenantContext => ({
    tenantId,
    userId,
    membershipId,
    roles: ["owner"],
    permissions: ["subscriptions:manage"],
    mfaEnabled: true
  });

  beforeAll(async () => {
    database = createDatabaseClient(databaseUrl!);
    admin = createDatabaseClient(adminUrl!);
    repository = new PostgresCompanySubscriptionRepository(database);
    await admin`insert into "user" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt")
      values (${userId}, 'Subscription Owner', ${`${userId}@test.local`}, true, now(), now())`;
    await admin`insert into tenants (id, slug, name) values
      (${tenantA}, ${`company-sub-a-${tenantA}`}, 'Company Subscription A'),
      (${tenantB}, ${`company-sub-b-${tenantB}`}, 'Company Subscription B')`;
    await admin`insert into memberships (id, tenant_id, user_id) values (${membershipId}, ${tenantA}, ${userId})`;
  });

  afterAll(async () => {
    await admin`alter table company_subscription_events disable trigger company_subscription_events_append_only`;
    try {
      await admin`delete from company_subscription_events where tenant_id in (${tenantA}, ${tenantB})`;
      await admin`delete from company_subscriptions where tenant_id in (${tenantA}, ${tenantB})`;
    } finally {
      await admin`alter table company_subscription_events enable trigger company_subscription_events_append_only`;
    }
    await admin`delete from tenants where id in (${tenantA}, ${tenantB})`;
    await admin`delete from "user" where id = ${userId}`;
    await database.end({ timeout: 5 });
    await admin.end({ timeout: 5 });
  });

  it("persists operational fields, records history and isolates tenants", async () => {
    const created = await repository.create(context(tenantA), {
      provider: "OpenAI",
      serviceName: "API Platform",
      category: "api",
      status: "active",
      currency: "EUR",
      amountMinor: 2500,
      interval: "monthly",
      renewalAt: new Date(Date.now() + 3 * 86_400_000),
      renewalAlertDays: 7,
      autoRenew: true,
      websiteUrl: "https://platform.openai.com",
      notes: null,
      accountEmail: "admin@example.test",
      ownerMembershipId: membershipId,
      quantity: 2,
      costCenter: "OPS",
      paymentMethodLabel: "Visa ···· 4242",
      secretManagerUrl: "https://vault.example.test/items/openai"
    });
    expect(typeof created.amountMinor).toBe("number");

    expect(await repository.list(context(tenantA), { renewalState: "due_soon" })).toMatchObject([
      { id: created.id, ownerName: "Subscription Owner", quantity: 2, costCenter: "OPS" }
    ]);
    expect(await repository.list(context(tenantB))).toEqual([]);
    const edited = await repository.update(context(tenantA), {
      subscriptionId: created.id,
      expectedUpdatedAt: created.updatedAt,
      provider: created.provider,
      serviceName: "API Platform Business",
      category: created.category,
      currency: created.currency,
      amountMinor: created.amountMinor,
      interval: created.interval,
      renewalAt: created.renewalAt,
      renewalAlertDays: created.renewalAlertDays,
      autoRenew: created.autoRenew,
      websiteUrl: created.websiteUrl,
      notes: created.notes,
      accountEmail: created.accountEmail,
      ownerMembershipId: created.ownerMembershipId,
      quantity: created.quantity,
      startedAt: created.startedAt,
      trialEndsAt: created.trialEndsAt,
      cancelBeforeAt: created.cancelBeforeAt,
      costCenter: created.costCenter,
      paymentMethodLabel: created.paymentMethodLabel,
      secretManagerUrl: created.secretManagerUrl
    });
    expect(edited.serviceName).toBe("API Platform Business");
    await expect(
      repository.update(context(tenantA), {
        subscriptionId: created.id,
        expectedUpdatedAt: created.updatedAt,
        provider: created.provider,
        serviceName: "Stale edit",
        category: created.category,
        currency: created.currency,
        amountMinor: created.amountMinor,
        interval: created.interval,
        renewalAt: created.renewalAt,
        renewalAlertDays: created.renewalAlertDays,
        autoRenew: created.autoRenew,
        websiteUrl: created.websiteUrl,
        notes: created.notes
      })
    ).rejects.toMatchObject({ code: "COMPANY_SUBSCRIPTION_CONFLICT" });
    await expect(
      repository.transition(context(tenantA), {
        subscriptionId: created.id,
        action: "pause",
        effectiveAt: new Date(),
        expectedStatus: "active",
        targetStatus: "paused",
        eventType: "paused"
      })
    ).resolves.toMatchObject({ status: "paused" });
    await expect(
      repository.transition(context(tenantA), {
        subscriptionId: created.id,
        action: "pause",
        effectiveAt: new Date(),
        expectedStatus: "active",
        targetStatus: "paused",
        eventType: "paused"
      })
    ).rejects.toMatchObject({ code: "COMPANY_SUBSCRIPTION_CONFLICT" });
    await expect(
      repository.transition(context(tenantA), {
        subscriptionId: created.id,
        action: "resume",
        effectiveAt: new Date(),
        expectedStatus: "paused",
        targetStatus: "active",
        eventType: "resumed"
      })
    ).resolves.toMatchObject({ status: "active" });
    const events = await withTenant(
      database,
      tenantA,
      (tx) =>
        tx<
          { type: string }[]
        >`select type from company_subscription_events where company_subscription_id = ${created.id} order by effective_at, created_at`
    );
    expect(events.map((event) => event.type)).toEqual(["created", "updated", "paused", "resumed"]);
  });
});

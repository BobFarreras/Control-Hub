import { randomUUID } from "node:crypto";
import { createDatabaseClient, type DatabaseClient } from "@control-hub/database";
import type { TenantContext } from "@control-hub/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresSupportMailboxRepository } from "./support-mailbox-repository.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const adminUrl = process.env.TEST_DATABASE_ADMIN_URL;
if (process.env.CI && !(databaseUrl && adminUrl))
  throw new Error("TEST_DATABASE_URL and TEST_DATABASE_ADMIN_URL are required in CI");
const suite = databaseUrl && adminUrl ? describe : describe.skip;

suite("PostgresSupportMailboxRepository", () => {
  let database: DatabaseClient;
  let admin: DatabaseClient;
  let repository: PostgresSupportMailboxRepository;
  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const instanceA = randomUUID();
  const userId = randomUUID();
  const membershipA = randomUUID();
  const customerA = randomUUID();
  const context = (tenantId: string): TenantContext => ({
    tenantId,
    membershipId: tenantId === tenantA ? membershipA : randomUUID(),
    userId,
    roles: [],
    permissions: ["integrations:read"],
    mfaEnabled: true
  });
  const message = {
    externalId: "INBOX:42",
    threadKey: "thread-1",
    senderAddress: "client@example.test",
    senderName: "Client",
    subject: "Help",
    preview: "Body",
    receivedAt: new Date("2026-08-24T10:00:00Z")
  };

  beforeAll(async () => {
    database = createDatabaseClient(databaseUrl!);
    admin = createDatabaseClient(adminUrl!);
    repository = new PostgresSupportMailboxRepository(database);
    await admin`insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
      values (${userId}, 'Mailbox Test', ${`${userId}@test.local`}, true, now(), now())`;
    await admin`insert into tenants (id, slug, name) values
      (${tenantA}, ${`mail-a-${tenantA}`}, 'Mail A'), (${tenantB}, ${`mail-b-${tenantB}`}, 'Mail B')`;
    await admin`insert into connector_instances (id, tenant_id, connector_type, name)
      values (${instanceA}, ${tenantA}, 'imap', 'Support inbox')`;
    await admin`insert into memberships (id, tenant_id, user_id) values (${membershipA}, ${tenantA}, ${userId})`;
    await admin`insert into customers (id, tenant_id, display_name, normalized_name, normalized_billing_email)
      values (${customerA}, ${tenantA}, 'Mailbox Customer', ${`mailbox customer ${customerA}`}, 'client@example.test')`;
    await admin`insert into sla_targets (id, tenant_id, priority, first_response_minutes, resolution_minutes, effective_from)
      values (${randomUUID()}, ${tenantA}, 'normal', 60, 480, '2020-01-01T00:00:00Z')`;
  });

  afterAll(async () => {
    await admin`delete from support_inbound_messages where tenant_id in (${tenantA}, ${tenantB})`;
    await admin`delete from support_mailbox_channels where tenant_id in (${tenantA}, ${tenantB})`;
    await admin`set session_replication_role = 'replica'`;
    try {
      await admin`delete from ticket_messages where tenant_id in (${tenantA}, ${tenantB})`;
      await admin`delete from ticket_events where tenant_id in (${tenantA}, ${tenantB})`;
      await admin`delete from sla_targets where tenant_id in (${tenantA}, ${tenantB})`;
      await admin`delete from tickets where tenant_id in (${tenantA}, ${tenantB})`;
    } finally {
      await admin`set session_replication_role = 'origin'`;
    }
    await admin`delete from connector_instances where tenant_id in (${tenantA}, ${tenantB})`;
    await admin`delete from tenants where id in (${tenantA}, ${tenantB})`;
    await admin`delete from "user" where id = ${userId}`;
    await database.end({ timeout: 5 });
    await admin.end({ timeout: 5 });
  });

  it("deduplicates a mailbox message and isolates it from another tenant", async () => {
    expect(await repository.storePending(context(tenantA), { instanceId: instanceA, messages: [message] })).toEqual({
      inserted: 1
    });
    expect(await repository.storePending(context(tenantA), { instanceId: instanceA, messages: [message] })).toEqual({
      inserted: 0
    });
    const [visible] = await database.begin(async (tx) => {
      await tx`select set_config('app.tenant_id', ${tenantB}, true)`;
      return tx<{ count: string }[]>`select count(*)::text as count from support_inbound_messages`;
    });
    expect(visible?.count).toBe("0");
  });

  it("rejects an instance owned by another tenant", async () => {
    await expect(
      repository.storePending(context(tenantB), { instanceId: instanceA, messages: [message] })
    ).rejects.toThrow();
  });

  it("suggests a customer and classifies a pending message into a new ticket atomically", async () => {
    const page = await repository.list(context(tenantA), { status: "pending", page: 1, pageSize: 25 });
    const pending = page.items.find((item) => item.senderAddress === message.senderAddress);
    expect(pending).toMatchObject({ suggestedCustomerId: customerA, suggestedCustomerName: "Mailbox Customer" });
    const targets = await repository.currentTargets(context(tenantA), "normal", new Date());
    const result = await repository.classifyNew(context(tenantA), {
      messageId: pending!.id,
      customerId: customerA,
      priority: "normal",
      targets: targets!,
      at: new Date("2026-08-25T10:00:00Z")
    });
    expect(result.ticketNumber).toBeGreaterThan(0);
    await expect(
      repository.classifyNew(context(tenantA), {
        messageId: pending!.id,
        customerId: customerA,
        priority: "normal",
        targets: targets!,
        at: new Date()
      })
    ).rejects.toMatchObject({ code: "INBOUND_MESSAGE_NOT_PENDING" });
    const classified = await repository.list(context(tenantA), { status: "classified", page: 1, pageSize: 25 });
    expect(classified.items).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: pending!.id, ticketId: result.ticketId })])
    );
  });

  it("discards a selected batch in one tenant-scoped transaction", async () => {
    const messages = ["bulk-1", "bulk-2"].map((externalId) => ({ ...message, externalId, threadKey: externalId }));
    await repository.storePending(context(tenantA), { instanceId: instanceA, messages });
    const page = await repository.list(context(tenantA), { status: "pending", page: 1, pageSize: 25 });
    const ids = page.items.filter((item) => item.subject === message.subject).map((item) => item.id);
    expect(ids).toHaveLength(2);
    await expect(repository.discardMany(context(tenantA), { messageIds: ids, at: new Date() })).resolves.toBe(2);
    const discarded = await repository.list(context(tenantA), { status: "discarded", page: 1, pageSize: 25 });
    expect(discarded.items.map((item) => item.id)).toEqual(expect.arrayContaining(ids));
  });
});

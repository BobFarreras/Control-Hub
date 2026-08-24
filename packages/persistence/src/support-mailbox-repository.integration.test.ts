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
  const context = (tenantId: string): TenantContext => ({
    tenantId,
    membershipId: "system",
    userId: "system",
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
    await admin`insert into tenants (id, slug, name) values
      (${tenantA}, ${`mail-a-${tenantA}`}, 'Mail A'), (${tenantB}, ${`mail-b-${tenantB}`}, 'Mail B')`;
    await admin`insert into connector_instances (id, tenant_id, connector_type, name)
      values (${instanceA}, ${tenantA}, 'imap', 'Support inbox')`;
  });

  afterAll(async () => {
    await admin`delete from support_inbound_messages where tenant_id in (${tenantA}, ${tenantB})`;
    await admin`delete from support_mailbox_channels where tenant_id in (${tenantA}, ${tenantB})`;
    await admin`delete from connector_instances where tenant_id in (${tenantA}, ${tenantB})`;
    await admin`delete from tenants where id in (${tenantA}, ${tenantB})`;
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
});

import { randomUUID } from "node:crypto";
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabaseClient, withTenant, type DatabaseClient } from "./index.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const adminDatabaseUrl = process.env.TEST_DATABASE_ADMIN_URL;
// Skipping locally is a convenience; skipping in CI would mean these guarantees ship unproven.
if (process.env.CI && !(databaseUrl && adminDatabaseUrl))
  throw new Error("TEST_DATABASE_URL and TEST_DATABASE_ADMIN_URL are required in CI");
const suite = databaseUrl && adminDatabaseUrl ? describe : describe.skip;

suite("support schema", () => {
  let database: DatabaseClient;
  let admin: DatabaseClient;
  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const customerA = randomUUID();
  const customerB = randomUUID();

  const ticket = (id: string, tenantId: string, customerId: string, ticketNumber: number) => ({
    id,
    tenant_id: tenantId,
    customer_id: customerId,
    ticket_number: ticketNumber
  });

  const insertTicket = (tx: postgres.TransactionSql, values: ReturnType<typeof ticket>) =>
    tx`insert into tickets (id, tenant_id, ticket_number, customer_id, subject, description,
        first_response_target_minutes, resolution_target_minutes)
      values (${values.id}, ${values.tenant_id}, ${values.ticket_number}, ${values.customer_id},
        'Assumpte de prova', 'Descripcio de prova', 60, 480)`;

  beforeAll(async () => {
    database = createDatabaseClient(databaseUrl!);
    admin = createDatabaseClient(adminDatabaseUrl!);
    await admin`insert into tenants (id, slug, name) values
      (${tenantA}, ${`support-a-${tenantA}`}, 'Support A'), (${tenantB}, ${`support-b-${tenantB}`}, 'Support B')`;
    await admin`insert into customers (id, tenant_id, display_name, normalized_name) values
      (${customerA}, ${tenantA}, 'Client A', ${`client a ${customerA}`}),
      (${customerB}, ${tenantB}, 'Client B', ${`client b ${customerB}`})`;
  });

  afterAll(async () => {
    await admin`set session_replication_role = 'replica'`;
    try {
      await admin`delete from ticket_messages where tenant_id in (${tenantA}, ${tenantB})`;
      await admin`delete from ticket_events where tenant_id in (${tenantA}, ${tenantB})`;
      await admin`delete from sla_targets where tenant_id in (${tenantA}, ${tenantB})`;
      await admin`delete from tickets where tenant_id in (${tenantA}, ${tenantB})`;
      await admin`delete from customers where tenant_id in (${tenantA}, ${tenantB})`;
    } finally {
      await admin`set session_replication_role = 'origin'`;
    }
    await admin`delete from tenants where id in (${tenantA}, ${tenantB})`;
    await database.end({ timeout: 5 });
    await admin.end({ timeout: 5 });
  });

  it("keeps one tenant's tickets out of another's reach", async () => {
    const own = randomUUID();
    await withTenant(database, tenantA, (tx) => insertTicket(tx, ticket(own, tenantA, customerA, 1)));
    const seenByB = await withTenant(database, tenantB, (tx) => tx`select id from tickets where id = ${own}`);
    expect(seenByB).toHaveLength(0);
  });

  it("refuses a ticket pointing at another tenant's customer", async () => {
    await expect(
      withTenant(database, tenantA, (tx) => insertTicket(tx, ticket(randomUUID(), tenantA, customerB, 2)))
    ).rejects.toThrow();
  });

  it("refuses a second ticket with the same number in one tenant", async () => {
    await withTenant(database, tenantA, (tx) => insertTicket(tx, ticket(randomUUID(), tenantA, customerA, 10)));
    await expect(
      withTenant(database, tenantA, (tx) => insertTicket(tx, ticket(randomUUID(), tenantA, customerA, 10)))
    ).rejects.toThrow();
  });

  it("deduplicates an inbound message by its external reference", async () => {
    const ticketId = randomUUID();
    const reference = `mail-${randomUUID()}`;
    await withTenant(database, tenantA, (tx) => insertTicket(tx, ticket(ticketId, tenantA, customerA, 20)));
    const insertMessage = (tx: postgres.TransactionSql) =>
      tx`insert into ticket_messages (id, tenant_id, ticket_id, body, visibility, external_reference)
         values (${randomUUID()}, ${tenantA}, ${ticketId}, 'Hola', 'customer', ${reference})`;
    await withTenant(database, tenantA, (tx) => insertMessage(tx));
    await expect(withTenant(database, tenantA, (tx) => insertMessage(tx))).rejects.toThrow();
  });

  it("will not let a message or an SLA target be rewritten", async () => {
    const ticketId = randomUUID();
    const messageId = randomUUID();
    await withTenant(database, tenantA, async (tx) => {
      await insertTicket(tx, ticket(ticketId, tenantA, customerA, 30));
      await tx`insert into ticket_messages (id, tenant_id, ticket_id, body, visibility)
               values (${messageId}, ${tenantA}, ${ticketId}, 'Nota interna', 'internal')`;
    });
    await expect(
      withTenant(
        database,
        tenantA,
        (tx) => tx`update ticket_messages set visibility = 'customer' where id = ${messageId}`
      )
    ).rejects.toThrow();

    const targetId = randomUUID();
    await withTenant(
      database,
      tenantA,
      (tx) => tx`insert into sla_targets (id, tenant_id, priority, first_response_minutes, resolution_minutes)
                 values (${targetId}, ${tenantA}, 'high', 60, 480)`
    );
    await expect(
      withTenant(database, tenantA, (tx) => tx`delete from sla_targets where id = ${targetId}`)
    ).rejects.toThrow();
  });

  it("refuses a support window that closes before it opens", async () => {
    await expect(
      withTenant(
        database,
        tenantA,
        (tx) => tx`insert into support_schedule (id, tenant_id, weekday, opens_at, closes_at)
                   values (${randomUUID()}, ${tenantA}, 1, '16:00', '08:00')`
      )
    ).rejects.toThrow();
  });

  it("accepts several windows on one weekday so a split shift is representable", async () => {
    await withTenant(
      database,
      tenantA,
      (tx) => tx`insert into support_schedule (id, tenant_id, weekday, opens_at, closes_at) values
                 (${randomUUID()}, ${tenantA}, 2, '09:00', '13:00'),
                 (${randomUUID()}, ${tenantA}, 2, '15:00', '18:00')`
    );
    const windows = await withTenant(
      database,
      tenantA,
      (tx) => tx`select opens_at from support_schedule where weekday = 2 order by opens_at`
    );
    expect(windows).toHaveLength(2);
  });

  it("refuses an acknowledgement without the person who made it", async () => {
    await expect(
      withTenant(
        database,
        tenantA,
        (tx) => tx`insert into incidents (id, tenant_id, title, severity, acknowledged_at)
                   values (${randomUUID()}, ${tenantA}, 'Caiguda', 'critical', now())`
      )
    ).rejects.toThrow();
  });
});

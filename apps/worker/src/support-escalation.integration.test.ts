import { randomUUID } from "node:crypto";
import { SupportService } from "@control-hub/application";
import { createDatabaseClient, withTenant, type DatabaseClient } from "@control-hub/database";
import type { TenantContext } from "@control-hub/domain";
import { PostgresSupportRepository } from "@control-hub/persistence";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sweepSupportEscalations } from "./support-escalation.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const adminUrl = process.env.TEST_DATABASE_ADMIN_URL;
// Skipping locally is a convenience; skipping in CI would mean escalation ships unproven.
if (process.env.CI && !(databaseUrl && adminUrl))
  throw new Error("TEST_DATABASE_URL and TEST_DATABASE_ADMIN_URL are required in CI");
const suite = databaseUrl && adminUrl ? describe : describe.skip;

suite("support escalation sweep", () => {
  let database: DatabaseClient;
  let admin: DatabaseClient;
  let service: SupportService;

  const tenantId = randomUUID();
  const userId = randomUUID();
  const membershipId = randomUUID();
  const customerId = randomUUID();
  const context: TenantContext = {
    tenantId,
    membershipId,
    userId,
    roles: ["administrator"],
    permissions: ["tickets:manage"],
    mfaEnabled: true
  };

  beforeAll(async () => {
    database = createDatabaseClient(databaseUrl!);
    admin = createDatabaseClient(adminUrl!);
    service = new SupportService(new PostgresSupportRepository(database));

    await admin`insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
      values (${userId}, 'Escalation', ${`${userId}@test.local`}, true, now(), now())`;
    await admin`insert into tenants (id, slug, name) values (${tenantId}, ${`esc-${tenantId}`}, 'Escalation')`;
    await admin`insert into tenant_settings (tenant_id, brand_name, timezone)
      values (${tenantId}, 'Escalation', 'Europe/Madrid')`;
    await admin`insert into memberships (id, tenant_id, user_id) values (${membershipId}, ${tenantId}, ${userId})`;
    await admin`insert into customers (id, tenant_id, display_name, normalized_name)
      values (${customerId}, ${tenantId}, 'Client', ${`client ${customerId}`})`;
    for (const weekday of [1, 2, 3, 4, 5]) {
      await admin`insert into support_schedule (id, tenant_id, weekday, opens_at, closes_at)
        values (${randomUUID()}, ${tenantId}, ${weekday}, '08:00', '16:00')`;
    }
    await admin`insert into sla_targets (id, tenant_id, priority, first_response_minutes, resolution_minutes, effective_from)
      values (${randomUUID()}, ${tenantId}, 'normal', 60, 480, '2020-01-01T00:00:00Z')`;
  });

  afterAll(async () => {
    await admin`set session_replication_role = 'replica'`;
    try {
      await admin`delete from ticket_events where tenant_id = ${tenantId}`;
      await admin`delete from ticket_messages where tenant_id = ${tenantId}`;
      await admin`delete from sla_targets where tenant_id = ${tenantId}`;
      await admin`delete from tickets where tenant_id = ${tenantId}`;
    } finally {
      await admin`set session_replication_role = 'origin'`;
    }
    await admin`delete from tenants where id = ${tenantId}`;
    await admin`delete from "user" where id = ${userId}`;
    await database.end({ timeout: 5 });
    await admin.end({ timeout: 5 });
  });

  const breachEvents = (ticketId: string) =>
    withTenant(
      database,
      tenantId,
      (tx) => tx<{ to_value: string }[]>`
        select to_value from ticket_events
        where tenant_id = ${tenantId} and ticket_id = ${ticketId} and type = 'sla_breached'`
    );

  it("records a breach once however often the sweep runs", async () => {
    const ticket = await service.createTicket(context, {
      customerId,
      subject: "Sense resposta",
      description: "Descripcio",
      priority: "normal"
    });
    // Opened Tuesday 09:00 Madrid; the sweep measures it two working hours later.
    await admin`update tickets set opened_at = '2026-08-04T07:00:00Z' where id = ${ticket.id}`;
    const measuredAt = new Date("2026-08-04T09:00:00Z");

    /**
     * Read through this tenant's own events rather than the sweep's counters. The pass walks
     * every tenant, so `recorded` also counts whatever the other support suites left in the
     * shared test database, and asserting on it made the result depend on which suite happened
     * to run first. This is the same thing the two tests below already do.
     */
    const first = await sweepSupportEscalations(database, measuredAt);
    expect(first.failed.map((entry) => entry.tenantId)).not.toContain(tenantId);
    expect(await breachEvents(ticket.id)).toEqual([{ to_value: "first_response" }]);

    const second = await sweepSupportEscalations(database, measuredAt);
    expect(second.failed.map((entry) => entry.tenantId)).not.toContain(tenantId);
    // The pass runs every few minutes; recording again would fill the history with one breach
    // per run and make it unreadable.
    expect(await breachEvents(ticket.id)).toEqual([{ to_value: "first_response" }]);
  });

  it("leaves a ticket that is still inside its target alone", async () => {
    const ticket = await service.createTicket(context, {
      customerId,
      subject: "Encara a temps",
      description: "Descripcio",
      priority: "normal"
    });
    await admin`update tickets set opened_at = '2026-08-04T07:00:00Z' where id = ${ticket.id}`;

    await sweepSupportEscalations(database, new Date("2026-08-04T07:30:00Z"));
    expect(await breachEvents(ticket.id)).toEqual([]);
  });

  it("does not escalate a ticket that has been resolved", async () => {
    const ticket = await service.createTicket(context, {
      customerId,
      subject: "Ja resolt",
      description: "Descripcio",
      priority: "normal"
    });
    await admin`update tickets set opened_at = '2026-08-04T07:00:00Z' where id = ${ticket.id}`;
    await service.transition(context, ticket.id, "resolved");

    await sweepSupportEscalations(database, new Date("2026-08-05T14:00:00Z"));
    expect(await breachEvents(ticket.id)).toEqual([]);
  });
});

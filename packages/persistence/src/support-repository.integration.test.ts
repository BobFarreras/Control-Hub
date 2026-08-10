import { randomUUID } from "node:crypto";
import { SupportService } from "@control-hub/application";
import { createDatabaseClient, type DatabaseClient } from "@control-hub/database";
import type { TenantContext } from "@control-hub/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresSupportRepository } from "./support-repository.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const adminUrl = process.env.TEST_DATABASE_ADMIN_URL;
// Skipping locally is a convenience; skipping in CI would mean these guarantees ship unproven.
if (process.env.CI && !(databaseUrl && adminUrl))
  throw new Error("TEST_DATABASE_URL and TEST_DATABASE_ADMIN_URL are required in CI");
const suite = databaseUrl && adminUrl ? describe : describe.skip;

suite("PostgresSupportRepository", () => {
  let database: DatabaseClient;
  let admin: DatabaseClient;
  let service: SupportService;
  let repository: PostgresSupportRepository;

  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const userId = randomUUID();
  const membershipA = randomUUID();
  const customerA = randomUUID();

  const context = (tenantId: string, membershipId: string): TenantContext => ({
    tenantId,
    membershipId,
    userId,
    roles: ["administrator"],
    permissions: ["tickets:manage"],
    mfaEnabled: true
  });

  beforeAll(async () => {
    database = createDatabaseClient(databaseUrl!);
    admin = createDatabaseClient(adminUrl!);
    repository = new PostgresSupportRepository(database);
    service = new SupportService(repository);

    await admin`insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
      values (${userId}, 'Support Test', ${`${userId}@test.local`}, true, now(), now())`;
    await admin`insert into tenants (id, slug, name) values
      (${tenantA}, ${`sup-a-${tenantA}`}, 'Sup A'), (${tenantB}, ${`sup-b-${tenantB}`}, 'Sup B')`;
    await admin`insert into tenant_settings (tenant_id, brand_name, timezone)
      values (${tenantA}, 'Sup A', 'Europe/Madrid')`;
    await admin`insert into memberships (id, tenant_id, user_id) values (${membershipA}, ${tenantA}, ${userId})`;
    await admin`insert into customers (id, tenant_id, display_name, normalized_name)
      values (${customerA}, ${tenantA}, 'Client A', ${`client a ${customerA}`})`;

    // Monday to Friday, 08:00 to 16:00, plus a first response target of one hour.
    for (const weekday of [1, 2, 3, 4, 5]) {
      await admin`insert into support_schedule (id, tenant_id, weekday, opens_at, closes_at)
        values (${randomUUID()}, ${tenantA}, ${weekday}, '08:00', '16:00')`;
    }
    await admin`insert into support_holidays (id, tenant_id, holiday_on)
      values (${randomUUID()}, ${tenantA}, '2026-08-05')`;
    await admin`insert into sla_targets (id, tenant_id, priority, first_response_minutes, resolution_minutes, effective_from)
      values (${randomUUID()}, ${tenantA}, 'normal', 60, 480, '2020-01-01T00:00:00Z')`;
  });

  afterAll(async () => {
    for (const table of ["ticket_messages", "ticket_events", "sla_targets"]) {
      await admin.unsafe(`alter table ${table} disable trigger ${table}_append_only`);
    }
    try {
      await admin`delete from ticket_messages where tenant_id in (${tenantA}, ${tenantB})`;
      await admin`delete from ticket_events where tenant_id in (${tenantA}, ${tenantB})`;
      await admin`delete from sla_targets where tenant_id in (${tenantA}, ${tenantB})`;
      await admin`delete from tickets where tenant_id in (${tenantA}, ${tenantB})`;
    } finally {
      for (const table of ["ticket_messages", "ticket_events", "sla_targets"]) {
        await admin.unsafe(`alter table ${table} enable trigger ${table}_append_only`);
      }
    }
    await admin`delete from tenants where id in (${tenantA}, ${tenantB})`;
    await admin`delete from "user" where id = ${userId}`;
    await database.end({ timeout: 5 });
    await admin.end({ timeout: 5 });
  });

  const open = (subject: string) =>
    service.createTicket(context(tenantA, membershipA), {
      customerId: customerA,
      subject,
      description: "Descripcio",
      priority: "normal"
    });

  it("opens a ticket with the targets in force and a number of its own", async () => {
    const first = await open("Primer");
    const second = await open("Segon");

    expect(first.firstResponseTargetMinutes).toBe(60);
    expect(first.resolutionTargetMinutes).toBe(480);
    expect(second.ticketNumber).toBe(first.ticketNumber + 1);
    expect(first.status).toBe("new");
  });

  it("reads back the calendar the tenant configured, holidays included", async () => {
    const calendar = await repository.loadCalendar(context(tenantA, membershipA));
    expect(calendar.timeZone).toBe("Europe/Madrid");
    expect(calendar.windows).toHaveLength(5);
    expect(calendar.windows[0]).toMatchObject({ weekday: 1, opensAt: "08:00", closesAt: "16:00" });
    expect(calendar.holidays).toContain("2026-08-05");
  });

  it("derives the pause intervals from the event log", async () => {
    const ticket = await open("Amb espera");
    const ctx = context(tenantA, membershipA);
    await service.transition(ctx, ticket.id, "open");
    await service.transition(ctx, ticket.id, "waiting_customer");
    await service.transition(ctx, ticket.id, "open");

    const pauses = await repository.listPauses(ctx, ticket.id);
    expect(pauses).toHaveLength(1);
    expect(pauses[0]!.to).not.toBeNull();
  });

  it("leaves a pause open while the ticket is still waiting", async () => {
    const ticket = await open("Encara espera");
    const ctx = context(tenantA, membershipA);
    await service.transition(ctx, ticket.id, "waiting_third_party");

    const pauses = await repository.listPauses(ctx, ticket.id);
    expect(pauses).toHaveLength(1);
    expect(pauses[0]!.to).toBeNull();
  });

  it("records the first response once and never moves it", async () => {
    const ticket = await open("Resposta");
    const ctx = context(tenantA, membershipA);
    await service.addMessage(ctx, ticket.id, { body: "Ho mirem", visibility: "customer" });
    const afterFirst = await repository.getTicket(ctx, ticket.id);

    await service.addMessage(ctx, ticket.id, { body: "Ja esta", visibility: "customer" });
    const afterSecond = await repository.getTicket(ctx, ticket.id);

    expect(afterFirst!.firstResponseAt).not.toBeNull();
    expect(afterSecond!.firstResponseAt?.getTime()).toBe(afterFirst!.firstResponseAt?.getTime());
  });

  it("does not start the clock on an internal note", async () => {
    const ticket = await open("Nota interna");
    const ctx = context(tenantA, membershipA);
    await service.addMessage(ctx, ticket.id, { body: "Per a nosaltres", visibility: "internal" });
    expect((await repository.getTicket(ctx, ticket.id))!.firstResponseAt).toBeNull();
  });

  it("returns the stored message when an external reference repeats", async () => {
    const ticket = await open("Entrant");
    const ctx = context(tenantA, membershipA);
    const reference = `mail-${randomUUID()}`;
    const first = await service.addMessage(ctx, ticket.id, {
      body: "Original",
      visibility: "customer",
      externalReference: reference
    });
    const again = await service.addMessage(ctx, ticket.id, {
      body: "Repetit",
      visibility: "customer",
      externalReference: reference
    });
    expect(again.id).toBe(first.id);
  });

  it("measures the SLA against the tenant's own calendar", async () => {
    const ticket = await open("Mesura");
    const ctx = context(tenantA, membershipA);
    await admin`update tickets set opened_at = '2026-08-04T07:00:00Z' where id = ${ticket.id}`;

    const state = await service.slaFor(ctx, ticket.id, new Date("2026-08-04T09:00:00Z"));
    expect(state.firstResponse.consumedMinutes).toBe(120);
    expect(state.firstResponse.breached).toBe(true);
    expect(state.resolution.breached).toBe(false);
  });

  it("keeps one tenant's tickets invisible to another", async () => {
    const ticket = await open("Privat");
    expect(await repository.getTicket(context(tenantB, membershipA), ticket.id)).toBeNull();
  });

  it("refuses a ticket for a customer that is not the tenant's", async () => {
    await expect(
      service.createTicket(context(tenantA, membershipA), {
        customerId: randomUUID(),
        subject: "Client desconegut",
        description: "Descripcio",
        priority: "normal"
      })
    ).rejects.toMatchObject({ code: "CUSTOMER_NOT_FOUND" });
  });

  it("replaces the whole weekly schedule at once", async () => {
    const ctx = context(tenantA, membershipA);
    await repository.replaceSchedule(ctx, [
      { weekday: 6, opensAt: "10:00", closesAt: "14:00" },
      { weekday: 6, opensAt: "16:00", closesAt: "19:00" }
    ]);
    const calendar = await repository.loadCalendar(ctx);
    expect(calendar.windows).toHaveLength(2);
    expect(calendar.windows.every((window) => window.weekday === 6)).toBe(true);
  });

  it("publishes a target without touching the one before it", async () => {
    const ctx = context(tenantA, membershipA);
    const before = await repository.listSlaTargets(ctx);
    await repository.publishSlaTarget(ctx, {
      priority: "normal",
      firstResponseMinutes: 30,
      resolutionMinutes: 240,
      effectiveFrom: new Date("2026-09-01T00:00:00Z")
    });
    const after = await repository.listSlaTargets(ctx);
    expect(after).toHaveLength(before.length + 1);
    // The earlier row is still there: a ticket opened under it stays explicable.
    expect(after.filter((target) => target.priority === "normal").length).toBeGreaterThan(1);
  });

  it("adds and removes a holiday", async () => {
    const ctx = context(tenantA, membershipA);
    const holiday = await repository.addHoliday(ctx, "2026-12-25", "Nadal");
    expect((await repository.listHolidays(ctx)).some((item) => item.id === holiday.id)).toBe(true);
    await repository.removeHoliday(ctx, holiday.id);
    expect((await repository.listHolidays(ctx)).some((item) => item.id === holiday.id)).toBe(false);
  });

  it("refuses a second holiday on the same date", async () => {
    const ctx = context(tenantA, membershipA);
    await repository.addHoliday(ctx, "2026-11-01", null);
    await expect(repository.addHoliday(ctx, "2026-11-01", null)).rejects.toMatchObject({ code: "DUPLICATE_ENTRY" });
  });
});

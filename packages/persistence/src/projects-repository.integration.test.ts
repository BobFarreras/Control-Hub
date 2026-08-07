import { randomUUID } from "node:crypto";
import { ProjectsService } from "@control-hub/application";
import { createDatabaseClient, type DatabaseClient } from "@control-hub/database";
import type { Permission, TenantContext } from "@control-hub/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresProjectsRepository } from "./projects-repository.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const adminUrl = process.env.TEST_DATABASE_ADMIN_URL;
// Skipping locally is a convenience; skipping in CI would mean these guarantees ship unproven.
if (process.env.CI && !(databaseUrl && adminUrl))
  throw new Error("TEST_DATABASE_URL and TEST_DATABASE_ADMIN_URL are required in CI");
const suite = databaseUrl && adminUrl ? describe : describe.skip;

suite("PostgresProjectsRepository", () => {
  let database: DatabaseClient;
  let admin: DatabaseClient;
  let service: ProjectsService;
  let repository: PostgresProjectsRepository;

  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const userA = randomUUID();
  const userB = randomUUID();
  const membershipA = randomUUID();
  const membershipB = randomUUID();
  const membershipOther = randomUUID();
  const customerA = randomUUID();
  const customerOther = randomUUID();

  const permissions: Permission[] = ["projects:read", "projects:manage", "time:log", "time:manage", "financials:read"];

  const context = (tenantId: string, membershipId: string, granted = permissions): TenantContext => ({
    tenantId,
    membershipId,
    userId: membershipId === membershipB ? userB : userA,
    roles: ["administrator"],
    permissions: granted,
    mfaEnabled: true
  });

  const ctx = () => context(tenantA, membershipA);

  beforeAll(async () => {
    database = createDatabaseClient(databaseUrl!);
    admin = createDatabaseClient(adminUrl!);
    repository = new PostgresProjectsRepository(database);
    service = new ProjectsService(repository);

    await admin`insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt") values
      (${userA}, 'Projects Test A', ${`${userA}@test.local`}, true, now(), now()),
      (${userB}, 'Projects Test B', ${`${userB}@test.local`}, true, now(), now())`;
    await admin`insert into tenants (id, slug, name) values
      (${tenantA}, ${`prj-a-${tenantA}`}, 'Prj A'), (${tenantB}, ${`prj-b-${tenantB}`}, 'Prj B')`;
    await admin`insert into tenant_settings (tenant_id, brand_name, timezone)
      values (${tenantA}, 'Prj A', 'Europe/Madrid')`;
    await admin`insert into memberships (id, tenant_id, user_id) values
      (${membershipA}, ${tenantA}, ${userA}), (${membershipB}, ${tenantA}, ${userB}),
      (${membershipOther}, ${tenantB}, ${userA})`;
    await admin`insert into customers (id, tenant_id, display_name, normalized_name) values
      (${customerA}, ${tenantA}, 'Client A', ${`client a ${customerA}`}),
      (${customerOther}, ${tenantA}, 'Client B', ${`client b ${customerOther}`})`;
    await admin`insert into sla_targets (id, tenant_id, priority, first_response_minutes, resolution_minutes, effective_from)
      values (${randomUUID()}, ${tenantA}, 'normal', 60, 480, '2020-01-01T00:00:00Z')`;
  });

  afterAll(async () => {
    // `sla_targets` is append-only too, and the tenant delete below cascades into it, so its
    // trigger has to come down as well or the whole teardown fails on somebody else's table.
    const appendOnly = ["project_events", "member_cost_rates", "billing_rates", "sla_targets"];
    for (const table of appendOnly) await admin.unsafe(`alter table ${table} disable trigger ${table}_append_only`);
    try {
      await admin`delete from time_entries where tenant_id in (${tenantA}, ${tenantB})`;
      await admin`delete from project_events where tenant_id in (${tenantA}, ${tenantB})`;
      await admin`delete from billing_rates where tenant_id in (${tenantA}, ${tenantB})`;
      await admin`delete from member_cost_rates where tenant_id in (${tenantA}, ${tenantB})`;
      await admin`delete from tickets where tenant_id in (${tenantA}, ${tenantB})`;
      await admin`delete from projects where tenant_id in (${tenantA}, ${tenantB})`;
      await admin`delete from service_types where tenant_id in (${tenantA}, ${tenantB})`;
      await admin`delete from sla_targets where tenant_id in (${tenantA}, ${tenantB})`;
    } finally {
      for (const table of appendOnly) await admin.unsafe(`alter table ${table} enable trigger ${table}_append_only`);
    }
    await admin`delete from tenants where id in (${tenantA}, ${tenantB})`;
    await admin`delete from "user" where id in (${userA}, ${userB})`;
    await database.end({ timeout: 5 });
    await admin.end({ timeout: 5 });
  });

  let sequence = 0;
  const open = (overrides: { customerId?: string; name?: string; serviceTypeId?: string } = {}) =>
    service.createProject(ctx(), {
      customerId: overrides.customerId ?? customerA,
      code: `prj-${(sequence += 1)}-${randomUUID().slice(0, 8)}`,
      name: overrides.name ?? "Projecte de prova",
      ...(overrides.serviceTypeId ? { serviceTypeId: overrides.serviceTypeId } : {})
    });

  // A name of its own per call, because two kinds of work cannot share one: the name is unique
  // within the tenant on purpose, and a helper that reused it would be testing the wrong thing.
  const openServiceType = () => {
    const suffix = `${(sequence += 1)}-${randomUUID().slice(0, 8)}`;
    return service.createServiceType(ctx(), { code: `svc-${suffix}`, name: `Pagina web ${suffix}` });
  };

  const openTicket = async (customerId: string, projectId: string | null) => {
    const id = randomUUID();
    await admin`insert into tickets (id, tenant_id, ticket_number, customer_id, project_id, subject, description,
        first_response_target_minutes, resolution_target_minutes)
      values (${id}, ${tenantA}, ${(sequence += 1)}, ${customerId}, ${projectId}, 'Assumpte', 'Descripcio', 60, 480)`;
    return id;
  };

  it("opens a project on a customer of the tenant and writes its first event", async () => {
    const project = await open();
    expect(project.status).toBe("draft");

    const detail = await repository.getProjectDetail(ctx(), project.id);
    expect(detail!.project.customerName).toBe("Client A");
    expect(detail!.events).toHaveLength(1);
    expect(detail!.events[0]).toMatchObject({ type: "created", toValue: "draft" });
  });

  it("refuses a project for a customer that is not the tenant's", async () => {
    await expect(open({ customerId: randomUUID() })).rejects.toMatchObject({ code: "CUSTOMER_NOT_FOUND" });
  });

  it("refuses a second project with the same code", async () => {
    const code = `dup-${randomUUID().slice(0, 8)}`;
    await service.createProject(ctx(), { customerId: customerA, code, name: "Primer" });
    await expect(service.createProject(ctx(), { customerId: customerA, code, name: "Segon" })).rejects.toMatchObject({
      code: "DUPLICATE_CODE"
    });
  });

  it("keeps one tenant's projects invisible to another", async () => {
    const project = await open();
    expect(await repository.getProject(context(tenantB, membershipOther), project.id)).toBeNull();
  });

  it("records every status change in the append-only history", async () => {
    const project = await open();
    await service.changeStatus(ctx(), project.id, "active");
    const delivered = await service.changeStatus(ctx(), project.id, "delivered", "Entregat al client");

    expect(delivered.startedAt).not.toBeNull();
    const detail = await repository.getProjectDetail(ctx(), project.id);
    expect(detail!.events.map((event) => event.toValue)).toEqual(["delivered", "active", "draft"]);
    expect(detail!.events[0]!.reason).toBe("Entregat al client");
  });

  it("refuses to rewrite the history of a project", async () => {
    const project = await open();
    await expect(
      admin`update project_events set to_value = 'closed' where tenant_id = ${tenantA} and project_id = ${project.id}`
    ).rejects.toThrow(/append-only/);
  });

  describe("time entries", () => {
    it("logs against a project and reads back the day as it was typed", async () => {
      const project = await open();
      const entry = await service.logTime(ctx(), { projectId: project.id, duration: "1h 30m", spentOn: "2026-07-15" });
      expect(entry).toMatchObject({ minutes: 90, spentOn: "2026-07-15", billable: true });
    });

    it("refuses an entry against both a project and a ticket at the database", async () => {
      const project = await open();
      const ticket = await openTicket(customerA, null);
      await expect(
        admin`insert into time_entries (id, tenant_id, membership_id, project_id, ticket_id, spent_on, minutes)
          values (${randomUUID()}, ${tenantA}, ${membershipA}, ${project.id}, ${ticket}, '2026-07-15', 60)`
      ).rejects.toMatchObject({ code: "23514" });
    });

    it("refuses an entry against neither at the database", async () => {
      await expect(
        admin`insert into time_entries (id, tenant_id, membership_id, spent_on, minutes)
          values (${randomUUID()}, ${tenantA}, ${membershipA}, '2026-07-15', 60)`
      ).rejects.toMatchObject({ code: "23514" });
    });

    it("refuses hours on a closed project even when the service is bypassed", async () => {
      const project = await open();
      await service.changeStatus(ctx(), project.id, "active");
      await service.changeStatus(ctx(), project.id, "closed");

      await expect(service.logTime(ctx(), { projectId: project.id, duration: "60" })).rejects.toMatchObject({
        code: "PROJECT_CLOSED"
      });
      // Straight at the table, with the service out of the way: the trigger is the guarantee.
      await expect(
        admin`insert into time_entries (id, tenant_id, membership_id, project_id, spent_on, minutes)
          values (${randomUUID()}, ${tenantA}, ${membershipA}, ${project.id}, '2026-07-15', 60)`
      ).rejects.toMatchObject({ code: "CH001" });
    });

    it("does not duplicate hours when a client reference repeats", async () => {
      const project = await open();
      const reference = `retry-${randomUUID()}`;
      const first = await service.logTime(ctx(), { projectId: project.id, duration: "60", clientReference: reference });
      const again = await service.logTime(ctx(), { projectId: project.id, duration: "60", clientReference: reference });
      expect(again.id).toBe(first.id);
    });

    it("keeps one tenant's hours invisible to another", async () => {
      const project = await open();
      const entry = await service.logTime(ctx(), { projectId: project.id, duration: "60" });
      expect(await repository.getTimeEntry(context(tenantB, membershipOther), entry.id)).toBeNull();
    });

    it("refuses to let time:log delete an entry of another person", async () => {
      const project = await open();
      const entry = await service.logTime(ctx(), { projectId: project.id, duration: "60" });
      const colleague = context(tenantA, membershipB, ["projects:read", "time:log"]);
      await expect(service.deleteTimeEntry(colleague, entry.id)).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
      expect(await repository.getTimeEntry(ctx(), entry.id)).not.toBeNull();
    });
  });

  describe("the project of a ticket", () => {
    it("accepts a project of the same customer", async () => {
      const project = await open();
      const ticket = await openTicket(customerA, project.id);
      expect(ticket).toBeTruthy();
    });

    it("refuses a project of a different customer of the same tenant", async () => {
      const project = await open({ customerId: customerOther });
      await expect(openTicket(customerA, project.id)).rejects.toMatchObject({
        code: "23503",
        constraint_name: "tickets_project_customer_fk"
      });
    });

    it("refuses a project of another tenant", async () => {
      const foreign = await service
        .createProject(context(tenantB, membershipOther), {
          customerId: customerA,
          code: `foreign-${randomUUID().slice(0, 8)}`,
          name: "Alie"
        })
        .catch(() => null);
      // The customer belongs to tenant A, so tenant B cannot even open the project. The
      // cross-tenant reference is refused one step earlier than the ticket.
      expect(foreign).toBeNull();
    });
  });

  describe("rates and profitability", () => {
    it("refuses to modify a published rate", async () => {
      const rate = await service.publishCostRate(ctx(), {
        membershipId: membershipA,
        currency: "EUR",
        costMinorPerHour: 2000,
        effectiveFrom: "2026-01-01"
      });
      await expect(admin`update member_cost_rates set cost_minor_per_hour = 1 where id = ${rate.id}`).rejects.toThrow(
        /append-only/
      );
      await expect(admin`delete from member_cost_rates where id = ${rate.id}`).rejects.toThrow(/append-only/);
    });

    it("refuses two rates for the same person, currency and day", async () => {
      await service.publishCostRate(ctx(), {
        membershipId: membershipB,
        currency: "EUR",
        costMinorPerHour: 2000,
        effectiveFrom: "2026-03-01"
      });
      await expect(
        service.publishCostRate(ctx(), {
          membershipId: membershipB,
          currency: "EUR",
          costMinorPerHour: 2500,
          effectiveFrom: "2026-03-01"
        })
      ).rejects.toMatchObject({ code: "DUPLICATE_RATE" });
    });

    it("values work with the rate of the day worked, and a new rate does not move it", async () => {
      const project = await open();
      await service.publishBillingRate(ctx(), {
        scope: "project",
        scopeId: project.id,
        currency: "EUR",
        amountMinorPerHour: 6000,
        effectiveFrom: "2026-01-01"
      });
      await service.logTime(ctx(), { projectId: project.id, duration: "60", spentOn: "2026-06-10" });

      const before = await service.projectProfitability(ctx(), project.id);
      expect(before.lines[0]).toMatchObject({ currency: "EUR", revenueMinor: 6000, costMinor: 2000 });

      await service.publishBillingRate(ctx(), {
        scope: "project",
        scopeId: project.id,
        currency: "EUR",
        amountMinorPerHour: 20000,
        effectiveFrom: "2026-08-01"
      });
      const after = await service.projectProfitability(ctx(), project.id);
      expect(after.lines[0]!.revenueMinor).toBe(before.lines[0]!.revenueMinor);
    });

    it("counts hours logged on a ticket of the project as the project's own", async () => {
      const project = await open();
      const ticket = await openTicket(customerA, project.id);
      await service.logTime(ctx(), { projectId: project.id, duration: "60", spentOn: "2026-06-10" });
      await service.logTime(ctx(), { ticketId: ticket, duration: "30", spentOn: "2026-06-10" });

      const report = await service.projectProfitability(ctx(), project.id);
      expect(report.minutes).toBe(90);
    });

    it("reports a missing rate instead of a margin of one hundred per cent", async () => {
      const project = await open();
      await service.logTime(ctx(), { projectId: project.id, duration: "60", spentOn: "2026-06-10" });
      const report = await service.projectProfitability(ctx(), project.id);
      expect(report.entriesWithoutBillingRate).toBe(1);
      expect(report.lines.every((line) => line.revenueMinor === 0)).toBe(true);
    });

    it("withdraws a rate published by mistake and stops it valuing anything", async () => {
      const project = await open();
      await service.logTime(ctx(), { projectId: project.id, duration: "60", spentOn: "2026-06-10" });
      const wrong = await service.publishBillingRate(ctx(), {
        scope: "project",
        scopeId: project.id,
        currency: "EUR",
        amountMinorPerHour: 900_000,
        effectiveFrom: "2026-01-01"
      });
      expect((await service.projectProfitability(ctx(), project.id)).lines[0]!.revenueMinor).toBe(900_000);

      const annulled = await service.annulBillingRate(ctx(), wrong.id);
      expect(annulled.annulledAt).toBeInstanceOf(Date);

      // The row survives, so the mistake stays auditable, and it no longer prices the hour.
      const report = await service.projectProfitability(ctx(), project.id);
      expect(report.entriesWithoutBillingRate).toBe(1);
      const rows = await service.listRates(ctx());
      expect(rows.billing.some((rate) => rate.id === wrong.id)).toBe(true);
    });

    it("refuses to withdraw the same rate twice", async () => {
      const project = await open();
      const rate = await service.publishBillingRate(ctx(), {
        scope: "project",
        scopeId: project.id,
        currency: "EUR",
        amountMinorPerHour: 5000,
        effectiveFrom: "2026-01-01"
      });
      await service.annulBillingRate(ctx(), rate.id);
      await expect(service.annulBillingRate(ctx(), rate.id)).rejects.toMatchObject({ code: "RATE_NOT_FOUND" });
    });

    it("lets a wrong amount be corrected the same day it was published", async () => {
      const project = await open();
      const day = "2026-04-02";
      const wrong = await service.publishBillingRate(ctx(), {
        scope: "project",
        scopeId: project.id,
        currency: "EUR",
        amountMinorPerHour: 9000,
        effectiveFrom: day
      });
      // Without the withdrawal this second publish is a duplicate: same project, currency and day.
      await expect(
        service.publishBillingRate(ctx(), {
          scope: "project",
          scopeId: project.id,
          currency: "EUR",
          amountMinorPerHour: 9500,
          effectiveFrom: day
        })
      ).rejects.toMatchObject({ code: "DUPLICATE_RATE" });

      await service.annulBillingRate(ctx(), wrong.id);
      const corrected = await service.publishBillingRate(ctx(), {
        scope: "project",
        scopeId: project.id,
        currency: "EUR",
        amountMinorPerHour: 9500,
        effectiveFrom: day
      });
      expect(corrected.amountMinorPerHour).toBe(9500);
    });

    it("refuses to change anything but the withdrawal, even with a direct update", async () => {
      const rate = await service.publishCostRate(ctx(), {
        membershipId: membershipA,
        currency: "EUR",
        costMinorPerHour: 2000,
        effectiveFrom: "2026-05-01"
      });
      // The trigger sees an update that leaves annulled_at null, which is an edit like any other.
      await expect(
        admin`update member_cost_rates set effective_from = '2026-05-02' where id = ${rate.id}`
      ).rejects.toThrow(/append-only/);
    });

    it("withdraws a cost rate and the hour falls back to the one in force before it", async () => {
      const project = await open();
      // Two dated cost rates of this person, and an hour worked after both of them started.
      await service.publishCostRate(ctx(), {
        membershipId: membershipA,
        currency: "EUR",
        costMinorPerHour: 5000,
        effectiveFrom: "2026-07-01"
      });
      const correction = await service.publishCostRate(ctx(), {
        membershipId: membershipA,
        currency: "EUR",
        costMinorPerHour: 8000,
        effectiveFrom: "2026-07-15"
      });
      await service.logTime(ctx(), { projectId: project.id, duration: "60", spentOn: "2026-07-20" });
      expect((await service.projectProfitability(ctx(), project.id)).lines[0]!.costMinor).toBe(8000);

      // Withdrawing the newer one does not leave a hole: the previous rate is in force again,
      // which is what makes withdrawal a correction rather than a deletion.
      await service.annulCostRate(ctx(), correction.id);
      expect((await service.projectProfitability(ctx(), project.id)).lines[0]!.costMinor).toBe(5000);
    });

    it("prices a project by its kind of work when it has no rate of its own", async () => {
      const type = await openServiceType();
      const project = await open({ serviceTypeId: type.id });
      await service.logTime(ctx(), { projectId: project.id, duration: "60", spentOn: "2026-06-10" });
      await service.publishBillingRate(ctx(), {
        scope: "service_type",
        scopeId: type.id,
        currency: "EUR",
        amountMinorPerHour: 7000,
        effectiveFrom: "2026-01-01"
      });

      const report = await service.projectProfitability(ctx(), project.id);
      expect(report.lines[0]).toMatchObject({ currency: "EUR", revenueMinor: 7000 });
    });

    it("lets the rate of a project win over the one of its kind of work", async () => {
      const type = await openServiceType();
      const project = await open({ serviceTypeId: type.id });
      await service.logTime(ctx(), { projectId: project.id, duration: "60", spentOn: "2026-06-10" });
      await service.publishBillingRate(ctx(), {
        scope: "service_type",
        scopeId: type.id,
        currency: "EUR",
        amountMinorPerHour: 7000,
        effectiveFrom: "2026-01-01"
      });
      await service.publishBillingRate(ctx(), {
        scope: "project",
        scopeId: project.id,
        currency: "EUR",
        amountMinorPerHour: 11_000,
        effectiveFrom: "2026-01-01"
      });

      expect((await service.projectProfitability(ctx(), project.id)).lines[0]!.revenueMinor).toBe(11_000);
    });

    it("assigns a kind of work to a project that was opened without one", async () => {
      const type = await openServiceType();
      const project = await open();
      expect(project.serviceTypeId).toBeNull();
      const updated = await service.setServiceType(ctx(), project.id, type.id);
      expect(updated.serviceTypeId).toBe(type.id);
    });

    it("refuses a second rate for the same kind of work and day", async () => {
      const type = await openServiceType();
      await service.publishBillingRate(ctx(), {
        scope: "service_type",
        scopeId: type.id,
        currency: "EUR",
        amountMinorPerHour: 7000,
        effectiveFrom: "2026-02-01"
      });
      await expect(
        service.publishBillingRate(ctx(), {
          scope: "service_type",
          scopeId: type.id,
          currency: "EUR",
          amountMinorPerHour: 8000,
          effectiveFrom: "2026-02-01"
        })
      ).rejects.toMatchObject({ code: "DUPLICATE_RATE" });
    });

    it("refuses a second kind of work with the same code", async () => {
      const type = await openServiceType();
      await expect(
        service.createServiceType(ctx(), { code: type.code, name: `Un altre ${randomUUID().slice(0, 8)}` })
      ).rejects.toMatchObject({ code: "DUPLICATE_SERVICE_TYPE" });
    });

    it("refuses a second kind of work with the same name, however it is written", async () => {
      const type = await openServiceType();
      // Accents, capitals and extra spacing are not a different name, and a code of its own does not
      // make it one: two entries saying the same thing is what makes a catalogue useless.
      for (const written of [type.name, type.name.toUpperCase(), `  ${type.name}  `, `${type.name}!`])
        await expect(
          service.createServiceType(ctx(), { code: `alt-${randomUUID().slice(0, 8)}`, name: written })
        ).rejects.toMatchObject({ code: "DUPLICATE_SERVICE_TYPE" });
    });

    it("removes a kind of work that nothing depends on", async () => {
      const type = await openServiceType();
      expect(await service.deleteServiceType(ctx(), type.id)).toEqual({ detachedProjects: 0 });
      expect((await service.listServiceTypes(ctx())).some((row) => row.id === type.id)).toBe(false);
    });

    it("detaches the projects of that kind instead of refusing, and says how many", async () => {
      const type = await openServiceType();
      const first = await open({ serviceTypeId: type.id });
      await open({ serviceTypeId: type.id });

      // Two projects were of this kind, and the count is what the screen tells the owner.
      expect(await service.deleteServiceType(ctx(), type.id)).toEqual({ detachedProjects: 2 });

      // The projects survive; what they lose is the kind of work, and with it the standing price.
      const detached = await repository.getProject(ctx(), first.id);
      expect(detached?.serviceTypeId).toBeNull();
    });

    it("refuses to remove a kind of work that has a published rate", async () => {
      const type = await openServiceType();
      await service.publishBillingRate(ctx(), {
        scope: "service_type",
        scopeId: type.id,
        currency: "EUR",
        amountMinorPerHour: 7000,
        effectiveFrom: "2026-03-04"
      });
      await expect(service.deleteServiceType(ctx(), type.id)).rejects.toMatchObject({
        code: "SERVICE_TYPE_HAS_RATES"
      });
    });

    it("refuses even when the only rate under it has been withdrawn", async () => {
      // The row is what blocks the removal, not whether it still prices anything: it valued hours
      // once, and those hours have to keep answering the same numbers.
      const type = await openServiceType();
      const rate = await service.publishBillingRate(ctx(), {
        scope: "service_type",
        scopeId: type.id,
        currency: "EUR",
        amountMinorPerHour: 7000,
        effectiveFrom: "2026-03-05"
      });
      await service.annulBillingRate(ctx(), rate.id);
      await expect(service.deleteServiceType(ctx(), type.id)).rejects.toMatchObject({
        code: "SERVICE_TYPE_HAS_RATES"
      });
    });

    it("deactivates a kind of work without touching what its rate already valued", async () => {
      const type = await openServiceType();
      const project = await open({ serviceTypeId: type.id });
      await service.logTime(ctx(), { projectId: project.id, duration: "60", spentOn: "2026-06-11" });
      await service.publishBillingRate(ctx(), {
        scope: "service_type",
        scopeId: type.id,
        currency: "EUR",
        amountMinorPerHour: 7000,
        effectiveFrom: "2026-01-01"
      });

      const deactivated = await service.setServiceTypeActive(ctx(), type.id, false);
      expect(deactivated.active).toBe(false);

      // Still 70,00: deactivating decides what is offered for new work, not what past work was
      // worth. Reading it any other way would rewrite a closed month.
      expect((await service.projectProfitability(ctx(), project.id)).lines[0]!.revenueMinor).toBe(7000);
    });

    it("counts what depends on a kind of work so the screen can warn before removing it", async () => {
      const type = await openServiceType();
      await open({ serviceTypeId: type.id });
      await service.publishBillingRate(ctx(), {
        scope: "service_type",
        scopeId: type.id,
        currency: "EUR",
        amountMinorPerHour: 7000,
        effectiveFrom: "2026-03-06"
      });

      const listed = (await service.listServiceTypes(ctx())).find((row) => row.id === type.id);
      expect(listed).toMatchObject({ projectCount: 1, rateCount: 1 });
    });

    it("derives the code from the name, dashes included", async () => {
      const suffix = randomUUID().slice(0, 6);
      const created = await service.createServiceType(ctx(), { code: "", name: `Pàgina Web ${suffix}` });
      expect(created.code).toBe(`pagina-web-${suffix}`);
    });

    it("keeps one tenant's kinds of work invisible to another", async () => {
      await openServiceType();
      expect(await service.listServiceTypes(context(tenantB, membershipB))).toEqual([]);
    });

    it("keeps cost and margin away from a member without financials:read", async () => {
      const project = await open();
      const technical = context(tenantA, membershipA, ["projects:read", "time:log"]);
      await expect(service.projectProfitability(technical, project.id)).rejects.toMatchObject({
        code: "PERMISSION_DENIED"
      });
      await expect(service.listRates(technical)).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    });

    it("adds up a customer across its projects and its tickets", async () => {
      const project = await open({ customerId: customerOther });
      const ticket = await openTicket(customerOther, null);
      await service.logTime(ctx(), { projectId: project.id, duration: "2h", spentOn: "2026-06-10" });
      await service.logTime(ctx(), { ticketId: ticket, duration: "1h", spentOn: "2026-06-10" });

      const report = await service.customerProfitability(ctx(), customerOther);
      expect(report.scope).toBe("customer");
      expect(report.minutes).toBe(180);
    });
  });
});

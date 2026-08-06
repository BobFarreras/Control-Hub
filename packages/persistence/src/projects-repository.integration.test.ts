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
  const open = (overrides: { customerId?: string; name?: string } = {}) =>
    service.createProject(ctx(), {
      customerId: overrides.customerId ?? customerA,
      code: `prj-${(sequence += 1)}-${randomUUID().slice(0, 8)}`,
      name: overrides.name ?? "Projecte de prova"
    });

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

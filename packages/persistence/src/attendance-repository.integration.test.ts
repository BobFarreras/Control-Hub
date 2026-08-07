import { randomUUID } from "node:crypto";
import { AttendanceService } from "@control-hub/application";
import { createDatabaseClient, type DatabaseClient } from "@control-hub/database";
import type { Permission, TenantContext } from "@control-hub/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresAttendanceRepository } from "./attendance-repository.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const adminUrl = process.env.TEST_DATABASE_ADMIN_URL;
// Skipping locally is a convenience; skipping in CI would mean these guarantees ship unproven.
if (process.env.CI && !(databaseUrl && adminUrl))
  throw new Error("TEST_DATABASE_URL and TEST_DATABASE_ADMIN_URL are required in CI");
const suite = databaseUrl && adminUrl ? describe : describe.skip;

/**
 * The service and the adapter together, against a real database.
 *
 * The unit tests upstream prove the rules against a repository that always agrees. What only
 * shows up here is whether the SQL says what the rules mean: the two clocks of a punch, the day
 * a night shift belongs to, and a range that has to reach past the edge of a month to find the
 * clock out of a shift that started inside it.
 *
 * Two people, on purpose. Aina holds a history written into the log directly, so the months it
 * asserts on are fixed; Bernat does the live clocking, whose entries land today. Sharing one
 * person would let today's punches turn up inside a month somebody else is counting, which is
 * exactly what happened when they did.
 */
suite("PostgresAttendanceRepository", () => {
  let database: DatabaseClient;
  let admin: DatabaseClient;
  let service: AttendanceService;
  let repository: PostgresAttendanceRepository;

  const tenantA = randomUUID();
  const userA = randomUUID();
  const userB = randomUUID();
  const aina = randomUUID();
  const bernat = randomUUID();
  const customerA = randomUUID();
  const projectA = randomUUID();

  const context = (membershipId: string, permissions: Permission[] = ["attendance:record"]): TenantContext => ({
    tenantId: tenantA,
    membershipId,
    userId: userA,
    roles: ["administrator"],
    permissions,
    mfaEnabled: true
  });

  const worker = () => context(aina);
  const manager = () => context(bernat, ["attendance:record", "attendance:manage", "financials:read"]);

  /**
   * Writes straight to the log, so a test can lay out a day that already happened.
   *
   * Every time here has to be genuinely in the past: `occurred_at <= recorded_at` is a check in
   * the schema, and a fixture dated next month is refused by it, correctly and confusingly.
   */
  const past = (membershipId: string, kind: string, iso: string) =>
    admin`insert into attendance_events (id, tenant_id, membership_id, kind, occurred_at,
        recorded_by_membership_id, reason)
      values (${randomUUID()}, ${tenantA}, ${membershipId}, ${kind}, ${iso}, ${membershipId}, 'Sembrat per la prova')`;

  beforeAll(async () => {
    database = createDatabaseClient(databaseUrl!);
    admin = createDatabaseClient(adminUrl!);
    repository = new PostgresAttendanceRepository(database);
    service = new AttendanceService(repository);

    await admin`insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt") values
      (${userA}, 'Aina Attendance', ${`${userA}@test.local`}, true, now(), now()),
      (${userB}, 'Bernat Attendance', ${`${userB}@test.local`}, true, now(), now())`;
    await admin`insert into tenants (id, slug, name) values (${tenantA}, ${`att-${tenantA}`}, 'Att')`;
    await admin`insert into tenant_settings (tenant_id, brand_name, timezone)
      values (${tenantA}, 'Att', 'Europe/Madrid')`;
    await admin`insert into memberships (id, tenant_id, user_id) values
      (${aina}, ${tenantA}, ${userA}), (${bernat}, ${tenantA}, ${userB})`;
    // A project to bill hours to, so the reconciliation has both halves of its comparison.
    await admin`insert into customers (id, tenant_id, display_name, normalized_name)
      values (${customerA}, ${tenantA}, 'Client Att', ${`client att ${customerA}`})`;
    await admin`insert into projects (id, tenant_id, customer_id, code, name, status)
      values (${projectA}, ${tenantA}, ${customerA}, ${`att-${projectA.slice(0, 8)}`}, 'Projecte Att', 'active')`;
  });

  afterAll(async () => {
    await admin.unsafe("alter table attendance_events disable trigger attendance_events_append_only");
    try {
      await admin`delete from attendance_events where tenant_id = ${tenantA}`;
    } finally {
      await admin.unsafe("alter table attendance_events enable trigger attendance_events_append_only");
    }
    await admin`delete from time_entries where tenant_id = ${tenantA}`;
    await admin`delete from projects where tenant_id = ${tenantA}`;
    await admin`delete from customers where tenant_id = ${tenantA}`;
    await admin`delete from memberships where tenant_id = ${tenantA}`;
    await admin`delete from tenant_settings where tenant_id = ${tenantA}`;
    await admin`delete from tenants where id = ${tenantA}`;
    await admin`delete from "user" where id in (${userA}, ${userB})`;
    await database.end({ timeout: 5 });
    await admin.end({ timeout: 5 });
  });

  describe("clocking, live", () => {
    it("clocks in and reads the state back out of the log", async () => {
      expect((await service.currentState(manager())).state).toBe("out");
      await service.punch(manager(), { kind: "clock_in" });
      expect((await service.currentState(manager())).state).toBe("in");
      await service.punch(manager(), { kind: "clock_out" });
      expect((await service.currentState(manager())).state).toBe("out");
    });

    /**
     * Both clocks of a punch have to come out identical, or the schema would read every punch as
     * something declared after the fact and demand a reason for it. It holds because neither
     * column is written from here: both take the transaction's `now()`.
     */
    it("gives a punch the same time on both clocks", async () => {
      const event = await service.punch(manager(), { kind: "clock_in" });
      expect(event.occurredAt.getTime()).toBe(event.recordedAt.getTime());
      await service.punch(manager(), { kind: "clock_out" });
    });

    it("returns the entry already written when a punch is retried", async () => {
      const reference = `retry-${randomUUID()}`;
      const first = await service.punch(manager(), { kind: "clock_in", clientReference: reference });
      const second = await service.punch(manager(), { kind: "clock_in", clientReference: reference });
      expect(second.id).toBe(first.id);
      await service.punch(manager(), { kind: "clock_out" });
    });

    it("refuses a clock out with nothing open, and writes nothing", async () => {
      await expect(service.punch(manager(), { kind: "clock_out" })).rejects.toThrow("PUNCH_NOT_ALLOWED");
    });

    it("ships with breaks off, and honours the ones recorded while they were on", async () => {
      await service.punch(manager(), { kind: "clock_in" });
      await expect(service.punch(manager(), { kind: "pause_start" })).rejects.toThrow("PUNCH_NOT_ALLOWED");

      await admin`update tenant_settings set attendance_pauses_enabled = true where tenant_id = ${tenantA}`;
      await expect(service.punch(manager(), { kind: "pause_start" })).resolves.toBeDefined();

      // Turning them off again does not retract the break already recorded: a setting decides what
      // may be written from now on, never what the log already says.
      await admin`update tenant_settings set attendance_pauses_enabled = false where tenant_id = ${tenantA}`;
      expect((await service.currentState(manager())).state).toBe("paused");

      await admin`update tenant_settings set attendance_pauses_enabled = true where tenant_id = ${tenantA}`;
      await service.punch(manager(), { kind: "pause_end" });
      await service.punch(manager(), { kind: "clock_out" });
      await admin`update tenant_settings set attendance_pauses_enabled = false where tenant_id = ${tenantA}`;
    });
  });

  describe("the month somebody reads", () => {
    it("adds up the days in the tenant's own time zone", async () => {
      // 08:00 to 16:00 Madrid on the second, and 09:00 to 13:00 on the third. June is UTC+2.
      await past(aina, "clock_in", "2026-06-02T06:00:00Z");
      await past(aina, "clock_out", "2026-06-02T14:00:00Z");
      await past(aina, "clock_in", "2026-06-03T07:00:00Z");
      await past(aina, "clock_out", "2026-06-03T11:00:00Z");

      const june = await service.month(worker(), aina, { from: "2026-06-01", to: "2026-06-30" });
      expect(june.totalMinutes).toBe(720);
      expect(june.days).toEqual([
        { day: "2026-06-02", workedMinutes: 480, hasOpenSession: false },
        { day: "2026-06-03", workedMinutes: 240, hasOpenSession: false }
      ]);
    });

    /**
     * A shift starting at 23:00 on the last day of a month ends in the next one. The query has to
     * reach past the edge or the month would close with a session that never ends, and a real
     * night's work would go missing from the record.
     */
    it("finds the clock out of a shift that crosses the end of the month", async () => {
      await past(aina, "clock_in", "2026-07-31T21:00:00Z");
      await past(aina, "clock_out", "2026-08-01T01:00:00Z");

      const july = await service.month(worker(), aina, { from: "2026-07-01", to: "2026-07-31" });
      expect(july.days).toEqual([{ day: "2026-07-31", workedMinutes: 240, hasOpenSession: false }]);
    });

    it("keeps one person's record out of another's reach", async () => {
      await expect(service.month(worker(), bernat, { from: "2026-06-01", to: "2026-06-30" })).rejects.toThrow(
        "PERMISSION_DENIED"
      );
    });
  });

  describe("corrections", () => {
    it("counts the corrected value without removing what it corrects", async () => {
      const [wrong] = await admin<{ id: string }[]>`
        insert into attendance_events (id, tenant_id, membership_id, kind, occurred_at,
          recorded_by_membership_id, reason)
        values (${randomUUID()}, ${tenantA}, ${aina}, 'clock_out', '2026-05-04T18:00:00Z',
          ${aina}, 'Sembrat per la prova')
        returning id`;
      await past(aina, "clock_in", "2026-05-04T08:00:00Z");

      const may = { from: "2026-05-01", to: "2026-05-31" };
      // 10:00 to 20:00 Madrid, ten hours, and wrong: the person left at 18:00.
      expect((await service.month(worker(), aina, may)).totalMinutes).toBe(600);

      await service.correct(worker(), {
        membershipId: aina,
        kind: "clock_out",
        occurredAt: new Date("2026-05-04T16:00:00Z"),
        reason: "Vaig marxar a les 18:00",
        correctsEventId: wrong!.id
      });

      const corrected = await service.month(worker(), aina, may);
      expect(corrected.totalMinutes).toBe(480);
      // The original is still there to be read, which is the whole point of correcting this way.
      expect(corrected.events.some((event) => event.id === wrong!.id)).toBe(true);
      expect(corrected.events.some((event) => event.correctsEventId === wrong!.id)).toBe(true);
    });

    it("refuses a second correction of the same entry", async () => {
      const [original] = await admin<{ id: string }[]>`
        insert into attendance_events (id, tenant_id, membership_id, kind, occurred_at,
          recorded_by_membership_id, reason)
        values (${randomUUID()}, ${tenantA}, ${aina}, 'clock_in', '2026-04-01T08:00:00Z',
          ${aina}, 'Sembrat per la prova')
        returning id`;
      const correction = () =>
        service.correct(worker(), {
          membershipId: aina,
          kind: "clock_in",
          occurredAt: new Date("2026-04-01T07:00:00Z"),
          reason: "Hora equivocada",
          correctsEventId: original!.id
        });

      await expect(correction()).resolves.toBeDefined();
      await expect(correction()).rejects.toThrow("ALREADY_CORRECTED");
    });
  });

  /**
   * The report the module exists to make possible: hours at work against hours billed to
   * somebody. The two never become one number.
   */
  it("compares worked hours with hours logged to projects without merging them", async () => {
    await admin`insert into time_entries (id, tenant_id, membership_id, project_id, spent_on, minutes)
      values (${randomUUID()}, ${tenantA}, ${aina}, ${projectA}, '2026-06-02', 120)`;

    const rows = await service.reconciliation(manager(), { from: "2026-06-01", to: "2026-06-30" });
    const row = rows.find((entry) => entry.membershipId === aina)!;

    // Twelve hours at work across June, two of them billed to a project. The rest is structural
    // time: real work that no customer pays for, and the number nobody had before this report.
    expect(row.workedMinutes).toBe(720);
    expect(row.loggedMinutes).toBe(120);
    expect(row.unbilledMinutes).toBe(600);
  });
});

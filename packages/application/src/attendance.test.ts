import type { Permission, TenantContext } from "@control-hub/domain";
import { describe, expect, it, vi } from "vitest";
import {
  AttendanceService,
  type AttendanceEventRecord,
  type AttendanceRepository,
  type CorrectionInput
} from "./attendance.js";

const context = (permissions: Permission[], membershipId = "member-a"): TenantContext => ({
  tenantId: "tenant",
  membershipId,
  userId: "user",
  roles: ["administrator"],
  permissions,
  mfaEnabled: true
});

/** Everybody clocks. Only somebody who coordinates reads another person's record. */
const worker = context(["attendance:record"]);
const manager = context(["attendance:record", "attendance:manage"], "member-manager");
const accountant = context(["attendance:record", "attendance:manage", "financials:read"], "member-manager");

const event = (overrides: Partial<AttendanceEventRecord> = {}): AttendanceEventRecord => ({
  id: "event-1",
  membershipId: "member-a",
  kind: "clock_in",
  occurredAt: new Date("2026-08-04T06:00:00Z"),
  recordedAt: new Date("2026-08-04T06:00:00Z"),
  recordedByMembershipId: "member-a",
  source: "web",
  correctsEventId: null,
  reason: null,
  ...overrides
});

const repository = (overrides: Partial<AttendanceRepository> = {}): AttendanceRepository => ({
  appendEvent: vi.fn<AttendanceRepository["appendEvent"]>().mockResolvedValue(event()),
  findEventByClientReference: vi.fn<AttendanceRepository["findEventByClientReference"]>().mockResolvedValue(null),
  getEvent: vi.fn<AttendanceRepository["getEvent"]>().mockResolvedValue(event()),
  listEvents: vi.fn<AttendanceRepository["listEvents"]>().mockResolvedValue([]),
  listEventsForTenant: vi.fn<AttendanceRepository["listEventsForTenant"]>().mockResolvedValue([]),
  listMembers: vi.fn<AttendanceRepository["listMembers"]>().mockResolvedValue([
    { membershipId: "member-a", memberName: "Aina" },
    { membershipId: "member-b", memberName: "Bernat" }
  ]),
  loggedMinutesByMember: vi.fn<AttendanceRepository["loggedMinutesByMember"]>().mockResolvedValue({}),
  policy: vi
    .fn<AttendanceRepository["policy"]>()
    .mockResolvedValue({ pausesEnabled: false, timeZone: "Europe/Madrid" }),
  listHolidays: vi.fn<AttendanceRepository["listHolidays"]>().mockResolvedValue([]),
  createHoliday: vi.fn<AttendanceRepository["createHoliday"]>().mockResolvedValue({ id: "h1", date: "2026-08-15", name: "Holiday" }),
  deleteHoliday: vi.fn<AttendanceRepository["deleteHoliday"]>().mockResolvedValue(undefined),
  listNonWorkingDays: vi.fn<AttendanceRepository["listNonWorkingDays"]>().mockResolvedValue([]),
  createNonWorkingDay: vi.fn<AttendanceRepository["createNonWorkingDay"]>().mockResolvedValue({ id: "nw1", dayOfWeek: 0 }),
  deleteNonWorkingDay: vi.fn<AttendanceRepository["deleteNonWorkingDay"]>().mockResolvedValue(undefined),
  listVacations: vi.fn<AttendanceRepository["listVacations"]>().mockResolvedValue([]),
  listVacationsByMember: vi.fn<AttendanceRepository["listVacationsByMember"]>().mockResolvedValue([]),
  createVacation: vi.fn<AttendanceRepository["createVacation"]>().mockResolvedValue({
    id: "v1", membershipId: "member-a", startDate: "2026-08-01", endDate: "2026-08-15",
    status: "pending", approvedByMembershipId: null, approvedAt: null, notes: null
  }),
  updateVacationStatus: vi.fn<AttendanceRepository["updateVacationStatus"]>().mockResolvedValue({
    id: "v1", membershipId: "member-a", startDate: "2026-08-01", endDate: "2026-08-15",
    status: "approved", approvedByMembershipId: "member-manager", approvedAt: new Date(), notes: null
  }),
  deleteVacation: vi.fn<AttendanceRepository["deleteVacation"]>().mockResolvedValue(undefined),
  listAbsences: vi.fn<AttendanceRepository["listAbsences"]>().mockResolvedValue([]),
  listAbsencesByMember: vi.fn<AttendanceRepository["listAbsencesByMember"]>().mockResolvedValue([]),
  createAbsence: vi.fn<AttendanceRepository["createAbsence"]>().mockResolvedValue({
    id: "a1", membershipId: "member-a", startDate: "2026-08-20", endDate: "2026-08-22",
    type: "sick_leave", documentUrl: null, notes: null, createdByMembershipId: "member-a"
  }),
  deleteAbsence: vi.fn<AttendanceRepository["deleteAbsence"]>().mockResolvedValue(undefined),
  listBlocks: vi.fn<AttendanceRepository["listBlocks"]>().mockResolvedValue([]),
  listBlocksByMember: vi.fn<AttendanceRepository["listBlocksByMember"]>().mockResolvedValue([]),
  createBlock: vi.fn<AttendanceRepository["createBlock"]>().mockResolvedValue({
    id: "b1", membershipId: "member-a", date: "2026-08-25", startTime: "10:00", endTime: "12:00", reason: "Meeting"
  }),
  deleteBlock: vi.fn<AttendanceRepository["deleteBlock"]>().mockResolvedValue(undefined),
  ...overrides
});

const august = { from: "2026-08-01", to: "2026-08-31" };

describe("clocking", () => {
  it("never lets the caller choose the time", async () => {
    const store = repository();
    await new AttendanceService(store).punch(worker, { kind: "clock_in" });

    const [, written] = vi.mocked(store.appendEvent).mock.calls[0]!;
    // No `occurredAt` reaches storage: the database gives both clocks the transaction's time,
    // which is what keeps a punch distinguishable from something declared afterwards.
    expect(written.occurredAt).toBeUndefined();
    expect(written.membershipId).toBe("member-a");
  });

  it("returns the punch already written when the same request arrives twice", async () => {
    const already = event({ id: "first" });
    const store = repository({
      findEventByClientReference: vi.fn<AttendanceRepository["findEventByClientReference"]>().mockResolvedValue(already)
    });

    const result = await new AttendanceService(store).punch(worker, { kind: "clock_in", clientReference: "retry-1" });
    expect(result.id).toBe("first");
    expect(store.appendEvent).not.toHaveBeenCalled();
  });

  it("refuses a clock out from somebody who is not clocked in", async () => {
    const store = repository();
    await expect(new AttendanceService(store).punch(worker, { kind: "clock_out" })).rejects.toThrow(
      "PUNCH_NOT_ALLOWED"
    );
    expect(store.appendEvent).not.toHaveBeenCalled();
  });

  it("refuses a break where the installation does not record breaks", async () => {
    const store = repository({ listEvents: vi.fn<AttendanceRepository["listEvents"]>().mockResolvedValue([event()]) });
    await expect(new AttendanceService(store).punch(worker, { kind: "pause_start" })).rejects.toThrow(
      "PUNCH_NOT_ALLOWED"
    );
  });

  it("allows the same break once the installation records them", async () => {
    const store = repository({
      listEvents: vi.fn<AttendanceRepository["listEvents"]>().mockResolvedValue([event()]),
      policy: vi
        .fn<AttendanceRepository["policy"]>()
        .mockResolvedValue({ pausesEnabled: true, timeZone: "Europe/Madrid" })
    });
    await expect(new AttendanceService(store).punch(worker, { kind: "pause_start" })).resolves.toBeDefined();
  });

  it("refuses somebody with no permission to clock at all", async () => {
    await expect(new AttendanceService(repository()).punch(context([]), { kind: "clock_in" })).rejects.toThrow(
      "PERMISSION_DENIED"
    );
  });

  /**
   * A person who clocked in yesterday and never clocked out is still inside today. Reading only
   * today's events would call them out and offer the wrong button.
   */
  it("reads the state from more than the current day", async () => {
    const store = repository();
    await new AttendanceService(store).punch(worker, { kind: "clock_in" });
    const [, , range] = vi.mocked(store.listEvents).mock.calls[0]!;
    expect(new Date(range.to).getTime() - new Date(range.from).getTime()).toBeGreaterThanOrEqual(6 * 86_400_000);
  });
});

describe("corrections", () => {
  const correction = (overrides: Partial<CorrectionInput> = {}): CorrectionInput => ({
    membershipId: "member-a",
    kind: "pause_end",
    occurredAt: new Date("2026-08-04T11:00:00Z"),
    reason: "Vaig tornar del metge a les 13:00 i no ho vaig marcar",
    ...overrides
  });

  const now = new Date("2026-08-04T14:00:00Z");

  it("lets a person put their own record right", async () => {
    const store = repository();
    await expect(new AttendanceService(store).correct(worker, correction(), now)).resolves.toBeDefined();
    const [, written] = vi.mocked(store.appendEvent).mock.calls[0]!;
    expect(written.occurredAt).toEqual(new Date("2026-08-04T11:00:00Z"));
    expect(written.reason).toBeTruthy();
  });

  it("refuses a correction with no reason", async () => {
    await expect(
      new AttendanceService(repository()).correct(worker, correction({ reason: "   " }), now)
    ).rejects.toThrow("INVALID_CORRECTION");
  });

  it("refuses a correction claiming a time that has not happened yet", async () => {
    await expect(
      new AttendanceService(repository()).correct(
        worker,
        correction({ occurredAt: new Date("2026-08-04T20:00:00Z") }),
        now
      )
    ).rejects.toThrow("INVALID_CORRECTION");
  });

  it("refuses to touch another person's record without the permission to", async () => {
    await expect(
      new AttendanceService(repository()).correct(worker, correction({ membershipId: "member-b" }), now)
    ).rejects.toThrow("PERMISSION_DENIED");
  });

  it("lets somebody who coordinates put another person's record right", async () => {
    const store = repository();
    await expect(new AttendanceService(store).correct(manager, correction(), now)).resolves.toBeDefined();
  });

  it("refuses a correction pointed at an entry of somebody else", async () => {
    const store = repository({
      getEvent: vi.fn<AttendanceRepository["getEvent"]>().mockResolvedValue(event({ membershipId: "member-b" }))
    });
    await expect(
      new AttendanceService(store).correct(worker, correction({ correctsEventId: "event-1" }), now)
    ).rejects.toThrow("EVENT_NOT_FOUND");
  });
});

describe("reading a record", () => {
  const day = [
    event({ id: "in", kind: "clock_in", occurredAt: new Date("2026-08-04T06:00:00Z") }),
    event({ id: "out", kind: "clock_out", occurredAt: new Date("2026-08-04T14:00:00Z") })
  ];

  it("gives a person their own month without any extra permission", async () => {
    const store = repository({ listEvents: vi.fn<AttendanceRepository["listEvents"]>().mockResolvedValue(day) });
    const month = await new AttendanceService(store).month(worker, "member-a", august);

    expect(month.totalMinutes).toBe(480);
    expect(month.days).toEqual([{ day: "2026-08-04", workedMinutes: 480, hasOpenSession: false }]);
    // The events travel with it, corrected ones included: the history is the point of the record.
    expect(month.events).toHaveLength(2);
  });

  it("refuses one person the record of another", async () => {
    await expect(new AttendanceService(repository()).month(worker, "member-b", august)).rejects.toThrow(
      "PERMISSION_DENIED"
    );
  });

  it("refuses the record of everybody to somebody who only clocks", async () => {
    await expect(new AttendanceService(repository()).everyone(worker, august)).rejects.toThrow("PERMISSION_DENIED");
  });

  /**
   * The export the accountancy reads is a list of days with a time in and a time out, so the
   * sessions have to travel with the totals. A column of monthly totals is the conclusion with
   * the evidence left out, and nobody can check it.
   */
  it("carries the sessions behind each total, and counts what was written after the fact", async () => {
    const store = repository({
      listEventsForTenant: vi.fn<AttendanceRepository["listEventsForTenant"]>().mockResolvedValue([
        ...day,
        // Marked three hours after it says it happened, so it counts as declared.
        event({
          id: "late",
          kind: "clock_in",
          occurredAt: new Date("2026-08-05T06:00:00Z"),
          recordedAt: new Date("2026-08-05T09:00:00Z"),
          reason: "Vaig oblidar-me de fitxar"
        }),
        event({ id: "late-out", kind: "clock_out", occurredAt: new Date("2026-08-05T10:00:00Z") })
      ])
    });

    const [aina] = await new AttendanceService(store).everyone(manager, august);
    expect(aina!.sessions.map((session) => session.day)).toEqual(["2026-08-04", "2026-08-05"]);
    expect(aina!.sessions[0]!.workedMinutes).toBe(480);
    expect(aina!.declaredEntries).toBe(1);
  });

  it("splits the tenant's log per person rather than adding it up", async () => {
    const store = repository({
      listEventsForTenant: vi.fn<AttendanceRepository["listEventsForTenant"]>().mockResolvedValue([
        ...day,
        event({
          id: "b-in",
          membershipId: "member-b",
          kind: "clock_in",
          occurredAt: new Date("2026-08-04T07:00:00Z")
        }),
        event({
          id: "b-out",
          membershipId: "member-b",
          kind: "clock_out",
          occurredAt: new Date("2026-08-04T09:00:00Z")
        })
      ])
    });

    const everyone = await new AttendanceService(store).everyone(manager, august);
    expect(everyone.map((member) => [member.memberName, member.totalMinutes])).toEqual([
      ["Aina", 480],
      ["Bernat", 120]
    ]);
  });
});

describe("reconciliation", () => {
  it("needs financials on top of managing, because it reveals what structural time costs", async () => {
    await expect(new AttendanceService(repository()).reconciliation(manager, august)).rejects.toThrow(
      "PERMISSION_DENIED"
    );
  });

  it("reports worked, logged and the gap without ever merging them", async () => {
    const store = repository({
      listEventsForTenant: vi
        .fn<AttendanceRepository["listEventsForTenant"]>()
        .mockResolvedValue([
          event({ id: "in", kind: "clock_in", occurredAt: new Date("2026-08-04T06:00:00Z") }),
          event({ id: "out", kind: "clock_out", occurredAt: new Date("2026-08-04T14:00:00Z") })
        ]),
      loggedMinutesByMember: vi
        .fn<AttendanceRepository["loggedMinutesByMember"]>()
        .mockResolvedValue({ "member-a": 300 })
    });

    const [aina, bernat] = await new AttendanceService(store).reconciliation(accountant, august);
    expect(aina).toMatchObject({ workedMinutes: 480, loggedMinutes: 300, unbilledMinutes: 180 });
    // Nobody logged anything against a day nobody worked, and that is a zero, not a hole.
    expect(bernat).toMatchObject({ workedMinutes: 0, loggedMinutes: 0, unbilledMinutes: 0 });
  });
});

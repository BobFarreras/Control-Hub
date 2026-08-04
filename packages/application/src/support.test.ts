import type { SupportCalendar, TenantContext, TicketStatus } from "@control-hub/domain";
import { describe, expect, it, vi } from "vitest";
import {
  escalateBreachedTargets,
  SupportError,
  SupportService,
  stopsTheClock,
  type EscalationCandidate,
  type SupportRepository,
  type TicketListRow,
  type TicketRecord
} from "./support.js";

const context: TenantContext = {
  tenantId: "tenant",
  membershipId: "member",
  userId: "user",
  roles: ["administrator"],
  permissions: ["tickets:manage"],
  mfaEnabled: true
};

const calendar: SupportCalendar = {
  timeZone: "Europe/Madrid",
  windows: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, opensAt: "08:00", closesAt: "16:00" })),
  holidays: []
};

const ticket = (overrides: Partial<TicketRecord> = {}): TicketRecord => ({
  id: "ticket-1",
  ticketNumber: 1,
  customerId: "customer-1",
  projectId: null,
  subject: "El correu no arriba",
  description: "Des d'ahir",
  status: "open",
  priority: "normal",
  category: "general",
  assigneeMembershipId: null,
  openedAt: new Date("2026-08-04T07:00:00Z"),
  firstResponseAt: null,
  resolvedAt: null,
  closedAt: null,
  firstResponseTargetMinutes: 60,
  resolutionTargetMinutes: 480,
  ...overrides
});

/** A listing row carries the names the inbox renders, which the base record does not. */
const listRow = (overrides: Partial<TicketListRow> = {}): TicketListRow => ({
  ...ticket(),
  customerName: "Client A",
  assigneeName: null,
  ...overrides
});

const repository = (overrides: Partial<SupportRepository> = {}): SupportRepository => ({
  listTickets: vi
    .fn<SupportRepository["listTickets"]>()
    .mockResolvedValue({ items: [listRow()], total: 1, page: 1, pageSize: 25 }),
  createTicket: vi.fn<SupportRepository["createTicket"]>().mockImplementation((_context, input) =>
    Promise.resolve(
      ticket({
        firstResponseTargetMinutes: input.targets.firstResponseMinutes,
        resolutionTargetMinutes: input.targets.resolutionMinutes
      })
    )
  ),
  getTicket: vi.fn<SupportRepository["getTicket"]>().mockResolvedValue(ticket()),
  updateStatus: vi.fn<SupportRepository["updateStatus"]>().mockResolvedValue(ticket({ status: "resolved" })),
  assign: vi.fn<SupportRepository["assign"]>().mockResolvedValue(ticket({ assigneeMembershipId: "member" })),
  addMessage: vi.fn<SupportRepository["addMessage"]>().mockResolvedValue({
    id: "message-1",
    ticketId: "ticket-1",
    authorMembershipId: "member",
    body: "Ho mirem",
    visibility: "customer",
    createdAt: new Date("2026-08-04T07:30:00Z")
  }),
  findMessageByExternalReference: vi.fn<SupportRepository["findMessageByExternalReference"]>().mockResolvedValue(null),
  listMessages: vi.fn<SupportRepository["listMessages"]>().mockResolvedValue([]),
  getTicketWithNames: vi
    .fn<SupportRepository["getTicketWithNames"]>()
    .mockResolvedValue({ ...ticket(), customerName: "Client A", assigneeName: null }),
  listAssignableMembers: vi
    .fn<SupportRepository["listAssignableMembers"]>()
    .mockResolvedValue([{ membershipId: "member", name: "Boby" }]),
  markFirstResponse: vi.fn<SupportRepository["markFirstResponse"]>().mockResolvedValue(undefined),
  listPauses: vi.fn<SupportRepository["listPauses"]>().mockResolvedValue([]),
  listPausesForTickets: vi.fn<SupportRepository["listPausesForTickets"]>().mockResolvedValue({}),
  currentTargets: vi
    .fn<SupportRepository["currentTargets"]>()
    .mockResolvedValue({ firstResponseMinutes: 60, resolutionMinutes: 480 }),
  loadCalendar: vi.fn<SupportRepository["loadCalendar"]>().mockResolvedValue(calendar),
  replaceSchedule: vi.fn<SupportRepository["replaceSchedule"]>().mockResolvedValue(undefined),
  listHolidays: vi.fn<SupportRepository["listHolidays"]>().mockResolvedValue([]),
  addHoliday: vi
    .fn<SupportRepository["addHoliday"]>()
    .mockResolvedValue({ id: "holiday-1", holidayOn: "2026-08-05", label: null }),
  removeHoliday: vi.fn<SupportRepository["removeHoliday"]>().mockResolvedValue(undefined),
  listEscalationCandidates: vi.fn<SupportRepository["listEscalationCandidates"]>().mockResolvedValue([]),
  recordBreach: vi.fn<SupportRepository["recordBreach"]>().mockResolvedValue(undefined),
  listSlaTargets: vi.fn<SupportRepository["listSlaTargets"]>().mockResolvedValue([]),
  publishSlaTarget: vi.fn<SupportRepository["publishSlaTarget"]>().mockResolvedValue({
    id: "target-1",
    priority: "normal",
    firstResponseMinutes: 60,
    resolutionMinutes: 480,
    effectiveFrom: new Date("2026-08-04T00:00:00Z")
  }),
  ...overrides
});

describe("creating a ticket", () => {
  it("copies the targets in force onto the ticket", async () => {
    const currentTargets = vi
      .fn<SupportRepository["currentTargets"]>()
      .mockResolvedValue({ firstResponseMinutes: 15, resolutionMinutes: 120 });
    const created = await new SupportService(repository({ currentTargets })).createTicket(context, {
      customerId: "customer-1",
      subject: "Cau la web",
      description: "Error 500",
      priority: "urgent"
    });
    expect(created.firstResponseTargetMinutes).toBe(15);
    expect(created.resolutionTargetMinutes).toBe(120);
  });

  it("refuses to open a ticket that could never be measured", async () => {
    const currentTargets = vi.fn<SupportRepository["currentTargets"]>().mockResolvedValue(null);
    await expect(
      new SupportService(repository({ currentTargets })).createTicket(context, {
        customerId: "customer-1",
        subject: "Cau la web",
        description: "Error 500",
        priority: "urgent"
      })
    ).rejects.toMatchObject({ code: "SLA_TARGETS_NOT_CONFIGURED" });
  });

  it("rejects an empty subject or description", async () => {
    const service = new SupportService(repository());
    const base = { customerId: "customer-1", priority: "normal" as const };
    await expect(service.createTicket(context, { ...base, subject: "  ", description: "hi ha text" })).rejects.toThrow(
      SupportError
    );
    await expect(service.createTicket(context, { ...base, subject: "Assumpte", description: " " })).rejects.toThrow(
      SupportError
    );
  });
});

describe("transitions", () => {
  it("refuses a move the domain does not allow", async () => {
    const getTicket = vi.fn<SupportRepository["getTicket"]>().mockResolvedValue(ticket({ status: "closed" }));
    await expect(
      new SupportService(repository({ getTicket })).transition(context, "ticket-1", "open")
    ).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
  });

  it("reports a ticket that is not there rather than inventing one", async () => {
    const getTicket = vi.fn<SupportRepository["getTicket"]>().mockResolvedValue(null);
    await expect(
      new SupportService(repository({ getTicket })).transition(context, "missing", "open")
    ).rejects.toMatchObject({ code: "TICKET_NOT_FOUND" });
  });

  it("knows which statuses stop the clock", () => {
    const stopped: TicketStatus[] = ["waiting_customer", "waiting_third_party"];
    for (const status of stopped) expect(stopsTheClock(status)).toBe(true);
    for (const status of ["new", "open", "resolved", "closed"] as TicketStatus[]) {
      expect(stopsTheClock(status)).toBe(false);
    }
  });
});

describe("messages", () => {
  it("records the first response when a member first writes to the customer", async () => {
    const markFirstResponse = vi.fn<SupportRepository["markFirstResponse"]>().mockResolvedValue(undefined);
    await new SupportService(repository({ markFirstResponse })).addMessage(context, "ticket-1", {
      body: "Ho mirem ara",
      visibility: "customer"
    });
    expect(markFirstResponse).toHaveBeenCalledOnce();
  });

  it("does not let an internal note count as a first response", async () => {
    const markFirstResponse = vi.fn<SupportRepository["markFirstResponse"]>().mockResolvedValue(undefined);
    await new SupportService(repository({ markFirstResponse })).addMessage(context, "ticket-1", {
      body: "Nota per a nosaltres",
      visibility: "internal"
    });
    expect(markFirstResponse).not.toHaveBeenCalled();
  });

  it("never moves a first response that is already recorded", async () => {
    const getTicket = vi
      .fn<SupportRepository["getTicket"]>()
      .mockResolvedValue(ticket({ firstResponseAt: new Date("2026-08-04T07:10:00Z") }));
    const markFirstResponse = vi.fn<SupportRepository["markFirstResponse"]>().mockResolvedValue(undefined);
    await new SupportService(repository({ getTicket, markFirstResponse })).addMessage(context, "ticket-1", {
      body: "Segona resposta",
      visibility: "customer"
    });
    expect(markFirstResponse).not.toHaveBeenCalled();
  });

  it("returns the stored message when the same external reference arrives twice", async () => {
    const stored = {
      id: "message-existing",
      ticketId: "ticket-1",
      authorMembershipId: null,
      body: "Original",
      visibility: "customer" as const,
      createdAt: new Date("2026-08-04T07:05:00Z")
    };
    const findMessageByExternalReference = vi
      .fn<SupportRepository["findMessageByExternalReference"]>()
      .mockResolvedValue(stored);
    const addMessage = vi.fn<SupportRepository["addMessage"]>();
    const message = await new SupportService(repository({ findMessageByExternalReference, addMessage })).addMessage(
      context,
      "ticket-1",
      { body: "Repetit", visibility: "customer", externalReference: "mail-1" }
    );

    expect(message.id).toBe("message-existing");
    expect(addMessage).not.toHaveBeenCalled();
  });

  it("refuses to write onto a closed ticket", async () => {
    const getTicket = vi.fn<SupportRepository["getTicket"]>().mockResolvedValue(ticket({ status: "closed" }));
    await expect(
      new SupportService(repository({ getTicket })).addMessage(context, "ticket-1", {
        body: "Tard",
        visibility: "internal"
      })
    ).rejects.toMatchObject({ code: "TICKET_CLOSED" });
  });
});

describe("sla for a ticket", () => {
  it("measures against the calendar and the recorded pauses", async () => {
    const listPauses = vi
      .fn<SupportRepository["listPauses"]>()
      .mockResolvedValue([{ from: new Date("2026-08-04T07:30:00Z"), to: new Date("2026-08-04T09:30:00Z") }]);
    const state = await new SupportService(repository({ listPauses })).slaFor(
      context,
      "ticket-1",
      new Date("2026-08-04T09:30:00Z")
    );
    expect(state.firstResponse.consumedMinutes).toBe(30);
    expect(state.firstResponse.breached).toBe(false);
  });

  it("reports an unconfigured calendar as unmeasurable rather than as compliant", async () => {
    const loadCalendar = vi
      .fn<SupportRepository["loadCalendar"]>()
      .mockResolvedValue({ timeZone: "Europe/Madrid", windows: [], holidays: [] });
    const state = await new SupportService(repository({ loadCalendar })).slaFor(context, "ticket-1");
    expect(state.firstResponse.measurable).toBe(false);
    expect(state.firstResponse.breached).toBe(false);
  });
});

describe("support configuration", () => {
  it("refuses a schedule whose windows overlap", async () => {
    const replaceSchedule = vi.fn<SupportRepository["replaceSchedule"]>();
    await expect(
      new SupportService(repository({ replaceSchedule })).replaceSchedule(context, [
        { weekday: 2, opensAt: "09:00", closesAt: "14:00" },
        { weekday: 2, opensAt: "13:00", closesAt: "18:00" }
      ])
    ).rejects.toMatchObject({ code: "INVALID_SCHEDULE" });
    expect(replaceSchedule).not.toHaveBeenCalled();
  });

  it("accepts a split shift", async () => {
    const replaceSchedule = vi.fn<SupportRepository["replaceSchedule"]>().mockResolvedValue(undefined);
    await new SupportService(repository({ replaceSchedule })).replaceSchedule(context, [
      { weekday: 2, opensAt: "09:00", closesAt: "13:00" },
      { weekday: 2, opensAt: "15:00", closesAt: "18:00" }
    ]);
    expect(replaceSchedule).toHaveBeenCalledOnce();
  });

  it("refuses a resolution target shorter than the first response", async () => {
    await expect(
      new SupportService(repository()).publishSlaTarget(context, {
        priority: "high",
        firstResponseMinutes: 240,
        resolutionMinutes: 60
      })
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("refuses a holiday that is not a date", async () => {
    await expect(new SupportService(repository()).addHoliday(context, "5 d'agost", null)).rejects.toMatchObject({
      code: "INVALID_INPUT"
    });
  });
});

describe("escalation", () => {
  const openedAt = new Date("2026-08-04T07:00:00Z");
  const candidate = (overrides: Partial<EscalationCandidate> = {}): EscalationCandidate => ({
    ticket: ticket({ openedAt }),
    pauses: [],
    recordedBreaches: [],
    ...overrides
  });

  it("records a missed first response once", async () => {
    const recordBreach = vi.fn<SupportRepository["recordBreach"]>().mockResolvedValue(undefined);
    const listEscalationCandidates = vi
      .fn<SupportRepository["listEscalationCandidates"]>()
      .mockResolvedValue([candidate()]);

    // Opened 09:00 Madrid with a sixty minute target, measured at 11:00.
    const result = await escalateBreachedTargets(
      repository({ recordBreach, listEscalationCandidates }),
      context,
      new Date("2026-08-04T09:00:00Z")
    );

    expect(result.recorded).toEqual([{ ticketId: "ticket-1", target: "first_response" }]);
    expect(recordBreach).toHaveBeenCalledOnce();
  });

  it("does not record the same breach on a later pass", async () => {
    // The pass runs on a schedule. Without this the log fills with one breach per minute.
    const recordBreach = vi.fn<SupportRepository["recordBreach"]>().mockResolvedValue(undefined);
    const listEscalationCandidates = vi
      .fn<SupportRepository["listEscalationCandidates"]>()
      .mockResolvedValue([candidate({ recordedBreaches: ["first_response"] })]);

    const result = await escalateBreachedTargets(
      repository({ recordBreach, listEscalationCandidates }),
      context,
      new Date("2026-08-04T09:00:00Z")
    );

    expect(result.recorded).toEqual([]);
    expect(recordBreach).not.toHaveBeenCalled();
  });

  it("leaves a ticket inside its target alone", async () => {
    const recordBreach = vi.fn<SupportRepository["recordBreach"]>().mockResolvedValue(undefined);
    const listEscalationCandidates = vi
      .fn<SupportRepository["listEscalationCandidates"]>()
      .mockResolvedValue([candidate()]);

    const result = await escalateBreachedTargets(
      repository({ recordBreach, listEscalationCandidates }),
      context,
      new Date("2026-08-04T07:30:00Z")
    );

    expect(result).toEqual({ checked: 1, recorded: [] });
  });

  it("does not count time the ticket spent waiting on somebody else", async () => {
    const recordBreach = vi.fn<SupportRepository["recordBreach"]>().mockResolvedValue(undefined);
    const listEscalationCandidates = vi
      .fn<SupportRepository["listEscalationCandidates"]>()
      .mockResolvedValue([
        candidate({ pauses: [{ from: new Date("2026-08-04T07:30:00Z"), to: new Date("2026-08-04T09:30:00Z") }] })
      ]);

    const result = await escalateBreachedTargets(
      repository({ recordBreach, listEscalationCandidates }),
      context,
      new Date("2026-08-04T09:30:00Z")
    );

    expect(result.recorded).toEqual([]);
  });

  it("records both targets when both have been missed", async () => {
    const recordBreach = vi.fn<SupportRepository["recordBreach"]>().mockResolvedValue(undefined);
    const listEscalationCandidates = vi
      .fn<SupportRepository["listEscalationCandidates"]>()
      .mockResolvedValue([candidate({ ticket: ticket({ openedAt, resolutionTargetMinutes: 60 }) })]);

    const result = await escalateBreachedTargets(
      repository({ recordBreach, listEscalationCandidates }),
      context,
      new Date("2026-08-04T09:00:00Z")
    );

    expect(result.recorded.map((entry) => entry.target)).toEqual(["first_response", "resolution"]);
  });
});

describe("inbox listing", () => {
  it("resolves each row's target state without asking per row", async () => {
    const loadCalendar = vi.fn<SupportRepository["loadCalendar"]>().mockResolvedValue(calendar);
    const listPausesForTickets = vi.fn<SupportRepository["listPausesForTickets"]>().mockResolvedValue({});
    const page = await new SupportService(repository({ loadCalendar, listPausesForTickets })).listInbox(
      context,
      { page: 1, pageSize: 25, sort: "opened_desc" },
      new Date("2026-08-04T09:00:00Z")
    );

    expect(page.items[0]!.sla.firstResponse.breached).toBe(true);
    // One calendar and one pause query for the whole page, however many rows it holds.
    expect(loadCalendar).toHaveBeenCalledOnce();
    expect(listPausesForTickets).toHaveBeenCalledOnce();
  });

  it("does not query anything else when the page is empty", async () => {
    const loadCalendar = vi.fn<SupportRepository["loadCalendar"]>();
    const listTickets = vi
      .fn<SupportRepository["listTickets"]>()
      .mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 25 });
    const page = await new SupportService(repository({ listTickets, loadCalendar })).listInbox(context, {
      page: 1,
      pageSize: 25,
      sort: "opened_desc"
    });

    expect(page.items).toEqual([]);
    expect(loadCalendar).not.toHaveBeenCalled();
  });
});

describe("ticket detail", () => {
  it("resolves the ticket, its conversation and the people it can go to in one call", async () => {
    const detail = await new SupportService(repository()).ticketDetail(
      context,
      "ticket-1",
      new Date("2026-08-04T09:00:00Z")
    );
    expect(detail.ticket.customerName).toBe("Client A");
    expect(detail.assignableMembers).toHaveLength(1);
    expect(detail.sla.firstResponse.breached).toBe(true);
  });

  it("reports a ticket that is not there rather than an empty page", async () => {
    const getTicketWithNames = vi.fn<SupportRepository["getTicketWithNames"]>().mockResolvedValue(null);
    await expect(
      new SupportService(repository({ getTicketWithNames })).ticketDetail(context, "missing")
    ).rejects.toMatchObject({ code: "TICKET_NOT_FOUND" });
  });
});

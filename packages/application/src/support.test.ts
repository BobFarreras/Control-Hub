import type { SupportCalendar, TenantContext, TicketStatus } from "@control-hub/domain";
import { describe, expect, it, vi } from "vitest";
import { SupportError, SupportService, stopsTheClock, type SupportRepository, type TicketRecord } from "./support.js";

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

const repository = (overrides: Partial<SupportRepository> = {}): SupportRepository => ({
  listTickets: vi
    .fn<SupportRepository["listTickets"]>()
    .mockResolvedValue({ items: [ticket()], total: 1, page: 1, pageSize: 25 }),
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
  addMessage: vi.fn<SupportRepository["addMessage"]>().mockResolvedValue({
    id: "message-1",
    ticketId: "ticket-1",
    authorMembershipId: "member",
    body: "Ho mirem",
    visibility: "customer",
    createdAt: new Date("2026-08-04T07:30:00Z")
  }),
  findMessageByExternalReference: vi.fn<SupportRepository["findMessageByExternalReference"]>().mockResolvedValue(null),
  markFirstResponse: vi.fn<SupportRepository["markFirstResponse"]>().mockResolvedValue(undefined),
  listPauses: vi.fn<SupportRepository["listPauses"]>().mockResolvedValue([]),
  currentTargets: vi
    .fn<SupportRepository["currentTargets"]>()
    .mockResolvedValue({ firstResponseMinutes: 60, resolutionMinutes: 480 }),
  loadCalendar: vi.fn<SupportRepository["loadCalendar"]>().mockResolvedValue(calendar),
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

import {
  canTransitionTicket,
  overlappingWindows,
  pausedTicketStatuses,
  slaState,
  ticketPriorities,
  type SlaPause,
  type SlaState,
  type SupportCalendar,
  type SupportWindow,
  type TenantContext,
  type TicketPriority,
  type TicketStatus
} from "@control-hub/domain";

export class SupportError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}

export type TicketRecord = {
  id: string;
  ticketNumber: number;
  customerId: string;
  projectId: string | null;
  subject: string;
  description: string;
  status: TicketStatus;
  priority: TicketPriority;
  category: string;
  assigneeMembershipId: string | null;
  openedAt: Date;
  firstResponseAt: Date | null;
  resolvedAt: Date | null;
  closedAt: Date | null;
  firstResponseTargetMinutes: number;
  resolutionTargetMinutes: number;
};

export type TicketMessageRecord = {
  id: string;
  ticketId: string;
  authorMembershipId: string | null;
  body: string;
  visibility: "internal" | "customer";
  createdAt: Date;
};

export type CreateTicketInput = {
  customerId: string;
  projectId?: string | undefined;
  subject: string;
  description: string;
  priority: TicketPriority;
  category?: string | undefined;
  assigneeMembershipId?: string | undefined;
};

export type AddMessageInput = {
  body: string;
  visibility: "internal" | "customer";
  externalReference?: string | undefined;
};

export type SlaTargets = { firstResponseMinutes: number; resolutionMinutes: number };

/** Which of a ticket's two targets is being spoken about. */
export type SlaTargetKind = "first_response" | "resolution";

/**
 * Everything the escalation pass needs about one ticket, fetched together.
 *
 * The pass runs over every open ticket, so asking the database per ticket for its pauses and
 * its already-recorded breaches would turn one sweep into three queries per ticket.
 */
export type EscalationCandidate = {
  ticket: TicketRecord;
  pauses: SlaPause[];
  recordedBreaches: SlaTargetKind[];
};

export type EscalationResult = { checked: number; recorded: { ticketId: string; target: SlaTargetKind }[] };

export type TicketListQuery = {
  page: number;
  pageSize: number;
  sort: "opened_desc" | "opened_asc" | "priority_desc" | "updated_desc";
  search?: string | undefined;
  status?: TicketStatus | undefined;
  priority?: TicketPriority | undefined;
  customerId?: string | undefined;
};

/** A row of the listing: the record plus the names a person needs instead of identifiers. */
export type TicketListRow = TicketRecord & { customerName: string; assigneeName: string | null };
export type TicketPage = { items: TicketListRow[]; total: number; page: number; pageSize: number };

/** A ticket with the state of its targets, which is what an inbox row has to show. */
export type InboxTicket = TicketListRow & { sla: SlaState };
export type InboxPage = { items: InboxTicket[]; total: number; page: number; pageSize: number };

export type SupportRepository = {
  listTickets(context: TenantContext, query: TicketListQuery): Promise<TicketPage>;
  createTicket(context: TenantContext, input: CreateTicketInput & { targets: SlaTargets }): Promise<TicketRecord>;
  getTicket(context: TenantContext, ticketId: string): Promise<TicketRecord | null>;
  updateStatus(context: TenantContext, ticketId: string, status: TicketStatus, at: Date): Promise<TicketRecord>;
  assign(context: TenantContext, ticketId: string, membershipId: string | null, at: Date): Promise<TicketRecord>;
  addMessage(context: TenantContext, ticketId: string, input: AddMessageInput): Promise<TicketMessageRecord>;
  findMessageByExternalReference(context: TenantContext, reference: string): Promise<TicketMessageRecord | null>;
  markFirstResponse(context: TenantContext, ticketId: string, at: Date): Promise<void>;
  listPauses(context: TenantContext, ticketId: string): Promise<SlaPause[]>;
  listPausesForTickets(context: TenantContext, ticketIds: readonly string[]): Promise<Record<string, SlaPause[]>>;
  currentTargets(context: TenantContext, priority: TicketPriority, at: Date): Promise<SlaTargets | null>;
  loadCalendar(context: TenantContext): Promise<SupportCalendar>;
  replaceSchedule(context: TenantContext, windows: readonly SupportWindow[]): Promise<void>;
  listHolidays(context: TenantContext): Promise<HolidayRecord[]>;
  addHoliday(context: TenantContext, holidayOn: string, label: string | null): Promise<HolidayRecord>;
  removeHoliday(context: TenantContext, holidayId: string): Promise<void>;
  listSlaTargets(context: TenantContext): Promise<SlaTargetRecord[]>;
  publishSlaTarget(context: TenantContext, input: PublishSlaTargetInput): Promise<SlaTargetRecord>;
  listEscalationCandidates(context: TenantContext): Promise<EscalationCandidate[]>;
  recordBreach(context: TenantContext, ticketId: string, target: SlaTargetKind, at: Date): Promise<void>;
};

export type HolidayRecord = { id: string; holidayOn: string; label: string | null };

export type SlaTargetRecord = {
  id: string;
  priority: TicketPriority;
  firstResponseMinutes: number;
  resolutionMinutes: number;
  effectiveFrom: Date;
};

export type PublishSlaTargetInput = {
  priority: TicketPriority;
  firstResponseMinutes: number;
  resolutionMinutes: number;
  effectiveFrom?: Date | undefined;
};

export class SupportService {
  constructor(private readonly repository: SupportRepository) {}

  /**
   * The targets in force today are copied onto the ticket rather than referenced, so its
   * compliance stays explicable after somebody publishes new ones.
   */
  async createTicket(context: TenantContext, input: CreateTicketInput, now = new Date()): Promise<TicketRecord> {
    if (!ticketPriorities.includes(input.priority)) throw new SupportError("INVALID_INPUT");
    if (input.subject.trim().length < 3) throw new SupportError("INVALID_INPUT");
    if (input.description.trim().length === 0) throw new SupportError("INVALID_INPUT");

    const targets = await this.repository.currentTargets(context, input.priority, now);
    if (!targets) throw new SupportError("SLA_TARGETS_NOT_CONFIGURED");

    return this.repository.createTicket(context, { ...input, targets });
  }

  listTickets(context: TenantContext, query: TicketListQuery): Promise<TicketPage> {
    return this.repository.listTickets(context, query);
  }

  /**
   * The inbox listing, with each row's target state resolved.
   *
   * Computed here rather than by the page asking per row: the calendar is loaded once and the
   * pauses for the whole page in one query, so opening the inbox costs three queries whether
   * it shows five tickets or a hundred.
   */
  async listInbox(context: TenantContext, query: TicketListQuery, now = new Date()): Promise<InboxPage> {
    const page = await this.repository.listTickets(context, query);
    if (page.items.length === 0) return { ...page, items: [] };

    const [calendar, pausesByTicket] = await Promise.all([
      this.repository.loadCalendar(context),
      this.repository.listPausesForTickets(
        context,
        page.items.map((ticket) => ticket.id)
      )
    ]);

    return {
      ...page,
      items: page.items.map((ticket) => ({
        ...ticket,
        sla: slaState({
          calendar,
          openedAt: ticket.openedAt,
          now,
          pauses: pausesByTicket[ticket.id] ?? [],
          firstResponseTargetMinutes: ticket.firstResponseTargetMinutes,
          resolutionTargetMinutes: ticket.resolutionTargetMinutes,
          ...(ticket.firstResponseAt ? { firstResponseAt: ticket.firstResponseAt } : {}),
          ...(ticket.resolvedAt ? { resolvedAt: ticket.resolvedAt } : {})
        })
      }))
    };
  }

  async getTicket(context: TenantContext, ticketId: string): Promise<TicketRecord> {
    const ticket = await this.repository.getTicket(context, ticketId);
    if (!ticket) throw new SupportError("TICKET_NOT_FOUND");
    return ticket;
  }

  async transition(
    context: TenantContext,
    ticketId: string,
    status: TicketStatus,
    now = new Date()
  ): Promise<TicketRecord> {
    const ticket = await this.repository.getTicket(context, ticketId);
    if (!ticket) throw new SupportError("TICKET_NOT_FOUND");
    if (!canTransitionTicket(ticket.status, status)) throw new SupportError("INVALID_TRANSITION");
    return this.repository.updateStatus(context, ticketId, status, now);
  }

  /**
   * Assigns or unassigns a ticket. Unassigning is allowed on purpose: leaving a ticket on
   * somebody who has left is worse than leaving it visibly on nobody.
   */
  async assign(
    context: TenantContext,
    ticketId: string,
    membershipId: string | null,
    now = new Date()
  ): Promise<TicketRecord> {
    const ticket = await this.repository.getTicket(context, ticketId);
    if (!ticket) throw new SupportError("TICKET_NOT_FOUND");
    if (ticket.status === "closed") throw new SupportError("TICKET_CLOSED");
    return this.repository.assign(context, ticketId, membershipId, now);
  }

  /**
   * Adding a message is where the first response is recorded, because that is what a first
   * response is: the first thing the customer could actually read. It is written once and
   * never moved, so a later reply cannot rewrite how quickly the ticket was answered.
   *
   * A repeated external reference returns the message already stored. The database holds the
   * unique constraint; this only spares the caller an error it can do nothing about.
   */
  async addMessage(
    context: TenantContext,
    ticketId: string,
    input: AddMessageInput,
    now = new Date()
  ): Promise<TicketMessageRecord> {
    if (input.body.trim().length === 0) throw new SupportError("INVALID_INPUT");

    if (input.externalReference) {
      const existing = await this.repository.findMessageByExternalReference(context, input.externalReference);
      if (existing) return existing;
    }

    const ticket = await this.repository.getTicket(context, ticketId);
    if (!ticket) throw new SupportError("TICKET_NOT_FOUND");
    if (ticket.status === "closed") throw new SupportError("TICKET_CLOSED");

    const message = await this.repository.addMessage(context, ticketId, input);
    if (input.visibility === "customer" && !ticket.firstResponseAt && message.authorMembershipId) {
      await this.repository.markFirstResponse(context, ticketId, now);
    }
    return message;
  }

  loadCalendar(context: TenantContext): Promise<SupportCalendar> {
    return this.repository.loadCalendar(context);
  }

  /**
   * The whole week is replaced at once. Editing windows one at a time leaves the schedule
   * briefly in a state nobody chose, and the SLA clock would read it mid-edit.
   */
  async replaceSchedule(context: TenantContext, windows: readonly SupportWindow[]): Promise<void> {
    const offending = overlappingWindows(windows);
    if (offending.length > 0) throw new SupportError("INVALID_SCHEDULE");
    if (windows.some((window) => window.weekday < 0 || window.weekday > 6)) {
      throw new SupportError("INVALID_SCHEDULE");
    }
    await this.repository.replaceSchedule(context, windows);
  }

  listHolidays(context: TenantContext): Promise<HolidayRecord[]> {
    return this.repository.listHolidays(context);
  }

  async addHoliday(context: TenantContext, holidayOn: string, label: string | null): Promise<HolidayRecord> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(holidayOn)) throw new SupportError("INVALID_INPUT");
    return this.repository.addHoliday(context, holidayOn, label);
  }

  removeHoliday(context: TenantContext, holidayId: string): Promise<void> {
    return this.repository.removeHoliday(context, holidayId);
  }

  listSlaTargets(context: TenantContext): Promise<SlaTargetRecord[]> {
    return this.repository.listSlaTargets(context);
  }

  /**
   * Publishing appends; it never edits. A ticket already open keeps the targets it copied, so
   * changing them today cannot turn last month's breaches into compliance.
   */
  async publishSlaTarget(context: TenantContext, input: PublishSlaTargetInput): Promise<SlaTargetRecord> {
    if (input.resolutionMinutes < input.firstResponseMinutes) throw new SupportError("INVALID_INPUT");
    if (input.firstResponseMinutes < 1) throw new SupportError("INVALID_INPUT");
    return this.repository.publishSlaTarget(context, input);
  }

  async slaFor(context: TenantContext, ticketId: string, now = new Date()): Promise<SlaState> {
    const ticket = await this.repository.getTicket(context, ticketId);
    if (!ticket) throw new SupportError("TICKET_NOT_FOUND");
    const [calendar, pauses] = await Promise.all([
      this.repository.loadCalendar(context),
      this.repository.listPauses(context, ticketId)
    ]);
    return slaState({
      calendar,
      openedAt: ticket.openedAt,
      now,
      pauses,
      firstResponseTargetMinutes: ticket.firstResponseTargetMinutes,
      resolutionTargetMinutes: ticket.resolutionTargetMinutes,
      ...(ticket.firstResponseAt ? { firstResponseAt: ticket.firstResponseAt } : {}),
      ...(ticket.resolvedAt ? { resolvedAt: ticket.resolvedAt } : {})
    });
  }
}

/**
 * Records the targets that have been missed since the last pass.
 *
 * Runs on a schedule, so it has to be safe to run again a minute later: a breach already
 * recorded is skipped rather than written a second time. Without that the event log fills with
 * the same breach every minute and the history stops being readable.
 *
 * It records; it does not decide what to do about it. Reassignment with a team of two is
 * noise, and who gets woken is a per-tenant policy rather than something the domain rules on.
 */
export async function escalateBreachedTargets(
  repository: SupportRepository,
  context: TenantContext,
  now = new Date()
): Promise<EscalationResult> {
  const [calendar, candidates] = await Promise.all([
    repository.loadCalendar(context),
    repository.listEscalationCandidates(context)
  ]);

  const recorded: EscalationResult["recorded"] = [];
  for (const candidate of candidates) {
    const state = slaState({
      calendar,
      openedAt: candidate.ticket.openedAt,
      now,
      pauses: candidate.pauses,
      firstResponseTargetMinutes: candidate.ticket.firstResponseTargetMinutes,
      resolutionTargetMinutes: candidate.ticket.resolutionTargetMinutes,
      ...(candidate.ticket.firstResponseAt ? { firstResponseAt: candidate.ticket.firstResponseAt } : {}),
      ...(candidate.ticket.resolvedAt ? { resolvedAt: candidate.ticket.resolvedAt } : {})
    });

    const breached: SlaTargetKind[] = [
      ...(state.firstResponse.breached ? (["first_response"] as const) : []),
      ...(state.resolution.breached ? (["resolution"] as const) : [])
    ];
    for (const target of breached) {
      if (candidate.recordedBreaches.includes(target)) continue;
      await repository.recordBreach(context, candidate.ticket.id, target, now);
      recorded.push({ ticketId: candidate.ticket.id, target });
    }
  }
  return { checked: candidates.length, recorded };
}

/** Whether a status stops the clock, for the adapter that records pause intervals. */
export function stopsTheClock(status: TicketStatus): boolean {
  return pausedTicketStatuses.includes(status);
}

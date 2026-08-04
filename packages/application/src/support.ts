import {
  canTransitionTicket,
  pausedTicketStatuses,
  slaState,
  ticketPriorities,
  type SlaPause,
  type SlaState,
  type SupportCalendar,
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

export type SupportRepository = {
  createTicket(context: TenantContext, input: CreateTicketInput & { targets: SlaTargets }): Promise<TicketRecord>;
  getTicket(context: TenantContext, ticketId: string): Promise<TicketRecord | null>;
  updateStatus(context: TenantContext, ticketId: string, status: TicketStatus, at: Date): Promise<TicketRecord>;
  addMessage(context: TenantContext, ticketId: string, input: AddMessageInput): Promise<TicketMessageRecord>;
  findMessageByExternalReference(context: TenantContext, reference: string): Promise<TicketMessageRecord | null>;
  markFirstResponse(context: TenantContext, ticketId: string, at: Date): Promise<void>;
  listPauses(context: TenantContext, ticketId: string): Promise<SlaPause[]>;
  currentTargets(context: TenantContext, priority: TicketPriority, at: Date): Promise<SlaTargets | null>;
  loadCalendar(context: TenantContext): Promise<SupportCalendar>;
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

/** Whether a status stops the clock, for the adapter that records pause intervals. */
export function stopsTheClock(status: TicketStatus): boolean {
  return pausedTicketStatuses.includes(status);
}

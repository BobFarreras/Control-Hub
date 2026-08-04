import { businessMinutesBetween, type SupportCalendar } from "./support-calendar.js";

export const ticketStatuses = ["new", "open", "waiting_customer", "waiting_third_party", "resolved", "closed"] as const;
export type TicketStatus = (typeof ticketStatuses)[number];

export const ticketPriorities = ["low", "normal", "high", "urgent"] as const;
export type TicketPriority = (typeof ticketPriorities)[number];

export const incidentSeverities = ["critical", "high", "normal", "low"] as const;
export type IncidentSeverity = (typeof incidentSeverities)[number];

/**
 * `closed` is terminal. `resolved` is not: a customer who says the problem is back should
 * reopen the ticket that already holds the history rather than start an empty one.
 *
 * There is no move straight from waiting to resolved. Either the answer arrived, and the
 * ticket goes back to `open`, or it did not; passing through `open` is what records which.
 */
const ticketTransitions: Record<TicketStatus, readonly TicketStatus[]> = {
  new: ["open", "waiting_customer", "waiting_third_party", "resolved", "closed"],
  open: ["waiting_customer", "waiting_third_party", "resolved", "closed"],
  waiting_customer: ["open", "waiting_third_party", "closed"],
  waiting_third_party: ["open", "waiting_customer", "closed"],
  resolved: ["open", "closed"],
  closed: []
};

export function canTransitionTicket(from: TicketStatus, to: TicketStatus): boolean {
  return ticketTransitions[from].includes(to);
}

/** The statuses whose time is somebody else's, and so does not count against a target. */
export const pausedTicketStatuses: readonly TicketStatus[] = ["waiting_customer", "waiting_third_party"];

/** A stretch the clock was stopped. `to` is null while the ticket is still waiting. */
export type SlaPause = { from: Date; to: Date | null };

export type SlaTargetState = {
  consumedMinutes: number;
  targetMinutes: number;
  breached: boolean;
  /** False when no working window is configured, so an unmeasured target reads as unmeasured. */
  measurable: boolean;
};

export type SlaStateInput = {
  calendar: SupportCalendar;
  openedAt: Date;
  now: Date;
  firstResponseAt?: Date | undefined;
  resolvedAt?: Date | undefined;
  pauses: readonly SlaPause[];
  firstResponseTargetMinutes: number;
  resolutionTargetMinutes: number;
};

export type SlaState = { firstResponse: SlaTargetState; resolution: SlaTargetState };

/**
 * How much of each target a ticket has spent.
 *
 * Time only counts inside the support hours, and time spent waiting on the customer or a
 * third party does not count at all: otherwise the measurement records how slowly they
 * answered rather than how quickly we did.
 *
 * Pauses are subtracted in working minutes rather than wall clock, because a pause that runs
 * over a weekend covers hours that were never counting in the first place.
 */
export function slaState(input: SlaStateInput): SlaState {
  const measurable = input.calendar.windows.length > 0;

  const elapsed = (until: Date): number => {
    if (!measurable || until <= input.openedAt) return 0;
    const worked = businessMinutesBetween(input.calendar, input.openedAt, until);
    const paused = input.pauses.reduce((total, pause) => {
      const from = pause.from < input.openedAt ? input.openedAt : pause.from;
      const to = pause.to && pause.to < until ? pause.to : until;
      return from < to ? total + businessMinutesBetween(input.calendar, from, to) : total;
    }, 0);
    return Math.max(0, worked - paused);
  };

  const target = (until: Date | undefined, targetMinutes: number): SlaTargetState => {
    const consumedMinutes = elapsed(until ?? input.now);
    return {
      consumedMinutes,
      targetMinutes,
      breached: measurable && consumedMinutes > targetMinutes,
      measurable
    };
  };

  return {
    firstResponse: target(input.firstResponseAt, input.firstResponseTargetMinutes),
    resolution: target(input.resolvedAt, input.resolutionTargetMinutes)
  };
}

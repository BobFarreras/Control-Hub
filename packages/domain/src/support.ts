import { businessMinutesBetween, type SupportCalendar } from "./support-calendar.js";

// ---------------------------------------------------------------------------
// Inbox SLA visual status
// ---------------------------------------------------------------------------

export const inboxSlaStatuses = ["on_time", "near", "breached", "paused", "not_configured"] as const;
export type InboxSlaStatus = (typeof inboxSlaStatuses)[number];

/** The percentage of the target at which a ticket is flagged as "near". */
const NEAR_THRESHOLD = 0.8;

/**
 * Derives a single visual status from the raw SLA state and the ticket's current status.
 *
 * Priority order:
 * 1. Not measurable → not_configured
 * 2. Clock paused (waiting_customer / waiting_third_party) → paused
 * 3. Breached → breached
 * 4. Consumed ≥ 80% of target → near
 * 5. Otherwise → on_time
 */
export function deriveInboxSlaStatus(
  consumedMinutes: number,
  targetMinutes: number,
  measurable: boolean,
  breached: boolean,
  isPaused: boolean
): InboxSlaStatus {
  if (!measurable) return "not_configured";
  if (isPaused) return "paused";
  if (breached) return "breached";
  if (consumedMinutes >= targetMinutes * NEAR_THRESHOLD) return "near";
  return "on_time";
}

// ---------------------------------------------------------------------------
// Inbox SLA detail (for the dialog)
// ---------------------------------------------------------------------------

/** Which of a ticket's two targets is active in the inbox row. */
export type InboxActiveTarget = "first_response" | "resolution";

export type InboxSlaDetail = {
  status: InboxSlaStatus;
  targetMinutes: number;
  consumedMinutes: number;
  remainingMinutes: number;
  /** ISO string — when the target was or will be missed. Null when not measurable. */
  estimatedDeadline: string | null;
  activeTarget: InboxActiveTarget;
};

export type InboxSlaInfo = {
  firstResponse: InboxSlaDetail;
  resolution: InboxSlaDetail;
};

/**
 * Estimates when a target will be breached based on the current consumption rate.
 *
 * Uses wall-clock time (not working minutes) for the estimate, because working-minute
 * rates vary with the schedule and a rough estimate is enough for a "you might miss it"
 * indicator. Returns null when there is no way to estimate (not measurable, already
 * breached, or consumed is zero).
 */
export function estimateDeadline(
  consumedMinutes: number,
  targetMinutes: number,
  measurable: boolean,
  breached: boolean,
  openedAt: Date,
  now: Date,
  pauses: readonly SlaPause[]
): string | null {
  if (!measurable || breached || consumedMinutes === 0) return null;

  // Wall-clock elapsed, minus pauses that are still open (their `to` is null).
  const wallMs = now.getTime() - openedAt.getTime();
  const pausedWallMs = pauses.reduce((total, pause) => {
    const to = pause.to ?? now;
    return total + (to.getTime() - pause.from.getTime());
  }, 0);
  const effectiveWallMs = Math.max(0, wallMs - pausedWallMs);
  if (effectiveWallMs === 0) return null;

  const ratePerMs = consumedMinutes / effectiveWallMs;
  const remainingMs = (targetMinutes - consumedMinutes) / ratePerMs;
  return new Date(now.getTime() + remainingMs).toISOString();
}

/**
 * Builds the full `InboxSlaInfo` for a ticket row.
 */
export function inboxSlaInfo(
  firstResponse: { consumedMinutes: number; targetMinutes: number; measurable: boolean; breached: boolean },
  resolution: { consumedMinutes: number; targetMinutes: number; measurable: boolean; breached: boolean },
  firstResponseAt: Date | undefined,
  resolvedAt: Date | undefined,
  openedAt: Date,
  now: Date,
  pauses: readonly SlaPause[]
): InboxSlaInfo {
  const isPaused = pauses.length > 0 && pauses[pauses.length - 1] !== undefined && !pauses[pauses.length - 1]!.to;

  const activeFirstResponse: InboxActiveTarget = "first_response";
  const activeResolution: InboxActiveTarget = "resolution";

  const frStatus = deriveInboxSlaStatus(
    firstResponse.consumedMinutes,
    firstResponse.targetMinutes,
    firstResponse.measurable,
    firstResponse.breached,
    isPaused
  );
  const rsStatus = deriveInboxSlaStatus(
    resolution.consumedMinutes,
    resolution.targetMinutes,
    resolution.measurable,
    resolution.breached,
    isPaused
  );

  return {
    firstResponse: {
      status: frStatus,
      targetMinutes: firstResponse.targetMinutes,
      consumedMinutes: firstResponse.consumedMinutes,
      remainingMinutes: Math.max(0, firstResponse.targetMinutes - firstResponse.consumedMinutes),
      estimatedDeadline: firstResponseAt
        ? null
        : estimateDeadline(
            firstResponse.consumedMinutes,
            firstResponse.targetMinutes,
            firstResponse.measurable,
            firstResponse.breached,
            openedAt,
            now,
            pauses
          ),
      activeTarget: activeFirstResponse
    },
    resolution: {
      status: rsStatus,
      targetMinutes: resolution.targetMinutes,
      consumedMinutes: resolution.consumedMinutes,
      remainingMinutes: Math.max(0, resolution.targetMinutes - resolution.consumedMinutes),
      estimatedDeadline: resolvedAt
        ? null
        : estimateDeadline(
            resolution.consumedMinutes,
            resolution.targetMinutes,
            resolution.measurable,
            resolution.breached,
            openedAt,
            now,
            pauses
          ),
      activeTarget: activeResolution
    }
  };
}

// ---------------------------------------------------------------------------
// Existing types
// ---------------------------------------------------------------------------

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

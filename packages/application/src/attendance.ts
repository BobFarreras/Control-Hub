import {
  canRecord,
  deriveSessions,
  hasPermission,
  isAcceptableEntry,
  liveEvents,
  needsReason,
  localDay,
  reconcile,
  stateOf,
  summariseDays,
  totalMinutes,
  type AttendanceDay,
  type AttendanceEvent,
  type AttendanceEventKind,
  type AttendancePolicy,
  type AttendanceSession,
  type AttendanceState,
  type ReconciliationLine,
  type TenantContext
} from "@control-hub/domain";

export class AttendanceError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}

export type AttendanceEventRecord = AttendanceEvent & {
  membershipId: string;
  recordedAt: Date;
  recordedByMembershipId: string;
  source: "web" | "api";
};

export type RecordPunchInput = {
  kind: AttendanceEventKind;
  /** Optional, unique per person: a retried request must not become a second punch. */
  clientReference?: string | undefined;
  source?: "web" | "api" | undefined;
};

export type CorrectionInput = {
  /** Whose record it is. Somebody else's needs `attendance:manage`. */
  membershipId: string;
  kind: AttendanceEventKind;
  /** When it really happened. This is the only way a past time reaches the log. */
  occurredAt: Date;
  reason: string;
  /** The entry this replaces, or absent when supplying one that was simply missing. */
  correctsEventId?: string | undefined;
};

export type AttendanceMonth = {
  membershipId: string;
  days: AttendanceDay[];
  sessions: AttendanceSession[];
  totalMinutes: number;
  /** Every event, corrected ones included: the history is the point of the record. */
  events: AttendanceEventRecord[];
};

export type MemberAttendance = {
  membershipId: string;
  memberName: string;
  days: AttendanceDay[];
  totalMinutes: number;
  /**
   * The clock ins and outs behind the totals.
   *
   * Carried because the export the accountancy reads is a list of days with a time in and a time
   * out, per `docs/specifications/attendance.md`, not a column of monthly totals. A total nobody
   * can take apart is a total nobody can check.
   */
  sessions: AttendanceSession[];
  /** How many entries in the period were written after the fact, so a reader knows to look. */
  declaredEntries: number;
};

export type ReconciliationRow = MemberAttendance & ReconciliationLine;

export type AttendanceRange = { from: string; to: string };

/**
 * What the service needs from storage, and nothing else.
 *
 * There is no update and no delete on purpose: the port cannot express them, so no adapter can
 * quietly grow one. The database refuses them too.
 */
export type AttendanceRepository = {
  appendEvent(
    context: TenantContext,
    input: {
      membershipId: string;
      kind: AttendanceEventKind;
      occurredAt?: Date | undefined;
      reason?: string | undefined;
      correctsEventId?: string | undefined;
      clientReference?: string | undefined;
      source: "web" | "api";
    }
  ): Promise<AttendanceEventRecord>;
  findEventByClientReference(context: TenantContext, reference: string): Promise<AttendanceEventRecord | null>;
  getEvent(context: TenantContext, eventId: string): Promise<AttendanceEventRecord | null>;
  listEvents(context: TenantContext, membershipId: string, range: AttendanceRange): Promise<AttendanceEventRecord[]>;
  listEventsForTenant(context: TenantContext, range: AttendanceRange): Promise<AttendanceEventRecord[]>;
  listMembers(context: TenantContext): Promise<{ membershipId: string; memberName: string }[]>;
  loggedMinutesByMember(context: TenantContext, range: AttendanceRange): Promise<Record<string, number>>;
  policy(context: TenantContext): Promise<AttendancePolicy & { timeZone: string }>;
};

/**
 * Working time records.
 *
 * Two rules decide almost every method here. The record of a person belongs to that person, so
 * reading and correcting their own needs no permission beyond `attendance:record`; and the time
 * of an ordinary punch is the server's, so nothing a caller sends can move it.
 */
export class AttendanceService {
  constructor(private readonly repository: AttendanceRepository) {}

  /**
   * Clocks in, out, or either end of a break.
   *
   * The kind is all the caller gets to choose. A repeated `clientReference` returns what was
   * already written rather than a second punch, because clocking in is exactly the action
   * somebody will retry when the network drops.
   */
  async punch(context: TenantContext, input: RecordPunchInput): Promise<AttendanceEventRecord> {
    if (!hasPermission(context, "attendance:record")) throw new AttendanceError("PERMISSION_DENIED");

    if (input.clientReference) {
      const existing = await this.repository.findEventByClientReference(context, input.clientReference);
      if (existing) return existing;
    }

    const policy = await this.repository.policy(context);
    const state = await this.stateOfMember(context, context.membershipId, policy.timeZone);
    if (!canRecord(state, input.kind, policy)) throw new AttendanceError("PUNCH_NOT_ALLOWED");

    // No `occurredAt`: the database gives both clocks the same transaction time, which is what
    // keeps an ordinary punch distinguishable from something declared afterwards.
    return this.repository.appendEvent(context, {
      membershipId: context.membershipId,
      kind: input.kind,
      clientReference: input.clientReference,
      source: input.source ?? "web"
    });
  }

  /**
   * Writes an entry that was not clocked when it happened: a wrong time put right, or one that
   * was never marked at all. Both demand a reason, and neither removes anything.
   */
  async correct(context: TenantContext, input: CorrectionInput, now = new Date()): Promise<AttendanceEventRecord> {
    const own = input.membershipId === context.membershipId;
    if (!own && !hasPermission(context, "attendance:manage")) throw new AttendanceError("PERMISSION_DENIED");
    if (own && !hasPermission(context, "attendance:record")) throw new AttendanceError("PERMISSION_DENIED");

    if (
      !isAcceptableEntry({
        occurredAt: input.occurredAt,
        recordedAt: now,
        reason: input.reason,
        correctsEventId: input.correctsEventId
      })
    )
      throw new AttendanceError("INVALID_CORRECTION");

    if (input.correctsEventId) {
      const target = await this.repository.getEvent(context, input.correctsEventId);
      if (!target) throw new AttendanceError("EVENT_NOT_FOUND");
      // Belt and braces with the composite foreign key: the message a person gets back should
      // say what is wrong, not surface a constraint name.
      if (target.membershipId !== input.membershipId) throw new AttendanceError("EVENT_NOT_FOUND");
    }

    return this.repository.appendEvent(context, {
      membershipId: input.membershipId,
      kind: input.kind,
      occurredAt: input.occurredAt,
      reason: input.reason,
      correctsEventId: input.correctsEventId,
      source: "web"
    });
  }

  /**
   * Where a person is right now, which is what the button in the header renders.
   *
   * It also answers whether this person manages the record, because the screens need to know
   * whether to offer the team view and this is the one call every page already makes. Asking a
   * second endpoint just to find out would be a request per navigation for a boolean.
   */
  async currentState(
    context: TenantContext
  ): Promise<{ state: AttendanceState; policy: AttendancePolicy; canManage: boolean }> {
    if (!hasPermission(context, "attendance:record")) throw new AttendanceError("PERMISSION_DENIED");
    const policy = await this.repository.policy(context);
    const state = await this.stateOfMember(context, context.membershipId, policy.timeZone);
    return {
      state,
      policy: { pausesEnabled: policy.pausesEnabled },
      canManage: hasPermission(context, "attendance:manage")
    };
  }

  /**
   * A person's month. Their own needs no permission beyond `attendance:record`; anybody else's
   * needs `attendance:manage`, and the caller is expected to audit that read.
   */
  async month(context: TenantContext, membershipId: string, range: AttendanceRange): Promise<AttendanceMonth> {
    const own = membershipId === context.membershipId;
    if (!own && !hasPermission(context, "attendance:manage")) throw new AttendanceError("PERMISSION_DENIED");
    if (own && !hasPermission(context, "attendance:record")) throw new AttendanceError("PERMISSION_DENIED");

    const { timeZone } = await this.repository.policy(context);
    const events = await this.repository.listEvents(context, membershipId, range);
    const sessions = deriveSessions(events, timeZone);
    const days = summariseDays(sessions);
    return { membershipId, days, sessions, totalMinutes: totalMinutes(days), events };
  }

  /** Everybody's, for the export the accountancy reads. */
  async everyone(context: TenantContext, range: AttendanceRange): Promise<MemberAttendance[]> {
    if (!hasPermission(context, "attendance:manage")) throw new AttendanceError("PERMISSION_DENIED");
    const { timeZone } = await this.repository.policy(context);
    const [events, members] = await Promise.all([
      this.repository.listEventsForTenant(context, range),
      this.repository.listMembers(context)
    ]);

    return members.map((member) => {
      const mine = events.filter((event) => event.membershipId === member.membershipId);
      const sessions = deriveSessions(mine, timeZone);
      const days = summariseDays(sessions);
      return {
        ...member,
        days,
        sessions,
        totalMinutes: totalMinutes(days),
        // Counted over every entry, corrected ones included: the question this answers is
        // "was this month touched after the fact", and a retired entry is part of that answer.
        declaredEntries: mine.filter((event) => needsReason(event)).length
      };
    });
  }

  /**
   * Hours worked against hours logged to projects and tickets.
   *
   * Needs `financials:read` on top of `attendance:manage`, because what it exposes is what
   * structural time costs. The two numbers travel side by side and are never added together.
   */
  async reconciliation(context: TenantContext, range: AttendanceRange): Promise<ReconciliationRow[]> {
    if (!hasPermission(context, "financials:read")) throw new AttendanceError("PERMISSION_DENIED");
    const [members, logged] = await Promise.all([
      this.everyone(context, range),
      this.repository.loggedMinutesByMember(context, range)
    ]);

    return members.map((member) => ({
      ...member,
      ...reconcile({ workedMinutes: member.totalMinutes, loggedMinutes: logged[member.membershipId] ?? 0 })
    }));
  }

  /**
   * The state is read from the log rather than stored, so it cannot drift from it. The window is
   * deliberately wide: somebody who clocked in yesterday evening and never clocked out is still
   * inside today, and a query that only looked at today would offer them the wrong button.
   */
  private async stateOfMember(
    context: TenantContext,
    membershipId: string,
    timeZone: string
  ): Promise<AttendanceState> {
    const now = new Date();
    const from = new Date(now.getTime() - 7 * 86_400_000);
    const events = await this.repository.listEvents(context, membershipId, {
      from: localDay(from, timeZone),
      to: localDay(now, timeZone)
    });
    return stateOf(liveEvents(events));
  }
}

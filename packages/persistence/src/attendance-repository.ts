import { randomUUID } from "node:crypto";
import {
  AttendanceError,
  type AttendanceEventRecord,
  type AttendanceRange,
  type AttendanceRepository
} from "@control-hub/application";
import { withTenant, type DatabaseClient } from "@control-hub/database";
import type { AttendancePolicy, TenantContext } from "@control-hub/domain";

const eventColumns = `id, membership_id as "membershipId", kind, occurred_at as "occurredAt",
  recorded_at as "recordedAt", recorded_by_membership_id as "recordedByMembershipId", source,
  corrects_event_id as "correctsEventId", reason`;

/**
 * The working time record against PostgreSQL.
 *
 * There is no update and no delete here, and there is nowhere to put one: the port does not
 * declare them, the trigger rejects them and the application role was never granted them. That
 * is three doors on the same threat, which is the right number for the one thing this module
 * exists to prevent.
 */
export class PostgresAttendanceRepository implements AttendanceRepository {
  constructor(private readonly database: DatabaseClient) {}

  /**
   * Writes one entry.
   *
   * `occurred_at` is left out of the statement for an ordinary punch so the column default and
   * `recorded_at` both take the transaction's `now()` and come out identical. Sending a time from
   * here would leave milliseconds between the two clocks and the database would, correctly, start
   * demanding a reason for every punch.
   */
  async appendEvent(
    context: TenantContext,
    input: Parameters<AttendanceRepository["appendEvent"]>[1]
  ): Promise<AttendanceEventRecord> {
    return withTenant(this.database, context.tenantId, async (tx) => {
      const id = randomUUID();
      const [event] = input.occurredAt
        ? await tx<AttendanceEventRecord[]>`
            insert into attendance_events (id, tenant_id, membership_id, kind, occurred_at, source,
              recorded_by_membership_id, corrects_event_id, reason, client_reference)
            values (${id}, ${context.tenantId}, ${input.membershipId}, ${input.kind}, ${input.occurredAt},
              ${input.source}, ${context.membershipId}, ${input.correctsEventId ?? null},
              ${input.reason ?? null}, ${input.clientReference ?? null})
            returning ${tx.unsafe(eventColumns)}`
        : await tx<AttendanceEventRecord[]>`
            insert into attendance_events (id, tenant_id, membership_id, kind, source,
              recorded_by_membership_id, client_reference)
            values (${id}, ${context.tenantId}, ${input.membershipId}, ${input.kind}, ${input.source},
              ${context.membershipId}, ${input.clientReference ?? null})
            returning ${tx.unsafe(eventColumns)}`;
      return event!;
    }).catch(mapConstraint);
  }

  async findEventByClientReference(context: TenantContext, reference: string): Promise<AttendanceEventRecord | null> {
    return withTenant(this.database, context.tenantId, async (tx) => {
      const [event] = await tx<AttendanceEventRecord[]>`
        select ${tx.unsafe(eventColumns)} from attendance_events
        where tenant_id = ${context.tenantId} and membership_id = ${context.membershipId}
          and client_reference = ${reference}`;
      return event ?? null;
    });
  }

  async getEvent(context: TenantContext, eventId: string): Promise<AttendanceEventRecord | null> {
    return withTenant(this.database, context.tenantId, async (tx) => {
      const [event] = await tx<AttendanceEventRecord[]>`
        select ${tx.unsafe(eventColumns)} from attendance_events
        where tenant_id = ${context.tenantId} and id = ${eventId}`;
      return event ?? null;
    });
  }

  /**
   * A person's entries over a range of local days.
   *
   * The range is widened by a day at each end and the domain then attributes each session to the
   * day it started. A shift that begins at 23:00 on the last day of the month is worked mostly in
   * the next one, and its clock out has to be in the result or the month would end with a session
   * that never closed.
   */
  listEvents(context: TenantContext, membershipId: string, range: AttendanceRange): Promise<AttendanceEventRecord[]> {
    return withTenant(
      this.database,
      context.tenantId,
      (tx) => tx<AttendanceEventRecord[]>`
        select ${tx.unsafe(eventColumns)} from attendance_events
        where tenant_id = ${context.tenantId} and membership_id = ${membershipId}
          and occurred_at >= (${range.from}::date - 1) and occurred_at < (${range.to}::date + 2)
        order by occurred_at, id`
    );
  }

  listEventsForTenant(context: TenantContext, range: AttendanceRange): Promise<AttendanceEventRecord[]> {
    return withTenant(
      this.database,
      context.tenantId,
      (tx) => tx<AttendanceEventRecord[]>`
        select ${tx.unsafe(eventColumns)} from attendance_events
        where tenant_id = ${context.tenantId}
          and occurred_at >= (${range.from}::date - 1) and occurred_at < (${range.to}::date + 2)
        order by membership_id, occurred_at, id`
    );
  }

  listMembers(context: TenantContext): Promise<{ membershipId: string; memberName: string }[]> {
    return withTenant(
      this.database,
      context.tenantId,
      (tx) => tx<{ membershipId: string; memberName: string }[]>`
        select m.id as "membershipId", u.name as "memberName"
        from memberships m join "user" u on u.id = m.user_id
        where m.tenant_id = ${context.tenantId} and m.status = 'active'
        order by u.name`
    );
  }

  /**
   * Minutes logged to projects and tickets per person, for the reconciliation.
   *
   * Read from `time_entries` by the day worked, which is a `date` and not an instant, so the
   * period means the same thing to both records. These minutes are never added to worked minutes:
   * they are the other half of a comparison.
   */
  async loggedMinutesByMember(context: TenantContext, range: AttendanceRange): Promise<Record<string, number>> {
    const rows = await withTenant(
      this.database,
      context.tenantId,
      (tx) => tx<{ membershipId: string; minutes: number }[]>`
        select membership_id as "membershipId", coalesce(sum(minutes), 0)::int as minutes
        from time_entries
        where tenant_id = ${context.tenantId} and spent_on between ${range.from}::date and ${range.to}::date
        group by membership_id`
    );
    return Object.fromEntries(rows.map((row) => [row.membershipId, row.minutes]));
  }

  /**
   * Whether this installation records breaks, and the zone its days are counted in.
   *
   * A tenant with no settings row falls back to breaks off and UTC rather than failing: the
   * safe default is the one that records less, and a missing row must not stop somebody clocking
   * in. The zone matters because a day is a local day, never a UTC one.
   */
  async policy(context: TenantContext): Promise<AttendancePolicy & { timeZone: string }> {
    const [settings] = await withTenant(
      this.database,
      context.tenantId,
      (tx) => tx<{ pausesEnabled: boolean; timeZone: string }[]>`
        select attendance_pauses_enabled as "pausesEnabled", timezone as "timeZone"
        from tenant_settings where tenant_id = ${context.tenantId}`
    );
    return settings ?? { pausesEnabled: false, timeZone: "UTC" };
  }
}

type DatabaseError = { code?: string; constraint_name?: string };

/**
 * Turns what the schema refuses into something a person can act on.
 *
 * Every branch here is a guarantee that lives in `0019_attendance.sql`. Reaching one means a
 * check in the service did not hold -- two requests racing, or a caller that is not the web app
 * -- so it is mapped rather than left to surface as a 500 with a constraint name in it.
 */
function mapConstraint(error: unknown): never {
  const databaseError = error as DatabaseError;
  const message = error instanceof Error ? error.message : "";
  if (message === "attendance_events is append-only") throw new AttendanceError("RECORD_IMMUTABLE");

  if (databaseError.code === "23505") {
    // A retry that raced the first request: both found no entry for the reference, both inserted.
    if ((databaseError.constraint_name ?? "").includes("client_reference"))
      throw new AttendanceError("DUPLICATE_CLIENT_REFERENCE");
    if ((databaseError.constraint_name ?? "").includes("corrects")) throw new AttendanceError("ALREADY_CORRECTED");
    throw new AttendanceError("DUPLICATE_ENTRY");
  }
  if (databaseError.code === "23514") throw new AttendanceError("INVALID_ENTRY");
  if (databaseError.code === "23503") throw new AttendanceError("EVENT_NOT_FOUND");
  throw error;
}

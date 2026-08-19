import { randomUUID } from "node:crypto";
import {
  AttendanceError,
  type AttendanceEventRecord,
  type AttendanceRange,
  type AttendanceRepository
} from "@control-hub/application";
import { withTenant, type DatabaseClient } from "@control-hub/database";
import type {
  AttendanceAbsence,
  AttendanceBlock,
  AttendanceHoliday,
  AttendanceNonWorkingDay,
  AttendancePolicy,
  AttendanceVacation,
  TenantContext
} from "@control-hub/domain";

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

  // Calendar methods

  async listHolidays(context: TenantContext, range: AttendanceRange): Promise<AttendanceHoliday[]> {
    return withTenant(
      this.database,
      context.tenantId,
      (tx) => tx<AttendanceHoliday[]>`
        select id, date::text, name
        from attendance_holidays
        where tenant_id = ${context.tenantId}
          and date between ${range.from}::date and ${range.to}::date
        order by date`
    );
  }

  async createHoliday(context: TenantContext, input: { date: string; name: string }): Promise<AttendanceHoliday> {
    return withTenant(this.database, context.tenantId, async (tx) => {
      const id = randomUUID();
      const [holiday] = await tx<AttendanceHoliday[]>`
        insert into attendance_holidays (id, tenant_id, date, name)
        values (${id}, ${context.tenantId}, ${input.date}::date, ${input.name})
        returning id, date::text, name`;
      return holiday!;
    }).catch(mapConstraint);
  }

  async deleteHoliday(context: TenantContext, holidayId: string): Promise<void> {
    await withTenant(this.database, context.tenantId, async (tx) => {
      await tx`delete from attendance_holidays where tenant_id = ${context.tenantId} and id = ${holidayId}`;
    });
  }

  async listNonWorkingDays(context: TenantContext): Promise<AttendanceNonWorkingDay[]> {
    return withTenant(
      this.database,
      context.tenantId,
      (tx) => tx<AttendanceNonWorkingDay[]>`
        select id, day_of_week as "dayOfWeek"
        from attendance_non_working_days
        where tenant_id = ${context.tenantId}
        order by day_of_week`
    );
  }

  async createNonWorkingDay(context: TenantContext, input: { dayOfWeek: number }): Promise<AttendanceNonWorkingDay> {
    return withTenant(this.database, context.tenantId, async (tx) => {
      const id = randomUUID();
      const [day] = await tx<AttendanceNonWorkingDay[]>`
        insert into attendance_non_working_days (id, tenant_id, day_of_week)
        values (${id}, ${context.tenantId}, ${input.dayOfWeek})
        returning id, day_of_week as "dayOfWeek"`;
      return day!;
    }).catch(mapConstraint);
  }

  async deleteNonWorkingDay(context: TenantContext, id: string): Promise<void> {
    await withTenant(this.database, context.tenantId, async (tx) => {
      await tx`delete from attendance_non_working_days where tenant_id = ${context.tenantId} and id = ${id}`;
    });
  }

  async listVacations(context: TenantContext, range: AttendanceRange): Promise<AttendanceVacation[]> {
    return withTenant(
      this.database,
      context.tenantId,
      (tx) => tx<AttendanceVacation[]>`
        select id, membership_id as "membershipId", start_date::text as "startDate",
          end_date::text as "endDate", status,
          approved_by_membership_id as "approvedByMembershipId",
          approved_at as "approvedAt", notes
        from attendance_vacations
        where tenant_id = ${context.tenantId}
          and (start_date, end_date) overlaps (${range.from}::date, ${range.to}::date)
        order by start_date`
    );
  }

  async listVacationsByMember(
    context: TenantContext,
    membershipId: string,
    range: AttendanceRange
  ): Promise<AttendanceVacation[]> {
    return withTenant(
      this.database,
      context.tenantId,
      (tx) => tx<AttendanceVacation[]>`
        select id, membership_id as "membershipId", start_date::text as "startDate",
          end_date::text as "endDate", status,
          approved_by_membership_id as "approvedByMembershipId",
          approved_at as "approvedAt", notes
        from attendance_vacations
        where tenant_id = ${context.tenantId} and membership_id = ${membershipId}
          and (start_date, end_date) overlaps (${range.from}::date, ${range.to}::date)
        order by start_date`
    );
  }

  async createVacation(
    context: TenantContext,
    input: { membershipId: string; startDate: string; endDate: string; notes?: string }
  ): Promise<AttendanceVacation> {
    return withTenant(this.database, context.tenantId, async (tx) => {
      const id = randomUUID();
      const [vacation] = await tx<AttendanceVacation[]>`
        insert into attendance_vacations (id, tenant_id, membership_id, start_date, end_date, notes)
        values (${id}, ${context.tenantId}, ${input.membershipId}, ${input.startDate}::date,
          ${input.endDate}::date, ${input.notes ?? null})
        returning id, membership_id as "membershipId", start_date::text as "startDate",
          end_date::text as "endDate", status,
          approved_by_membership_id as "approvedByMembershipId",
          approved_at as "approvedAt", notes`;
      return vacation!;
    }).catch(mapConstraint);
  }

  async updateVacationStatus(
    context: TenantContext,
    input: { vacationId: string; status: "approved" | "rejected"; approvedByMembershipId: string }
  ): Promise<AttendanceVacation> {
    return withTenant(this.database, context.tenantId, async (tx) => {
      const [vacation] = await tx<AttendanceVacation[]>`
        update attendance_vacations
        set status = ${input.status},
            approved_by_membership_id = ${input.approvedByMembershipId},
            approved_at = now()
        where tenant_id = ${context.tenantId} and id = ${input.vacationId}
        returning id, membership_id as "membershipId", start_date::text as "startDate",
          end_date::text as "endDate", status,
          approved_by_membership_id as "approvedByMembershipId",
          approved_at as "approvedAt", notes`;
      if (!vacation) throw new AttendanceError("VACATION_NOT_FOUND");
      return vacation;
    }).catch(mapConstraint);
  }

  async deleteVacation(context: TenantContext, vacationId: string, membershipId?: string): Promise<void> {
    await withTenant(this.database, context.tenantId, async (tx) => {
      if (membershipId) {
        await tx`delete from attendance_vacations
          where tenant_id = ${context.tenantId} and id = ${vacationId} and membership_id = ${membershipId}`;
      } else {
        await tx`delete from attendance_vacations where tenant_id = ${context.tenantId} and id = ${vacationId}`;
      }
    });
  }

  async listAbsences(context: TenantContext, range: AttendanceRange): Promise<AttendanceAbsence[]> {
    return withTenant(
      this.database,
      context.tenantId,
      (tx) => tx<AttendanceAbsence[]>`
        select id, membership_id as "membershipId", start_date::text as "startDate",
          end_date::text as "endDate", type, status,
          approved_by_membership_id as "approvedByMembershipId", approved_at as "approvedAt",
          document_url as "documentUrl", notes,
          created_by_membership_id as "createdByMembershipId"
        from attendance_absences
        where tenant_id = ${context.tenantId}
          and (start_date, end_date) overlaps (${range.from}::date, ${range.to}::date)
        order by start_date`
    );
  }

  async listAbsencesByMember(
    context: TenantContext,
    membershipId: string,
    range: AttendanceRange
  ): Promise<AttendanceAbsence[]> {
    return withTenant(
      this.database,
      context.tenantId,
      (tx) => tx<AttendanceAbsence[]>`
        select id, membership_id as "membershipId", start_date::text as "startDate",
          end_date::text as "endDate", type, status,
          approved_by_membership_id as "approvedByMembershipId", approved_at as "approvedAt",
          document_url as "documentUrl", notes,
          created_by_membership_id as "createdByMembershipId"
        from attendance_absences
        where tenant_id = ${context.tenantId} and membership_id = ${membershipId}
          and (start_date, end_date) overlaps (${range.from}::date, ${range.to}::date)
        order by start_date`
    );
  }

  async createAbsence(
    context: TenantContext,
    input: {
      membershipId: string;
      startDate: string;
      endDate: string;
      type: AttendanceAbsence["type"];
      documentUrl?: string;
      notes?: string;
      createdByMembershipId: string;
    }
  ): Promise<AttendanceAbsence> {
    return withTenant(this.database, context.tenantId, async (tx) => {
      const id = randomUUID();
      const [absence] = await tx<AttendanceAbsence[]>`
        insert into attendance_absences (id, tenant_id, membership_id, start_date, end_date, type, document_url, notes, created_by_membership_id)
        values (${id}, ${context.tenantId}, ${input.membershipId}, ${input.startDate}::date,
          ${input.endDate}::date, ${input.type}, ${input.documentUrl ?? null},
          ${input.notes ?? null}, ${input.createdByMembershipId})
        returning id, membership_id as "membershipId", start_date::text as "startDate",
          end_date::text as "endDate", type, status,
          approved_by_membership_id as "approvedByMembershipId", approved_at as "approvedAt",
          document_url as "documentUrl", notes,
          created_by_membership_id as "createdByMembershipId"`;
      return absence!;
    }).catch(mapConstraint);
  }

  async updateAbsenceStatus(
    context: TenantContext,
    input: { absenceId: string; status: "approved" | "rejected"; approvedByMembershipId: string }
  ): Promise<AttendanceAbsence> {
    return withTenant(this.database, context.tenantId, async (tx) => {
      const [absence] = await tx<AttendanceAbsence[]>`
        update attendance_absences
        set status = ${input.status}, approved_by_membership_id = ${input.approvedByMembershipId}, approved_at = now()
        where tenant_id = ${context.tenantId} and id = ${input.absenceId} and status = 'pending'
        returning id, membership_id as "membershipId", start_date::text as "startDate",
          end_date::text as "endDate", type, status,
          approved_by_membership_id as "approvedByMembershipId", approved_at as "approvedAt",
          document_url as "documentUrl", notes,
          created_by_membership_id as "createdByMembershipId"`;
      if (!absence) throw new AttendanceError("EVENT_NOT_FOUND");
      return absence;
    }).catch(mapConstraint);
  }

  async deleteAbsence(context: TenantContext, absenceId: string, membershipId?: string): Promise<void> {
    await withTenant(this.database, context.tenantId, async (tx) => {
      if (membershipId) {
        await tx`delete from attendance_absences
          where tenant_id = ${context.tenantId} and id = ${absenceId} and membership_id = ${membershipId}`;
      } else {
        await tx`delete from attendance_absences where tenant_id = ${context.tenantId} and id = ${absenceId}`;
      }
    });
  }

  async listBlocks(context: TenantContext, range: AttendanceRange): Promise<AttendanceBlock[]> {
    return withTenant(
      this.database,
      context.tenantId,
      (tx) => tx<AttendanceBlock[]>`
        select id, membership_id as "membershipId", date::text, start_time::text as "startTime",
          end_time::text as "endTime", reason
        from attendance_blocks
        where tenant_id = ${context.tenantId}
          and date between ${range.from}::date and ${range.to}::date
        order by date, start_time`
    );
  }

  async listBlocksByMember(
    context: TenantContext,
    membershipId: string,
    range: AttendanceRange
  ): Promise<AttendanceBlock[]> {
    return withTenant(
      this.database,
      context.tenantId,
      (tx) => tx<AttendanceBlock[]>`
        select id, membership_id as "membershipId", date::text, start_time::text as "startTime",
          end_time::text as "endTime", reason
        from attendance_blocks
        where tenant_id = ${context.tenantId} and membership_id = ${membershipId}
          and date between ${range.from}::date and ${range.to}::date
        order by date, start_time`
    );
  }

  async createBlock(
    context: TenantContext,
    input: { membershipId: string; date: string; startTime: string; endTime: string; reason: string }
  ): Promise<AttendanceBlock> {
    return withTenant(this.database, context.tenantId, async (tx) => {
      const id = randomUUID();
      const [block] = await tx<AttendanceBlock[]>`
        insert into attendance_blocks (id, tenant_id, membership_id, date, start_time, end_time, reason)
        values (${id}, ${context.tenantId}, ${input.membershipId}, ${input.date}::date,
          ${input.startTime}::time, ${input.endTime}::time, ${input.reason})
        returning id, membership_id as "membershipId", date::text, start_time::text as "startTime",
          end_time::text as "endTime", reason`;
      return block!;
    }).catch(mapConstraint);
  }

  async deleteBlock(context: TenantContext, blockId: string): Promise<void> {
    await withTenant(this.database, context.tenantId, async (tx) => {
      await tx`delete from attendance_blocks where tenant_id = ${context.tenantId} and id = ${blockId}`;
    });
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

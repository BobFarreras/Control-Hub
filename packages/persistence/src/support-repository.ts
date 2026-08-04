import { randomUUID } from "node:crypto";
import {
  stopsTheClock,
  SupportError,
  type AddMessageInput,
  type CreateTicketInput,
  type SlaTargets,
  type AssignableMember,
  type EscalationCandidate,
  type HolidayRecord,
  type PublishSlaTargetInput,
  type SlaTargetKind,
  type SlaTargetRecord,
  type SupportRepository,
  type TicketListQuery,
  type TicketDetail,
  type TicketListRow,
  type TicketPage,
  type TicketMessageRecord,
  type TicketRecord
} from "@control-hub/application";
import { withTenant, type DatabaseClient } from "@control-hub/database";
import type {
  SlaPause,
  SupportCalendar,
  SupportWindow,
  TenantContext,
  TicketPriority,
  TicketStatus
} from "@control-hub/domain";
import type postgres from "postgres";

// `ticket_number` is a bigint, which the driver hands back as a string. Casting here keeps the
// record honest about its own type instead of leaking a string through a field declared number.
const ticketColumns = `id, ticket_number::int as "ticketNumber", customer_id as "customerId", project_id as "projectId",
  subject, description, status, priority, category, assignee_membership_id as "assigneeMembershipId",
  opened_at as "openedAt", first_response_at as "firstResponseAt", resolved_at as "resolvedAt",
  closed_at as "closedAt", first_response_target_minutes as "firstResponseTargetMinutes",
  resolution_target_minutes as "resolutionTargetMinutes"`;

// The listing shows people, not identifiers, so it joins the names the inbox renders.
const listColumns = `t.id, t.ticket_number::int as "ticketNumber", t.customer_id as "customerId",
  t.project_id as "projectId", t.subject, t.description, t.status, t.priority, t.category,
  t.assignee_membership_id as "assigneeMembershipId", t.opened_at as "openedAt",
  t.first_response_at as "firstResponseAt", t.resolved_at as "resolvedAt", t.closed_at as "closedAt",
  t.first_response_target_minutes as "firstResponseTargetMinutes",
  t.resolution_target_minutes as "resolutionTargetMinutes",
  c.display_name as "customerName", u.name as "assigneeName"`;

const listFrom = `from tickets t
  join customers c on c.tenant_id = t.tenant_id and c.id = t.customer_id
  left join memberships m on m.tenant_id = t.tenant_id and m.id = t.assignee_membership_id
  left join "user" u on u.id = m.user_id`;

export class PostgresSupportRepository implements SupportRepository {
  constructor(private readonly database: DatabaseClient) {}

  /**
   * The readable number comes from a counter row, taken with `for update` inside the same
   * transaction as the insert. Deriving it from `max(ticket_number) + 1` would hand the same
   * number to two tickets opened at the same moment, and the unique constraint would then
   * fail one of them for no reason a user could understand.
   */
  async createTicket(context: TenantContext, input: CreateTicketInput & { targets: SlaTargets }) {
    return withTenant(this.database, context.tenantId, async (tx) => {
      await tx`insert into ticket_counters (tenant_id) values (${context.tenantId}) on conflict do nothing`;
      const [counter] = await tx<{ next_number: string }[]>`
        update ticket_counters set next_number = next_number + 1
        where tenant_id = ${context.tenantId} returning next_number - 1 as next_number`;
      const ticketNumber = Number(counter!.next_number);
      const id = randomUUID();

      const [ticket] = await tx<TicketRecord[]>`
        insert into tickets (id, tenant_id, ticket_number, customer_id, project_id, subject, description,
          priority, category, assignee_membership_id, first_response_target_minutes, resolution_target_minutes)
        values (${id}, ${context.tenantId}, ${ticketNumber}, ${input.customerId}, ${input.projectId ?? null},
          ${input.subject.trim()}, ${input.description.trim()}, ${input.priority}, ${input.category ?? "general"},
          ${input.assigneeMembershipId ?? null}, ${input.targets.firstResponseMinutes}, ${input.targets.resolutionMinutes})
        returning ${tx.unsafe(ticketColumns)}`;

      await this.writeEvent(tx, context, id, "created", null, "new");
      return ticket!;
    }).catch(mapConstraint);
  }

  async listTickets(context: TenantContext, query: TicketListQuery): Promise<TicketPage> {
    return withTenant(this.database, context.tenantId, async (tx) => {
      const search = query.search?.trim() || null;
      const offset = (query.page - 1) * query.pageSize;
      const items = await tx<TicketListRow[]>`
        select ${tx.unsafe(listColumns)} ${tx.unsafe(listFrom)}
        where t.tenant_id = ${context.tenantId}
          and (${query.status ?? null}::text is null or t.status = ${query.status ?? null})
          and (${query.priority ?? null}::text is null or t.priority = ${query.priority ?? null})
          and (${query.customerId ?? null}::uuid is null or t.customer_id = ${query.customerId ?? null}::uuid)
          and (${query.search?.trim() || null}::text is null or t.subject ilike '%' || ${query.search?.trim() || null} || '%'
            or t.ticket_number::text = ${query.search?.trim() || null})
        order by
          case when ${query.sort} = 'opened_asc' then t.opened_at end asc,
          case when ${query.sort} = 'priority_desc'
            then array_position(array['low','normal','high','urgent']::text[], t.priority) end desc,
          case when ${query.sort} = 'updated_desc' then t.updated_at end desc,
          t.opened_at desc, t.id
        limit ${query.pageSize} offset ${offset}`;
      const [count] = await tx<{ total: string }[]>`
        select count(*)::text as total from tickets
        where tenant_id = ${context.tenantId}
          and (${query.status ?? null}::text is null or status = ${query.status ?? null})
          and (${query.priority ?? null}::text is null or priority = ${query.priority ?? null})
          and (${query.customerId ?? null}::uuid is null or customer_id = ${query.customerId ?? null}::uuid)
          and (${search}::text is null or subject ilike '%' || ${search} || '%'
            or ticket_number::text = ${search})`;
      return { items, total: Number(count!.total), page: query.page, pageSize: query.pageSize };
    });
  }

  async getTicket(context: TenantContext, ticketId: string) {
    return withTenant(this.database, context.tenantId, async (tx) => {
      const [ticket] = await tx<TicketRecord[]>`
        select ${tx.unsafe(ticketColumns)} from tickets
        where tenant_id = ${context.tenantId} and id = ${ticketId}`;
      return ticket ?? null;
    });
  }

  /**
   * The status change and the event that records it are written together: an event log with
   * gaps cannot answer how long a ticket waited, and the pause intervals are derived from it.
   */
  async updateStatus(context: TenantContext, ticketId: string, status: TicketStatus, at: Date) {
    return withTenant(this.database, context.tenantId, async (tx) => {
      const [current] = await tx<{ status: TicketStatus }[]>`
        select status from tickets where tenant_id = ${context.tenantId} and id = ${ticketId} for update`;
      if (!current) throw new SupportError("TICKET_NOT_FOUND");

      const [ticket] = await tx<TicketRecord[]>`
        update tickets set status = ${status}, updated_at = ${at},
          resolved_at = case when ${status} = 'resolved' then ${at} else resolved_at end,
          closed_at = case when ${status} = 'closed' then ${at} else closed_at end
        where tenant_id = ${context.tenantId} and id = ${ticketId}
        returning ${tx.unsafe(ticketColumns)}`;

      await this.writeEvent(tx, context, ticketId, "status_changed", current.status, status);
      return ticket!;
    });
  }

  async assign(context: TenantContext, ticketId: string, membershipId: string | null, at: Date) {
    return withTenant(this.database, context.tenantId, async (tx) => {
      const [current] = await tx<{ assignee_membership_id: string | null }[]>`
        select assignee_membership_id from tickets
        where tenant_id = ${context.tenantId} and id = ${ticketId} for update`;
      if (!current) throw new SupportError("TICKET_NOT_FOUND");

      const [ticket] = await tx<TicketRecord[]>`
        update tickets set assignee_membership_id = ${membershipId}, updated_at = ${at}
        where tenant_id = ${context.tenantId} and id = ${ticketId}
        returning ${tx.unsafe(ticketColumns)}`;

      await this.writeEvent(tx, context, ticketId, "assigned", current.assignee_membership_id, membershipId);
      return ticket!;
    }).catch(mapConstraint);
  }

  async addMessage(context: TenantContext, ticketId: string, input: AddMessageInput) {
    return withTenant(this.database, context.tenantId, async (tx) => {
      const [message] = await tx<TicketMessageRecord[]>`
        insert into ticket_messages (id, tenant_id, ticket_id, author_membership_id, body, visibility, external_reference)
        values (${randomUUID()}, ${context.tenantId}, ${ticketId}, ${context.membershipId}, ${input.body.trim()},
          ${input.visibility}, ${input.externalReference ?? null})
        returning id, ticket_id as "ticketId", author_membership_id as "authorMembershipId",
          body, visibility, created_at as "createdAt"`;
      return message!;
    }).catch(mapConstraint);
  }

  async getTicketWithNames(context: TenantContext, ticketId: string): Promise<TicketDetail["ticket"] | null> {
    return withTenant(this.database, context.tenantId, async (tx) => {
      const [ticket] = await tx<TicketDetail["ticket"][]>`
        select ${tx.unsafe(listColumns)} ${tx.unsafe(listFrom)}
        where t.tenant_id = ${context.tenantId} and t.id = ${ticketId}`;
      return ticket ?? null;
    });
  }

  async listMessages(context: TenantContext, ticketId: string) {
    return withTenant(
      this.database,
      context.tenantId,
      (tx) => tx<TicketMessageRecord[]>`
        select m.id, m.ticket_id as "ticketId", m.author_membership_id as "authorMembershipId",
          m.body, m.visibility, m.created_at as "createdAt", u.name as "authorName"
        from ticket_messages m
        left join memberships ms on ms.tenant_id = m.tenant_id and ms.id = m.author_membership_id
        left join "user" u on u.id = ms.user_id
        where m.tenant_id = ${context.tenantId} and m.ticket_id = ${ticketId}
        order by m.created_at asc`
    );
  }

  async listAssignableMembers(context: TenantContext): Promise<AssignableMember[]> {
    return withTenant(
      this.database,
      context.tenantId,
      (tx) => tx<AssignableMember[]>`
        select m.id as "membershipId", u.name
        from memberships m join "user" u on u.id = m.user_id
        where m.tenant_id = ${context.tenantId} and m.status = 'active'
        order by u.name`
    );
  }

  async findMessageByExternalReference(context: TenantContext, reference: string) {
    return withTenant(this.database, context.tenantId, async (tx) => {
      const [message] = await tx<TicketMessageRecord[]>`
        select id, ticket_id as "ticketId", author_membership_id as "authorMembershipId",
          body, visibility, created_at as "createdAt"
        from ticket_messages where tenant_id = ${context.tenantId} and external_reference = ${reference}`;
      return message ?? null;
    });
  }

  /** `where first_response_at is null` is the guarantee: a later reply cannot move it. */
  async markFirstResponse(context: TenantContext, ticketId: string, at: Date) {
    await withTenant(
      this.database,
      context.tenantId,
      (tx) => tx`
        update tickets set first_response_at = ${at}, updated_at = ${at}
        where tenant_id = ${context.tenantId} and id = ${ticketId} and first_response_at is null`
    );
  }

  /**
   * Pause intervals are read from the event log rather than stored separately, so there is one
   * source of truth for what happened and no second record to drift out of step with it.
   */
  async listPauses(context: TenantContext, ticketId: string): Promise<SlaPause[]> {
    return withTenant(this.database, context.tenantId, async (tx) => {
      const events = await tx<{ to_value: TicketStatus; created_at: Date }[]>`
        select to_value, created_at from ticket_events
        where tenant_id = ${context.tenantId} and ticket_id = ${ticketId} and type = 'status_changed'
        order by created_at asc`;

      return pausesFromEvents(events);
    });
  }

  async listPausesForTickets(context: TenantContext, ticketIds: readonly string[]) {
    if (ticketIds.length === 0) return {};
    return withTenant(this.database, context.tenantId, async (tx) => {
      const events = await tx<{ ticket_id: string; to_value: TicketStatus; created_at: Date }[]>`
        select ticket_id, to_value, created_at from ticket_events
        where tenant_id = ${context.tenantId} and ticket_id in ${tx(ticketIds as string[])}
          and type = 'status_changed' order by ticket_id, created_at asc`;
      const byTicket: Record<string, SlaPause[]> = {};
      for (const ticketId of ticketIds) {
        byTicket[ticketId] = pausesFromEvents(events.filter((event) => event.ticket_id === ticketId));
      }
      return byTicket;
    });
  }

  async currentTargets(context: TenantContext, priority: TicketPriority, at: Date) {
    return withTenant(this.database, context.tenantId, async (tx) => {
      const [target] = await tx<SlaTargets[]>`
        select first_response_minutes as "firstResponseMinutes", resolution_minutes as "resolutionMinutes"
        from sla_targets
        where tenant_id = ${context.tenantId} and priority = ${priority} and effective_from <= ${at}
        order by effective_from desc limit 1`;
      return target ?? null;
    });
  }

  async loadCalendar(context: TenantContext): Promise<SupportCalendar> {
    return withTenant(this.database, context.tenantId, async (tx) => {
      const [settings] = await tx<{ timezone: string }[]>`
        select timezone from tenant_settings where tenant_id = ${context.tenantId}`;
      const windows = await tx<{ weekday: number; opens_at: string; closes_at: string }[]>`
        select weekday, to_char(opens_at, 'HH24:MI') as opens_at, to_char(closes_at, 'HH24:MI') as closes_at
        from support_schedule where tenant_id = ${context.tenantId} order by weekday, opens_at`;
      const holidays = await tx<{ holiday_on: string }[]>`
        select to_char(holiday_on, 'YYYY-MM-DD') as holiday_on
        from support_holidays where tenant_id = ${context.tenantId}`;

      return {
        timeZone: settings?.timezone ?? "UTC",
        windows: windows.map((row) => ({ weekday: row.weekday, opensAt: row.opens_at, closesAt: row.closes_at })),
        holidays: holidays.map((row) => row.holiday_on)
      };
    });
  }

  /**
   * Deleted and reinserted in one transaction. Replacing window by window would leave the
   * schedule briefly in a shape nobody chose, and the SLA clock reads it on every request.
   */
  async replaceSchedule(context: TenantContext, windows: readonly SupportWindow[]) {
    await withTenant(this.database, context.tenantId, async (tx) => {
      await tx`delete from support_schedule where tenant_id = ${context.tenantId}`;
      for (const window of windows) {
        await tx`insert into support_schedule (id, tenant_id, weekday, opens_at, closes_at)
          values (${randomUUID()}, ${context.tenantId}, ${window.weekday}, ${window.opensAt}, ${window.closesAt})`;
      }
    });
  }

  async listHolidays(context: TenantContext): Promise<HolidayRecord[]> {
    return withTenant(
      this.database,
      context.tenantId,
      (tx) => tx<HolidayRecord[]>`
        select id, to_char(holiday_on, 'YYYY-MM-DD') as "holidayOn", label
        from support_holidays where tenant_id = ${context.tenantId} order by holiday_on`
    );
  }

  async addHoliday(context: TenantContext, holidayOn: string, label: string | null) {
    return withTenant(this.database, context.tenantId, async (tx) => {
      const [holiday] = await tx<HolidayRecord[]>`
        insert into support_holidays (id, tenant_id, holiday_on, label)
        values (${randomUUID()}, ${context.tenantId}, ${holidayOn}::date, ${label})
        returning id, to_char(holiday_on, 'YYYY-MM-DD') as "holidayOn", label`;
      return holiday!;
    }).catch(mapConstraint);
  }

  async removeHoliday(context: TenantContext, holidayId: string) {
    await withTenant(
      this.database,
      context.tenantId,
      (tx) => tx`delete from support_holidays where tenant_id = ${context.tenantId} and id = ${holidayId}`
    );
  }

  async listSlaTargets(context: TenantContext): Promise<SlaTargetRecord[]> {
    return withTenant(
      this.database,
      context.tenantId,
      (tx) => tx<SlaTargetRecord[]>`
        select id, priority, first_response_minutes as "firstResponseMinutes",
          resolution_minutes as "resolutionMinutes", effective_from as "effectiveFrom"
        from sla_targets where tenant_id = ${context.tenantId}
        order by priority, effective_from desc`
    );
  }

  /** Appends a row; the append-only trigger is what stops anyone editing an earlier one. */
  async publishSlaTarget(context: TenantContext, input: PublishSlaTargetInput) {
    return withTenant(this.database, context.tenantId, async (tx) => {
      const [target] = await tx<SlaTargetRecord[]>`
        insert into sla_targets (id, tenant_id, priority, first_response_minutes, resolution_minutes, effective_from)
        values (${randomUUID()}, ${context.tenantId}, ${input.priority}, ${input.firstResponseMinutes},
          ${input.resolutionMinutes}, ${input.effectiveFrom ?? new Date()})
        returning id, priority, first_response_minutes as "firstResponseMinutes",
          resolution_minutes as "resolutionMinutes", effective_from as "effectiveFrom"`;
      return target!;
    }).catch(mapConstraint);
  }

  /**
   * Everything the escalation pass needs, in three queries rather than three per ticket.
   * Resolved and closed tickets are excluded: their clocks have already stopped.
   */
  async listEscalationCandidates(context: TenantContext): Promise<EscalationCandidate[]> {
    return withTenant(this.database, context.tenantId, async (tx) => {
      const tickets = await tx<TicketRecord[]>`
        select ${tx.unsafe(ticketColumns)} from tickets
        where tenant_id = ${context.tenantId} and status not in ('resolved', 'closed')`;
      if (tickets.length === 0) return [];
      const ids = tickets.map((ticket) => ticket.id);

      const events = await tx<{ ticket_id: string; to_value: TicketStatus; created_at: Date }[]>`
        select ticket_id, to_value, created_at from ticket_events
        where tenant_id = ${context.tenantId} and ticket_id in ${tx(ids)}
          and type = 'status_changed' order by ticket_id, created_at asc`;
      const breaches = await tx<{ ticket_id: string; to_value: SlaTargetKind }[]>`
        select ticket_id, to_value from ticket_events
        where tenant_id = ${context.tenantId} and ticket_id in ${tx(ids)} and type = 'sla_breached'`;

      return tickets.map((ticket) => ({
        ticket,
        pauses: pausesFromEvents(events.filter((event) => event.ticket_id === ticket.id)),
        recordedBreaches: breaches.filter((row) => row.ticket_id === ticket.id).map((row) => row.to_value)
      }));
    });
  }

  async recordBreach(context: TenantContext, ticketId: string, target: SlaTargetKind, at: Date) {
    await withTenant(this.database, context.tenantId, async (tx) => {
      await tx`
        insert into ticket_events (id, tenant_id, ticket_id, actor_membership_id, type, to_value, created_at)
        values (${randomUUID()}, ${context.tenantId}, ${ticketId}, null, 'sla_breached', ${target}, ${at})`;
    });
  }

  private async writeEvent(
    tx: postgres.TransactionSql,
    context: TenantContext,
    ticketId: string,
    type: string,
    fromValue: string | null,
    toValue: string | null
  ) {
    await tx`
      insert into ticket_events (id, tenant_id, ticket_id, actor_membership_id, type, from_value, to_value)
      values (${randomUUID()}, ${context.tenantId}, ${ticketId}, ${context.membershipId}, ${type}, ${fromValue}, ${toValue})`;
  }
}

type DatabaseError = { code?: string; constraint_name?: string };

function mapConstraint(error: unknown): never {
  const databaseError = error as DatabaseError;
  if (databaseError.code === "23505" && databaseError.constraint_name?.includes("external_reference")) {
    throw new SupportError("DUPLICATE_EXTERNAL_REFERENCE");
  }
  if (databaseError.code === "23505") throw new SupportError("DUPLICATE_ENTRY");
  if (databaseError.code === "23503") throw new SupportError("CUSTOMER_NOT_FOUND");
  if (databaseError.code === "23514") throw new SupportError("INVALID_INPUT");
  throw error;
}

/**
 * Turns a ticket's status history into the stretches its clock was stopped.
 *
 * A pause with no end means the ticket is still waiting, which the domain reads as "until
 * now" rather than as a pause of zero length.
 */
function pausesFromEvents(events: readonly { to_value: TicketStatus; created_at: Date }[]): SlaPause[] {
  const pauses: SlaPause[] = [];
  let openedPauseAt: Date | null = null;
  for (const event of events) {
    if (stopsTheClock(event.to_value)) {
      openedPauseAt ??= event.created_at;
    } else if (openedPauseAt) {
      pauses.push({ from: openedPauseAt, to: event.created_at });
      openedPauseAt = null;
    }
  }
  if (openedPauseAt) pauses.push({ from: openedPauseAt, to: null });
  return pauses;
}

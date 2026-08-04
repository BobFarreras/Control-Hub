import { randomUUID } from "node:crypto";
import {
  stopsTheClock,
  SupportError,
  type AddMessageInput,
  type CreateTicketInput,
  type SlaTargets,
  type SupportRepository,
  type TicketListQuery,
  type TicketPage,
  type TicketMessageRecord,
  type TicketRecord
} from "@control-hub/application";
import { withTenant, type DatabaseClient } from "@control-hub/database";
import type { SlaPause, SupportCalendar, TenantContext, TicketPriority, TicketStatus } from "@control-hub/domain";
import type postgres from "postgres";

// `ticket_number` is a bigint, which the driver hands back as a string. Casting here keeps the
// record honest about its own type instead of leaking a string through a field declared number.
const ticketColumns = `id, ticket_number::int as "ticketNumber", customer_id as "customerId", project_id as "projectId",
  subject, description, status, priority, category, assignee_membership_id as "assigneeMembershipId",
  opened_at as "openedAt", first_response_at as "firstResponseAt", resolved_at as "resolvedAt",
  closed_at as "closedAt", first_response_target_minutes as "firstResponseTargetMinutes",
  resolution_target_minutes as "resolutionTargetMinutes"`;

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
      const items = await tx<TicketRecord[]>`
        select ${tx.unsafe(ticketColumns)} from tickets
        where tenant_id = ${context.tenantId}
          and (${query.status ?? null}::text is null or status = ${query.status ?? null})
          and (${query.priority ?? null}::text is null or priority = ${query.priority ?? null})
          and (${query.customerId ?? null}::uuid is null or customer_id = ${query.customerId ?? null}::uuid)
          and (${search}::text is null or subject ilike '%' || ${search} || '%'
            or ticket_number::text = ${search})
        order by
          case when ${query.sort} = 'opened_asc' then opened_at end asc,
          case when ${query.sort} = 'priority_desc'
            then array_position(array['low','normal','high','urgent']::text[], priority) end desc,
          case when ${query.sort} = 'updated_desc' then updated_at end desc,
          opened_at desc, id
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
      // Still waiting: the pause has no end yet, and the domain reads that as "until now".
      if (openedPauseAt) pauses.push({ from: openedPauseAt, to: null });
      return pauses;
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
  if (databaseError.code === "23503") throw new SupportError("CUSTOMER_NOT_FOUND");
  throw error;
}

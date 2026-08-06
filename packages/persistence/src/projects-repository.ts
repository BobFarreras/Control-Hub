import { randomUUID } from "node:crypto";
import {
  ProjectsError,
  type BillingRateRecord,
  type CostRateRecord,
  type CreateProjectInput,
  type ProfitabilityInput,
  type ProjectDetail,
  type ProjectEventRecord,
  type ProjectListQuery,
  type ProjectListRow,
  type ProjectPage,
  type ProjectRecord,
  type ProjectsRepository,
  type PublishBillingRateInput,
  type PublishCostRateInput,
  type TimeEntryListQuery,
  type TimeEntryPage,
  type TimeEntryListRow,
  type TimeEntryRecord,
  type TimeEntryWrite
} from "@control-hub/application";
import { withTenant, type DatabaseClient } from "@control-hub/database";
import type { DatedRate, IsoDate, ProjectStatus, TenantContext } from "@control-hub/domain";
import type postgres from "postgres";

const projectColumns = `id, customer_id as "customerId", code, name, description, status,
  owner_membership_id as "ownerMembershipId", started_at as "startedAt", due_at as "dueAt",
  closed_at as "closedAt", created_at as "createdAt"`;

/**
 * The minutes that belong to a project: those logged against it, plus those logged against a
 * ticket that carries it. Support work on a project is work on the project, and leaving it out
 * would report a margin that quietly ignores the hours somebody actually spent.
 */
const projectMinutes = `(select coalesce(sum(e.minutes), 0) from time_entries e
  left join tickets tk on tk.tenant_id = e.tenant_id and tk.id = e.ticket_id
  where e.tenant_id = p.tenant_id and (e.project_id = p.id or tk.project_id = p.id))::int as "loggedMinutes"`;

const projectListColumns = `p.id, p.customer_id as "customerId", p.code, p.name, p.description, p.status,
  p.owner_membership_id as "ownerMembershipId", p.started_at as "startedAt", p.due_at as "dueAt",
  p.closed_at as "closedAt", p.created_at as "createdAt",
  c.display_name as "customerName", u.name as "ownerName", ${projectMinutes}`;

const projectListFrom = `from projects p
  join customers c on c.tenant_id = p.tenant_id and c.id = p.customer_id
  left join memberships m on m.tenant_id = p.tenant_id and m.id = p.owner_membership_id
  left join "user" u on u.id = m.user_id`;

// Dates cross the boundary as `YYYY-MM-DD` text rather than as timestamps, so the day somebody
// worked stays the day they worked no matter which time zone reads it back.
const timeEntryColumns = `id, membership_id as "membershipId", project_id as "projectId", ticket_id as "ticketId",
  to_char(spent_on, 'YYYY-MM-DD') as "spentOn", minutes, billable, note, created_at as "createdAt"`;

export class PostgresProjectsRepository implements ProjectsRepository {
  constructor(private readonly database: DatabaseClient) {}

  async listProjects(context: TenantContext, query: ProjectListQuery): Promise<ProjectPage> {
    return withTenant(this.database, context.tenantId, async (tx) => {
      const search = query.search?.trim() || null;
      const offset = (query.page - 1) * query.pageSize;
      const items = await tx<ProjectListRow[]>`
        select ${tx.unsafe(projectListColumns)} ${tx.unsafe(projectListFrom)}
        where p.tenant_id = ${context.tenantId}
          and (${query.status ?? null}::text is null or p.status = ${query.status ?? null})
          and (${query.customerId ?? null}::uuid is null or p.customer_id = ${query.customerId ?? null}::uuid)
          and (${search}::text is null or p.name ilike '%' || ${search} || '%' or p.code ilike '%' || ${search} || '%')
        order by
          case when ${query.sort} = 'created_asc' then p.created_at end asc,
          case when ${query.sort} = 'due_asc' then p.due_at end asc nulls last,
          case when ${query.sort} = 'name_asc' then p.name end asc,
          p.created_at desc, p.id
        limit ${query.pageSize} offset ${offset}`;
      const [count] = await tx<{ total: string }[]>`
        select count(*)::text as total from projects
        where tenant_id = ${context.tenantId}
          and (${query.status ?? null}::text is null or status = ${query.status ?? null})
          and (${query.customerId ?? null}::uuid is null or customer_id = ${query.customerId ?? null}::uuid)
          and (${search}::text is null or name ilike '%' || ${search} || '%' or code ilike '%' || ${search} || '%')`;
      return { items, total: Number(count!.total), page: query.page, pageSize: query.pageSize };
    });
  }

  async createProject(context: TenantContext, input: CreateProjectInput): Promise<ProjectRecord> {
    return withTenant(this.database, context.tenantId, async (tx) => {
      const id = randomUUID();
      const [project] = await tx<ProjectRecord[]>`
        insert into projects (id, tenant_id, customer_id, code, name, description, owner_membership_id, started_at, due_at)
        values (${id}, ${context.tenantId}, ${input.customerId}, ${input.code}, ${input.name},
          ${input.description?.trim() || null}, ${input.ownerMembershipId ?? null},
          ${input.startedAt ?? null}, ${input.dueAt ?? null})
        returning ${tx.unsafe(projectColumns)}`;
      await this.writeEvent(tx, context, id, "created", null, "draft", null);
      return project!;
    }).catch(mapConstraint);
  }

  async getProject(context: TenantContext, projectId: string): Promise<ProjectRecord | null> {
    return withTenant(this.database, context.tenantId, async (tx) => {
      const [project] = await tx<ProjectRecord[]>`
        select ${tx.unsafe(projectColumns)} from projects
        where tenant_id = ${context.tenantId} and id = ${projectId}`;
      return project ?? null;
    });
  }

  async getProjectDetail(context: TenantContext, projectId: string): Promise<ProjectDetail | null> {
    return withTenant(this.database, context.tenantId, async (tx) => {
      const [project] = await tx<ProjectListRow[]>`
        select ${tx.unsafe(projectListColumns)} ${tx.unsafe(projectListFrom)}
        where p.tenant_id = ${context.tenantId} and p.id = ${projectId}`;
      if (!project) return null;

      const events = await tx<ProjectEventRecord[]>`
        select e.id, e.type, e.from_value as "fromValue", e.to_value as "toValue", e.reason,
          u.name as "actorName", e.created_at as "createdAt"
        from project_events e
        left join memberships m on m.tenant_id = e.tenant_id and m.id = e.actor_membership_id
        left join "user" u on u.id = m.user_id
        where e.tenant_id = ${context.tenantId} and e.project_id = ${projectId}
        order by e.created_at desc`;

      const assignableMembers = await tx<{ membershipId: string; name: string }[]>`
        select m.id as "membershipId", u.name
        from memberships m join "user" u on u.id = m.user_id
        where m.tenant_id = ${context.tenantId} and m.status = 'active'
        order by u.name`;

      return { project, events, assignableMembers };
    });
  }

  /**
   * The status change and the event that records it are written together. `started_at` and
   * `closed_at` are stamped the first time the project reaches those states and never moved,
   * so a reopening does not erase when the work originally finished.
   */
  async updateProjectStatus(
    context: TenantContext,
    projectId: string,
    status: ProjectStatus,
    reason: string | null,
    at: Date
  ): Promise<ProjectRecord> {
    return withTenant(this.database, context.tenantId, async (tx) => {
      const [current] = await tx<{ status: ProjectStatus }[]>`
        select status from projects where tenant_id = ${context.tenantId} and id = ${projectId} for update`;
      if (!current) throw new ProjectsError("PROJECT_NOT_FOUND");

      const [project] = await tx<ProjectRecord[]>`
        update projects set status = ${status}, updated_at = ${at},
          started_at = case when ${status} = 'active' and started_at is null then ${at} else started_at end,
          closed_at = case when ${status} in ('closed', 'canceled') then ${at} else closed_at end
        where tenant_id = ${context.tenantId} and id = ${projectId}
        returning ${tx.unsafe(projectColumns)}`;

      await this.writeEvent(tx, context, projectId, "status_changed", current.status, status, reason);
      return project!;
    });
  }

  async listTimeEntries(context: TenantContext, query: TimeEntryListQuery): Promise<TimeEntryPage> {
    return withTenant(this.database, context.tenantId, async (tx) => {
      const offset = (query.page - 1) * query.pageSize;
      const filters = tx`
        e.tenant_id = ${context.tenantId}
        and (${query.projectId ?? null}::uuid is null or e.project_id = ${query.projectId ?? null}::uuid)
        and (${query.ticketId ?? null}::uuid is null or e.ticket_id = ${query.ticketId ?? null}::uuid)
        and (${query.membershipId ?? null}::uuid is null or e.membership_id = ${query.membershipId ?? null}::uuid)
        and (${query.from ?? null}::date is null or e.spent_on >= ${query.from ?? null}::date)
        and (${query.to ?? null}::date is null or e.spent_on <= ${query.to ?? null}::date)`;

      const items = await tx<TimeEntryListRow[]>`
        select e.id, e.membership_id as "membershipId", e.project_id as "projectId", e.ticket_id as "ticketId",
          to_char(e.spent_on, 'YYYY-MM-DD') as "spentOn", e.minutes, e.billable, e.note, e.created_at as "createdAt",
          u.name as "memberName", p.name as "projectName", t.ticket_number::int as "ticketNumber",
          coalesce(pc.display_name, tc.display_name) as "customerName"
        from time_entries e
        left join memberships m on m.tenant_id = e.tenant_id and m.id = e.membership_id
        left join "user" u on u.id = m.user_id
        left join projects p on p.tenant_id = e.tenant_id and p.id = e.project_id
        left join customers pc on pc.tenant_id = p.tenant_id and pc.id = p.customer_id
        left join tickets t on t.tenant_id = e.tenant_id and t.id = e.ticket_id
        left join customers tc on tc.tenant_id = t.tenant_id and tc.id = t.customer_id
        where ${filters}
        order by case when ${query.sort} = 'spent_asc' then e.spent_on end asc,
          e.spent_on desc, e.created_at desc, e.id
        limit ${query.pageSize} offset ${offset}`;

      const [count] = await tx<
        { total: string }[]
      >`select count(*)::text as total from time_entries e where ${filters}`;
      return { items, total: Number(count!.total), page: query.page, pageSize: query.pageSize };
    });
  }

  async getTimeEntry(context: TenantContext, timeEntryId: string): Promise<TimeEntryRecord | null> {
    return withTenant(this.database, context.tenantId, async (tx) => {
      const [entry] = await tx<TimeEntryRecord[]>`
        select ${tx.unsafe(timeEntryColumns)} from time_entries
        where tenant_id = ${context.tenantId} and id = ${timeEntryId}`;
      return entry ?? null;
    });
  }

  async findTimeEntryByClientReference(context: TenantContext, reference: string): Promise<TimeEntryRecord | null> {
    return withTenant(this.database, context.tenantId, async (tx) => {
      const [entry] = await tx<TimeEntryRecord[]>`
        select ${tx.unsafe(timeEntryColumns)} from time_entries
        where tenant_id = ${context.tenantId} and membership_id = ${context.membershipId}
          and client_reference = ${reference}`;
      return entry ?? null;
    });
  }

  async createTimeEntry(context: TenantContext, input: TimeEntryWrite): Promise<TimeEntryRecord> {
    return withTenant(this.database, context.tenantId, async (tx) => {
      const [entry] = await tx<TimeEntryRecord[]>`
        insert into time_entries (id, tenant_id, membership_id, project_id, ticket_id, spent_on, minutes,
          billable, note, client_reference)
        values (${randomUUID()}, ${context.tenantId}, ${context.membershipId}, ${input.projectId}, ${input.ticketId},
          ${input.spentOn}::date, ${input.minutes}, ${input.billable}, ${input.note}, ${input.clientReference})
        returning ${tx.unsafe(timeEntryColumns)}`;
      return entry!;
    }).catch(mapConstraint);
  }

  async updateTimeEntry(
    context: TenantContext,
    timeEntryId: string,
    changes: { spentOn: IsoDate; minutes: number; billable: boolean; note: string | null },
    at: Date
  ): Promise<TimeEntryRecord> {
    return withTenant(this.database, context.tenantId, async (tx) => {
      const [entry] = await tx<TimeEntryRecord[]>`
        update time_entries set spent_on = ${changes.spentOn}::date, minutes = ${changes.minutes},
          billable = ${changes.billable}, note = ${changes.note}, updated_at = ${at}
        where tenant_id = ${context.tenantId} and id = ${timeEntryId}
        returning ${tx.unsafe(timeEntryColumns)}`;
      if (!entry) throw new ProjectsError("TIME_ENTRY_NOT_FOUND");
      return entry;
    }).catch(mapConstraint);
  }

  async deleteTimeEntry(context: TenantContext, timeEntryId: string): Promise<void> {
    await withTenant(
      this.database,
      context.tenantId,
      (tx) => tx`delete from time_entries where tenant_id = ${context.tenantId} and id = ${timeEntryId}`
    );
  }

  async listCostRates(context: TenantContext): Promise<CostRateRecord[]> {
    return withTenant(
      this.database,
      context.tenantId,
      (tx) => tx<CostRateRecord[]>`
        select r.id, r.membership_id as "membershipId", u.name as "memberName", r.currency,
          r.cost_minor_per_hour::int as "costMinorPerHour", to_char(r.effective_from, 'YYYY-MM-DD') as "effectiveFrom"
        from member_cost_rates r
        left join memberships m on m.tenant_id = r.tenant_id and m.id = r.membership_id
        left join "user" u on u.id = m.user_id
        where r.tenant_id = ${context.tenantId}
        order by u.name, r.currency, r.effective_from desc`
    );
  }

  /** `scope` is derived from which of the two references carries a value. */
  async listBillingRates(context: TenantContext): Promise<BillingRateRecord[]> {
    return withTenant(
      this.database,
      context.tenantId,
      (tx) => tx<BillingRateRecord[]>`
        select r.id,
          case when r.project_id is null then 'customer' else 'project' end as scope,
          coalesce(r.project_id, r.customer_id) as "scopeId",
          coalesce(p.name, c.display_name) as "scopeName",
          r.currency, r.amount_minor_per_hour::int as "amountMinorPerHour",
          to_char(r.effective_from, 'YYYY-MM-DD') as "effectiveFrom"
        from billing_rates r
        left join projects p on p.tenant_id = r.tenant_id and p.id = r.project_id
        left join customers c on c.tenant_id = r.tenant_id and c.id = r.customer_id
        where r.tenant_id = ${context.tenantId}
        order by scope, "scopeName", r.currency, r.effective_from desc`
    );
  }

  /** Appends a row; the append-only trigger is what stops anyone editing an earlier one. */
  async publishCostRate(
    context: TenantContext,
    input: PublishCostRateInput & { effectiveFrom: IsoDate }
  ): Promise<CostRateRecord> {
    return withTenant(this.database, context.tenantId, async (tx) => {
      const [rate] = await tx<CostRateRecord[]>`
        insert into member_cost_rates (id, tenant_id, membership_id, currency, cost_minor_per_hour, effective_from)
        values (${randomUUID()}, ${context.tenantId}, ${input.membershipId}, ${input.currency},
          ${input.costMinorPerHour}, ${input.effectiveFrom}::date)
        returning id, membership_id as "membershipId", null::text as "memberName", currency,
          cost_minor_per_hour::int as "costMinorPerHour", to_char(effective_from, 'YYYY-MM-DD') as "effectiveFrom"`;
      return rate!;
    }).catch(mapConstraint);
  }

  async publishBillingRate(
    context: TenantContext,
    input: PublishBillingRateInput & { effectiveFrom: IsoDate }
  ): Promise<BillingRateRecord> {
    return withTenant(this.database, context.tenantId, async (tx) => {
      const [rate] = await tx<BillingRateRecord[]>`
        insert into billing_rates (id, tenant_id, customer_id, project_id, currency, amount_minor_per_hour, effective_from)
        values (${randomUUID()}, ${context.tenantId},
          ${input.scope === "customer" ? input.scopeId : null}, ${input.scope === "project" ? input.scopeId : null},
          ${input.currency}, ${input.amountMinorPerHour}, ${input.effectiveFrom}::date)
        returning id, case when project_id is null then 'customer' else 'project' end as scope,
          coalesce(project_id, customer_id) as "scopeId", null::text as "scopeName", currency,
          amount_minor_per_hour::int as "amountMinorPerHour", to_char(effective_from, 'YYYY-MM-DD') as "effectiveFrom"`;
      return rate!;
    }).catch(mapConstraint);
  }

  async loadProjectProfitability(context: TenantContext, projectId: string): Promise<ProfitabilityInput | null> {
    return withTenant(this.database, context.tenantId, async (tx) => {
      const [project] = await tx<{ customer_id: string }[]>`
        select customer_id from projects where tenant_id = ${context.tenantId} and id = ${projectId}`;
      if (!project) return null;

      // `coalesce(e.project_id, tk.project_id)`: time logged on a ticket that belongs to this
      // project is the project's work, and so it is priced with the project's rate.
      const entries = await tx<ProfitabilityInput["entries"]>`
        select e.membership_id as "membershipId", coalesce(e.project_id, tk.project_id) as "projectId",
          to_char(e.spent_on, 'YYYY-MM-DD') as "spentOn", e.minutes, e.billable
        from time_entries e
        left join tickets tk on tk.tenant_id = e.tenant_id and tk.id = e.ticket_id
        where e.tenant_id = ${context.tenantId} and (e.project_id = ${projectId} or tk.project_id = ${projectId})`;

      return { entries, ...(await this.loadRates(tx, context, project.customer_id)) };
    });
  }

  async loadCustomerProfitability(context: TenantContext, customerId: string): Promise<ProfitabilityInput | null> {
    return withTenant(this.database, context.tenantId, async (tx) => {
      const [customer] = await tx<{ id: string }[]>`
        select id from customers where tenant_id = ${context.tenantId} and id = ${customerId}`;
      if (!customer) return null;

      // The customer of an entry is derived from its project or its ticket and never stored, so
      // there is no second copy of it that can drift away from the first.
      const entries = await tx<ProfitabilityInput["entries"]>`
        select e.membership_id as "membershipId", coalesce(e.project_id, tk.project_id) as "projectId",
          to_char(e.spent_on, 'YYYY-MM-DD') as "spentOn", e.minutes, e.billable
        from time_entries e
        left join projects p on p.tenant_id = e.tenant_id and p.id = e.project_id
        left join tickets tk on tk.tenant_id = e.tenant_id and tk.id = e.ticket_id
        where e.tenant_id = ${context.tenantId} and coalesce(p.customer_id, tk.customer_id) = ${customerId}`;

      return { entries, ...(await this.loadRates(tx, context, customerId)) };
    });
  }

  /**
   * Every rate of the tenant, grouped for the domain to resolve by date.
   *
   * Loaded whole rather than one lookup per entry: a report over a month of work would
   * otherwise issue a query per logged hour, and the rate tables are a handful of rows.
   */
  private async loadRates(tx: postgres.TransactionSql, context: TenantContext, customerId: string) {
    const costRows = await tx<
      { membershipId: string; currency: string; minorPerHour: number; effectiveFrom: string }[]
    >`
      select membership_id as "membershipId", currency, cost_minor_per_hour::int as "minorPerHour",
        to_char(effective_from, 'YYYY-MM-DD') as "effectiveFrom"
      from member_cost_rates where tenant_id = ${context.tenantId}`;

    const projectRows = await tx<
      { projectId: string; currency: string; minorPerHour: number; effectiveFrom: string }[]
    >`
      select project_id as "projectId", currency, amount_minor_per_hour::int as "minorPerHour",
        to_char(effective_from, 'YYYY-MM-DD') as "effectiveFrom"
      from billing_rates where tenant_id = ${context.tenantId} and project_id is not null`;

    const customerRates = await tx<DatedRate[]>`
      select currency, amount_minor_per_hour::int as "minorPerHour",
        to_char(effective_from, 'YYYY-MM-DD') as "effectiveFrom"
      from billing_rates where tenant_id = ${context.tenantId} and customer_id = ${customerId}`;

    const costRates: Record<string, DatedRate[]> = {};
    for (const row of costRows) {
      (costRates[row.membershipId] ??= []).push({
        currency: row.currency,
        minorPerHour: row.minorPerHour,
        effectiveFrom: row.effectiveFrom
      });
    }
    const projectRates: Record<string, DatedRate[]> = {};
    for (const row of projectRows) {
      (projectRates[row.projectId] ??= []).push({
        currency: row.currency,
        minorPerHour: row.minorPerHour,
        effectiveFrom: row.effectiveFrom
      });
    }
    return { costRates, projectRates, customerRates: [...customerRates] };
  }

  private async writeEvent(
    tx: postgres.TransactionSql,
    context: TenantContext,
    projectId: string,
    type: string,
    fromValue: string | null,
    toValue: string | null,
    reason: string | null
  ) {
    await tx`
      insert into project_events (id, tenant_id, project_id, actor_membership_id, type, from_value, to_value, reason)
      values (${randomUUID()}, ${context.tenantId}, ${projectId}, ${context.membershipId}, ${type},
        ${fromValue}, ${toValue}, ${reason})`;
  }
}

type DatabaseError = { code?: string; constraint_name?: string };

/**
 * Turns the guarantees the database enforces into codes the API can answer with.
 *
 * These are not duplicated checks: the constraint is the guarantee, and this only translates it
 * into something a caller can act on instead of a 500.
 */
function mapConstraint(error: unknown): never {
  const databaseError = error as DatabaseError;
  const constraint = databaseError.constraint_name ?? "";

  // Raised by the trigger on time_entries; see 0016_projects_and_time.sql.
  if (databaseError.code === "CH001") throw new ProjectsError("PROJECT_CLOSED");
  if (databaseError.code === "23505") {
    if (constraint.includes("client_reference")) throw new ProjectsError("DUPLICATE_CLIENT_REFERENCE");
    if (constraint.includes("projects_tenant_id_code")) throw new ProjectsError("DUPLICATE_CODE");
    if (constraint.includes("rates")) throw new ProjectsError("DUPLICATE_RATE");
    throw new ProjectsError("DUPLICATE_ENTRY");
  }
  if (databaseError.code === "23503") {
    if (constraint === "tickets_project_customer_fk") throw new ProjectsError("PROJECT_CUSTOMER_MISMATCH");
    if (constraint.includes("customer")) throw new ProjectsError("CUSTOMER_NOT_FOUND");
    if (constraint.includes("ticket")) throw new ProjectsError("TICKET_NOT_FOUND");
    if (constraint.includes("project")) throw new ProjectsError("PROJECT_NOT_FOUND");
    if (constraint.includes("membership")) throw new ProjectsError("MEMBER_NOT_FOUND");
    throw new ProjectsError("REFERENCE_NOT_FOUND");
  }
  if (databaseError.code === "23514") throw new ProjectsError("INVALID_INPUT");
  throw error;
}

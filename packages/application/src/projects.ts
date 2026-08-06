import {
  acceptsTimeEntries,
  canTransitionProject,
  hasPermission,
  isIsoDate,
  parseDurationMinutes,
  profitability,
  rateOn,
  todayIso,
  type DatedRate,
  type IsoDate,
  type Profitability,
  type ProjectStatus,
  type TenantContext,
  type ValuedTimeEntry
} from "@control-hub/domain";

export class ProjectsError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}

export type ProjectRecord = {
  id: string;
  customerId: string;
  code: string;
  name: string;
  description: string | null;
  status: ProjectStatus;
  ownerMembershipId: string | null;
  startedAt: Date | null;
  dueAt: Date | null;
  closedAt: Date | null;
  createdAt: Date;
};

/** A listing row: the record plus the names a person reads instead of identifiers. */
export type ProjectListRow = ProjectRecord & {
  customerName: string;
  ownerName: string | null;
  loggedMinutes: number;
};

export type ProjectPage = { items: ProjectListRow[]; total: number; page: number; pageSize: number };

export type ProjectEventRecord = {
  id: string;
  type: "created" | "status_changed";
  fromValue: string | null;
  toValue: string | null;
  reason: string | null;
  actorName: string | null;
  createdAt: Date;
};

export type ProjectListQuery = {
  page: number;
  pageSize: number;
  sort: "created_desc" | "created_asc" | "due_asc" | "name_asc";
  search?: string | undefined;
  status?: ProjectStatus | undefined;
  customerId?: string | undefined;
};

export type CreateProjectInput = {
  customerId: string;
  code: string;
  name: string;
  description?: string | undefined;
  ownerMembershipId?: string | undefined;
  startedAt?: Date | undefined;
  dueAt?: Date | undefined;
};

export type TimeEntryRecord = {
  id: string;
  membershipId: string;
  projectId: string | null;
  ticketId: string | null;
  spentOn: IsoDate;
  minutes: number;
  billable: boolean;
  note: string | null;
  createdAt: Date;
};

export type TimeEntryListRow = TimeEntryRecord & {
  memberName: string | null;
  projectName: string | null;
  ticketNumber: number | null;
  customerName: string;
};

export type TimeEntryPage = { items: TimeEntryListRow[]; total: number; page: number; pageSize: number };

export type TimeEntryListQuery = {
  page: number;
  pageSize: number;
  sort: "spent_desc" | "spent_asc";
  projectId?: string | undefined;
  ticketId?: string | undefined;
  membershipId?: string | undefined;
  from?: IsoDate | undefined;
  to?: IsoDate | undefined;
};

/**
 * What a caller sends to log time. `duration` is text on purpose: `1h 30m` and `90` both
 * arrive as typed, and one parser in the domain decides what they mean.
 */
export type LogTimeInput = {
  projectId?: string | undefined;
  ticketId?: string | undefined;
  spentOn?: IsoDate | undefined;
  duration: string;
  billable?: boolean | undefined;
  note?: string | undefined;
  clientReference?: string | undefined;
};

export type UpdateTimeEntryInput = {
  duration?: string | undefined;
  spentOn?: IsoDate | undefined;
  billable?: boolean | undefined;
  note?: string | null | undefined;
};

/** The stored shape of a time entry, resolved to minutes and validated. */
export type TimeEntryWrite = {
  projectId: string | null;
  ticketId: string | null;
  spentOn: IsoDate;
  minutes: number;
  billable: boolean;
  note: string | null;
  clientReference: string | null;
};

export type CostRateRecord = {
  id: string;
  membershipId: string;
  memberName: string | null;
  currency: string;
  costMinorPerHour: number;
  effectiveFrom: IsoDate;
};

export type BillingRateRecord = {
  id: string;
  scope: "customer" | "project";
  scopeId: string;
  scopeName: string | null;
  currency: string;
  amountMinorPerHour: number;
  effectiveFrom: IsoDate;
};

export type PublishCostRateInput = {
  membershipId: string;
  currency: string;
  costMinorPerHour: number;
  effectiveFrom?: IsoDate | undefined;
};

export type PublishBillingRateInput = {
  scope: "customer" | "project";
  scopeId: string;
  currency: string;
  amountMinorPerHour: number;
  effectiveFrom?: IsoDate | undefined;
};

/** Everything the profitability of one project or customer needs, fetched together. */
export type ProfitabilityInput = {
  entries: { membershipId: string; projectId: string | null; spentOn: IsoDate; minutes: number; billable: boolean }[];
  costRates: Record<string, DatedRate[]>;
  /** Billing rates by project identifier, for the more specific scope. */
  projectRates: Record<string, DatedRate[]>;
  customerRates: DatedRate[];
};

export type ProfitabilityReport = Profitability & { scope: "project" | "customer"; scopeId: string };

export type ProjectDetail = {
  project: ProjectListRow;
  events: ProjectEventRecord[];
  /** Members a project can be put on, so the page does not make a second call for them. */
  assignableMembers: { membershipId: string; name: string }[];
};

export type ProjectsRepository = {
  listProjects(context: TenantContext, query: ProjectListQuery): Promise<ProjectPage>;
  createProject(context: TenantContext, input: CreateProjectInput): Promise<ProjectRecord>;
  getProject(context: TenantContext, projectId: string): Promise<ProjectRecord | null>;
  getProjectDetail(context: TenantContext, projectId: string): Promise<ProjectDetail | null>;
  updateProjectStatus(
    context: TenantContext,
    projectId: string,
    status: ProjectStatus,
    reason: string | null,
    at: Date
  ): Promise<ProjectRecord>;

  listTimeEntries(context: TenantContext, query: TimeEntryListQuery): Promise<TimeEntryPage>;
  getTimeEntry(context: TenantContext, timeEntryId: string): Promise<TimeEntryRecord | null>;
  findTimeEntryByClientReference(context: TenantContext, reference: string): Promise<TimeEntryRecord | null>;
  createTimeEntry(context: TenantContext, input: TimeEntryWrite): Promise<TimeEntryRecord>;
  updateTimeEntry(
    context: TenantContext,
    timeEntryId: string,
    changes: { spentOn: IsoDate; minutes: number; billable: boolean; note: string | null },
    at: Date
  ): Promise<TimeEntryRecord>;
  deleteTimeEntry(context: TenantContext, timeEntryId: string): Promise<void>;

  listCostRates(context: TenantContext): Promise<CostRateRecord[]>;
  listBillingRates(context: TenantContext): Promise<BillingRateRecord[]>;
  publishCostRate(
    context: TenantContext,
    input: PublishCostRateInput & { effectiveFrom: IsoDate }
  ): Promise<CostRateRecord>;
  publishBillingRate(
    context: TenantContext,
    input: PublishBillingRateInput & { effectiveFrom: IsoDate }
  ): Promise<BillingRateRecord>;

  loadProjectProfitability(context: TenantContext, projectId: string): Promise<ProfitabilityInput | null>;
  loadCustomerProfitability(context: TenantContext, customerId: string): Promise<ProfitabilityInput | null>;
};

export class ProjectsService {
  constructor(private readonly repository: ProjectsRepository) {}

  listProjects(context: TenantContext, query: ProjectListQuery): Promise<ProjectPage> {
    return this.repository.listProjects(context, query);
  }

  async createProject(context: TenantContext, input: CreateProjectInput): Promise<ProjectRecord> {
    if (!/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/.test(input.code)) throw new ProjectsError("INVALID_CODE");
    if (input.name.trim().length < 3) throw new ProjectsError("INVALID_INPUT");
    if (input.startedAt && input.dueAt && input.dueAt < input.startedAt) throw new ProjectsError("INVALID_DATES");
    return this.repository.createProject(context, { ...input, name: input.name.trim() });
  }

  async projectDetail(context: TenantContext, projectId: string): Promise<ProjectDetail> {
    const detail = await this.repository.getProjectDetail(context, projectId);
    if (!detail) throw new ProjectsError("PROJECT_NOT_FOUND");
    return detail;
  }

  /**
   * Reopening a closed project is allowed and recorded like any other move. The append-only
   * event is what makes it explicit: the row says who reopened it and when, so the hours that
   * arrive afterwards have a reason somebody can point at.
   */
  async changeStatus(
    context: TenantContext,
    projectId: string,
    status: ProjectStatus,
    reason: string | null = null,
    now = new Date()
  ): Promise<ProjectRecord> {
    const project = await this.repository.getProject(context, projectId);
    if (!project) throw new ProjectsError("PROJECT_NOT_FOUND");
    if (!canTransitionProject(project.status, status)) throw new ProjectsError("INVALID_TRANSITION");
    return this.repository.updateProjectStatus(context, projectId, status, reason, now);
  }

  listTimeEntries(context: TenantContext, query: TimeEntryListQuery): Promise<TimeEntryPage> {
    return this.repository.listTimeEntries(context, query);
  }

  /**
   * Logs time against exactly one project or one ticket.
   *
   * A repeated `clientReference` returns the entry already stored. The unique constraint is the
   * real guarantee; this only spares the caller an error it can do nothing about, because the
   * caller that retries is a network layer and not a person.
   */
  async logTime(context: TenantContext, input: LogTimeInput, now = new Date()): Promise<TimeEntryRecord> {
    if (Number(Boolean(input.projectId)) + Number(Boolean(input.ticketId)) !== 1)
      throw new ProjectsError("ENTRY_TARGET_REQUIRED");

    const minutes = parseDurationMinutes(input.duration);
    if (minutes === null) throw new ProjectsError("INVALID_DURATION");

    const spentOn = input.spentOn ?? todayIso(now);
    if (!isIsoDate(spentOn)) throw new ProjectsError("INVALID_INPUT");
    // Tomorrow's work has not happened yet, and an entry dated forward would land in a period
    // that may already have been reported on.
    if (spentOn > todayIso(now)) throw new ProjectsError("FUTURE_DATE");

    if (input.clientReference) {
      const existing = await this.repository.findTimeEntryByClientReference(context, input.clientReference);
      if (existing) return existing;
    }

    if (input.projectId) {
      const project = await this.repository.getProject(context, input.projectId);
      if (!project) throw new ProjectsError("PROJECT_NOT_FOUND");
      if (!acceptsTimeEntries(project.status)) throw new ProjectsError("PROJECT_CLOSED");
    }

    return this.repository.createTimeEntry(context, {
      projectId: input.projectId ?? null,
      ticketId: input.ticketId ?? null,
      spentOn,
      minutes,
      billable: input.billable ?? true,
      note: input.note?.trim() || null,
      clientReference: input.clientReference ?? null
    });
  }

  /**
   * Editing somebody else's hours needs `time:manage`. `time:log` is the permission to keep
   * your own record straight, not to correct a colleague's.
   *
   * Returns the entry as it was alongside the new one. The ownership check has already read it,
   * so the audit record gets the value it replaced without a second query and without a window
   * in which somebody else could have changed it in between.
   */
  async updateTimeEntry(
    context: TenantContext,
    timeEntryId: string,
    changes: UpdateTimeEntryInput,
    now = new Date()
  ): Promise<{ entry: TimeEntryRecord; previous: TimeEntryRecord }> {
    const entry = await this.assertCanWrite(context, timeEntryId);

    const minutes = changes.duration === undefined ? entry.minutes : parseDurationMinutes(changes.duration);
    if (minutes === null) throw new ProjectsError("INVALID_DURATION");

    const spentOn = changes.spentOn ?? entry.spentOn;
    if (!isIsoDate(spentOn)) throw new ProjectsError("INVALID_INPUT");
    if (spentOn > todayIso(now)) throw new ProjectsError("FUTURE_DATE");

    if (entry.projectId) {
      const project = await this.repository.getProject(context, entry.projectId);
      if (project && !acceptsTimeEntries(project.status)) throw new ProjectsError("PROJECT_CLOSED");
    }

    const note = changes.note === undefined ? entry.note : (changes.note?.trim() ?? null) || null;
    const updated = await this.repository.updateTimeEntry(
      context,
      timeEntryId,
      { spentOn, minutes, billable: changes.billable ?? entry.billable, note },
      now
    );
    return { entry: updated, previous: entry };
  }

  /** Returns the entry as it was, so the caller can put the old value in the audit record. */
  async deleteTimeEntry(context: TenantContext, timeEntryId: string): Promise<TimeEntryRecord> {
    const entry = await this.assertCanWrite(context, timeEntryId);
    await this.repository.deleteTimeEntry(context, timeEntryId);
    return entry;
  }

  private async assertCanWrite(context: TenantContext, timeEntryId: string): Promise<TimeEntryRecord> {
    const entry = await this.repository.getTimeEntry(context, timeEntryId);
    if (!entry) throw new ProjectsError("TIME_ENTRY_NOT_FOUND");
    if (entry.membershipId !== context.membershipId && !hasPermission(context, "time:manage"))
      throw new ProjectsError("PERMISSION_DENIED");
    return entry;
  }

  /**
   * Rates are readable only with `financials:read`. The check is here rather than only on the
   * route because an hourly cost is close enough to a salary that it should be refused by the
   * layer that owns the rule, not by whichever transport happens to ask.
   */
  async listRates(context: TenantContext): Promise<{ cost: CostRateRecord[]; billing: BillingRateRecord[] }> {
    if (!hasPermission(context, "financials:read")) throw new ProjectsError("PERMISSION_DENIED");
    const [cost, billing] = await Promise.all([
      this.repository.listCostRates(context),
      this.repository.listBillingRates(context)
    ]);
    return { cost, billing };
  }

  async publishCostRate(
    context: TenantContext,
    input: PublishCostRateInput,
    now = new Date()
  ): Promise<CostRateRecord> {
    const effectiveFrom = this.validRateInput(input.currency, input.costMinorPerHour, input.effectiveFrom, now);
    return this.repository.publishCostRate(context, { ...input, effectiveFrom });
  }

  async publishBillingRate(
    context: TenantContext,
    input: PublishBillingRateInput,
    now = new Date()
  ): Promise<BillingRateRecord> {
    const effectiveFrom = this.validRateInput(input.currency, input.amountMinorPerHour, input.effectiveFrom, now);
    return this.repository.publishBillingRate(context, { ...input, effectiveFrom });
  }

  private validRateInput(
    currency: string,
    minorPerHour: number,
    effectiveFrom: IsoDate | undefined,
    now: Date
  ): IsoDate {
    if (!/^[A-Z]{3}$/.test(currency)) throw new ProjectsError("INVALID_CURRENCY");
    if (!Number.isSafeInteger(minorPerHour) || minorPerHour < 0) throw new ProjectsError("INVALID_AMOUNT");
    const day = effectiveFrom ?? todayIso(now);
    if (!isIsoDate(day)) throw new ProjectsError("INVALID_INPUT");
    return day;
  }

  async projectProfitability(context: TenantContext, projectId: string): Promise<ProfitabilityReport> {
    if (!hasPermission(context, "financials:read")) throw new ProjectsError("PERMISSION_DENIED");
    const input = await this.repository.loadProjectProfitability(context, projectId);
    if (!input) throw new ProjectsError("PROJECT_NOT_FOUND");
    return { scope: "project", scopeId: projectId, ...profitability(valueEntries(input)) };
  }

  async customerProfitability(context: TenantContext, customerId: string): Promise<ProfitabilityReport> {
    if (!hasPermission(context, "financials:read")) throw new ProjectsError("PERMISSION_DENIED");
    const input = await this.repository.loadCustomerProfitability(context, customerId);
    if (!input) throw new ProjectsError("CUSTOMER_NOT_FOUND");
    return { scope: "customer", scopeId: customerId, ...profitability(valueEntries(input)) };
  }
}

/**
 * Matches each entry with the rates that were in force the day it was worked.
 *
 * The billing rate of the project wins over the one of its customer, because the more specific
 * agreement is the one that was actually made. A member with rates published in more than one
 * currency resolves to the most recently published of them, which is what "the rate in force"
 * means when somebody has deliberately superseded one currency with another.
 */
export function valueEntries(input: ProfitabilityInput): ValuedTimeEntry[] {
  return input.entries.map((entry) => {
    const cost = rateOn(input.costRates[entry.membershipId] ?? [], entry.spentOn);
    const projectRate = entry.projectId ? rateOn(input.projectRates[entry.projectId] ?? [], entry.spentOn) : null;
    const revenue = projectRate ?? rateOn(input.customerRates, entry.spentOn);
    return {
      minutes: entry.minutes,
      billable: entry.billable,
      cost: cost ? { currency: cost.currency, minorPerHour: cost.minorPerHour } : null,
      revenue: revenue ? { currency: revenue.currency, minorPerHour: revenue.minorPerHour } : null
    };
  });
}

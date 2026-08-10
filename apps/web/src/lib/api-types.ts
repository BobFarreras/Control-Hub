/**
 * What the API promises to return, in one place.
 *
 * `Response.json()` is typed `any`, so before this file every value crossing the boundary
 * entered the web tier untyped and stayed that way: a renamed field on the API produced no
 * error anywhere, just `undefined` on a page. Parsing goes through `readJson` in `./api`,
 * which is the single point where the shape is asserted rather than checked.
 *
 * These declarations mirror the handlers in `apps/api/src`. When one of those changes, this
 * changes with it.
 */

export type TablePreference = {
  tableId: string;
  columnOrder: string[];
  hiddenColumns: string[];
  columnWidths: Record<string, number>;
  pageSize: 10 | 25 | 50 | 100;
};

export type Page<T> = { items: T[]; total: number; page: number; pageSize: TablePreference["pageSize"] };

export type LeadRow = {
  id: string;
  name: string;
  companyName: string | null;
  email: string | null;
  phone: string | null;
  source: string;
  status: string;
  priority: string;
  createdAt: string;
};

export type CustomerRow = {
  id: string;
  displayName: string;
  billingEmail: string | null;
  phone: string | null;
  status: string;
  createdAt: string;
};

export type CustomerDetail = CustomerRow & {
  legalName: string | null;
  website: string | null;
  taxId: string | null;
  preferredLocale: "ca" | "es" | "en" | null;
  timezone: string | null;
  ownerMembershipId: string | null;
  createdFromLeadId: string | null;
  updatedAt: string;
  contacts: {
    id: string;
    name: string;
    role: string | null;
    email: string | null;
    phone: string | null;
    isPrimary: boolean;
    sourceLeadId: string | null;
  }[];
  notes: { id: string; body: string; createdAt: string }[];
  tasks: { id: string; title: string; dueAt: string | null; completedAt: string | null }[];
  activity: { id: string; type: string; occurredAt: string }[];
  services: {
    id: string;
    productId: string;
    productName: string;
    planName: string;
    projectId: string | null;
    projectName: string | null;
    status: string;
    startedAt: string;
    renewalAt: string | null;
  }[];
  projects: {
    id: string;
    code: string;
    name: string;
    status: string;
    startedAt: string | null;
    dueAt: string | null;
  }[];
  tickets: { id: string; ticketNumber: number; subject: string; status: string; priority: string; openedAt: string }[];
  interests: {
    id: string;
    productId: string;
    productName: string;
    stage: "detected" | "qualified" | "proposal" | "negotiation" | "won" | "lost";
    probability: number | null;
    estimatedAmountMinor?: number | null;
    currency?: string | null;
    nextStep: string | null;
    updatedAt: string;
  }[];
  availableProducts: { id: string; name: string }[];
  addresses: {
    id: string;
    type: "billing" | "shipping" | "office" | "other";
    label: string | null;
    line1: string;
    line2: string | null;
    postalCode: string | null;
    city: string;
    region: string | null;
    countryCode: string;
    isPrimary: boolean;
  }[];
};

export type CrmSummary = {
  leadsByStatus: Record<string, number>;
  activeCustomers: number;
  openTasks: number;
  overdueTasks: number;
};

export type ImportResult = { row: number; status: string; code?: string };
export type ImportSummary = { total: number; imported: number; skipped: number; warnings: number; errors: number };

export type SlaTargetState = {
  consumedMinutes: number;
  targetMinutes: number;
  breached: boolean;
  measurable: boolean;
};

export type InboxTicket = {
  id: string;
  ticketNumber: number;
  customerId: string;
  customerName: string;
  projectId: string | null;
  subject: string;
  status: string;
  priority: string;
  category: string;
  assigneeMembershipId: string | null;
  assigneeName: string | null;
  openedAt: string;
  firstResponseAt: string | null;
  resolvedAt: string | null;
  closedAt: string | null;
  sla: { firstResponse: SlaTargetState; resolution: SlaTargetState };
};

export type TicketMessage = {
  id: string;
  ticketId: string;
  authorMembershipId: string | null;
  authorName: string | null;
  body: string;
  visibility: "internal" | "customer";
  createdAt: string;
};

export type AssignableMember = { membershipId: string; name: string };

export type TicketDetail = {
  ticket: InboxTicket & { description: string };
  messages: TicketMessage[];
  sla: { firstResponse: SlaTargetState; resolution: SlaTargetState };
  assignableMembers: AssignableMember[];
};

export type InboxPage = { items: InboxTicket[]; total: number; page: number; pageSize: TablePreference["pageSize"] };

export type ProjectRow = {
  id: string;
  customerId: string;
  customerName: string;
  code: string;
  name: string;
  description: string | null;
  status: string;
  ownerMembershipId: string | null;
  ownerName: string | null;
  startedAt: string | null;
  dueAt: string | null;
  closedAt: string | null;
  createdAt: string;
  serviceTypeId: string | null;
  serviceTypeName: string | null;
  loggedMinutes: number;
};

export type ProjectEvent = {
  id: string;
  type: "created" | "status_changed";
  fromValue: string | null;
  toValue: string | null;
  reason: string | null;
  actorName: string | null;
  createdAt: string;
};

export type ProjectDetail = {
  project: ProjectRow;
  events: ProjectEvent[];
  assignableMembers: AssignableMember[];
};

/** `spentOn` is a day (`YYYY-MM-DD`), not an instant: it is the day somebody worked. */
export type TimeEntry = {
  id: string;
  membershipId: string;
  memberName: string | null;
  projectId: string | null;
  projectName: string | null;
  ticketId: string | null;
  ticketNumber: number | null;
  customerName: string;
  spentOn: string;
  minutes: number;
  billable: boolean;
  note: string | null;
  createdAt: string;
};

export type ProfitabilityLine = { currency: string; revenueMinor: number; costMinor: number; marginMinor: number };

export type Profitability = {
  scope: "project" | "customer";
  scopeId: string;
  minutes: number;
  billableMinutes: number;
  lines: ProfitabilityLine[];
  entriesWithoutCostRate: number;
  entriesWithoutBillingRate: number;
};

/** `effectiveFrom` is a day (`YYYY-MM-DD`): a rate applies to the work of that whole day. */
export type CostRate = {
  id: string;
  membershipId: string;
  memberName: string | null;
  currency: string;
  costMinorPerHour: number;
  effectiveFrom: string;
  /** Set once the rate has been withdrawn; the row stays in the history and stops resolving. */
  annulledAt: string | null;
  annulledByName: string | null;
};

/** What a sale price is attached to: one project, one customer, or a whole kind of work. */
export type BillingScope = "customer" | "project" | "service_type";

export type BillingRate = {
  id: string;
  scope: BillingScope;
  scopeId: string;
  scopeName: string | null;
  currency: string;
  amountMinorPerHour: number;
  effectiveFrom: string;
  annulledAt: string | null;
  annulledByName: string | null;
};

export type ServiceType = {
  id: string;
  code: string;
  name: string;
  active: boolean;
  /** Projects of this kind. They keep working if it is removed; they just lose the standing price. */
  projectCount: number;
  /** Sale rates ever filed under it. One is enough to make removal impossible. */
  rateCount: number;
};
export type ServiceTypesResponse = { serviceTypes: ServiceType[] };

export type RatesResponse = { cost: CostRate[]; billing: BillingRate[] };
export type Member = { id: string; name: string; email: string; status: string; roles: string[] };
export type MembersResponse = { members: Member[] };

export type ProjectsPage = { items: ProjectRow[]; total: number; page: number; pageSize: TablePreference["pageSize"] };
export type TimeEntriesPage = {
  items: TimeEntry[];
  total: number;
  page: number;
  pageSize: TablePreference["pageSize"];
};

export type Product = { id: string; code: string; name: string; description: string | null; status: string };
export type Version = { id: string; productId: string; version: string; status: string };
export type CommercialModel = "subscription" | "maintenance" | "one_time" | "project_service";
export type Plan = {
  id: string;
  productVersionId: string;
  code: string;
  name: string;
  description: string | null;
  commercialModel: CommercialModel;
  status: string;
};
export type BillingInterval = "free" | "one_time" | "monthly" | "quarterly" | "semiannual" | "annual";

export type Price = {
  id: string;
  planId: string;
  currency: string;
  amountMinor: number;
  costMinor: number;
  taxBasisPoints: number;
  interval: BillingInterval;
  effectiveFrom: string;
};

export type Catalog = { products: Product[]; versions: Version[]; plans: Plan[]; prices: Price[] };
export type ProductCatalogDetail = Catalog & { product: Product };

export type CustomerSubscription = {
  id: string;
  customerId: string;
  customerName: string;
  planId: string;
  planName: string;
  priceId: string;
  status: "active" | "paused" | "canceled";
  quantity: number;
  renewalAt: string | null;
};

export type CustomerService = {
  id: string;
  customerId: string;
  customerName: string;
  productId: string;
  productName: string;
  planId: string;
  planName: string;
  priceId: string;
  commercialModel: CommercialModel;
  status: "active" | "paused" | "completed" | "canceled";
  quantity: number;
  contractedAt: string;
  startsAt: string;
  endsAt: string | null;
  ownerMembershipId: string | null;
  ownerName: string | null;
  projectId: string | null;
  projectName: string | null;
  canceledAt: string | null;
  currency: string;
  interval: BillingInterval;
  currentPeriodStart: string | null;
  renewalAt: string | null;
  autoRenew: boolean | null;
  renewalAlertDays: number | null;
  createdAt: string;
  updatedAt: string;
  financials?: { amountMinor: number; costMinor: number; taxBasisPoints: number };
};

export type CustomerServicesResponse = { services: CustomerService[] };

export type FinancialMetric = {
  currency: string;
  mrrMinor: number;
  arrMinor: number;
  annualCostMinor: number;
  annualMarginMinor: number;
  activeSubscriptions: number;
};

export type RenewalAlert = {
  subscriptionId: string;
  customerName: string;
  planName: string;
  renewalAt: string;
  daysRemaining: number;
};

export type CustomerOption = { id: string; displayName: string };

export type CompanySubscription = {
  id: string;
  provider: string;
  serviceName: string;
  category: string;
  status: "active" | "trial" | "paused" | "canceled";
  renewalAt: string | null;
  renewalAlertDays: number;
  autoRenew: boolean;
  websiteUrl: string | null;
  notes: string | null;
  accountEmail: string | null;
  ownerMembershipId: string | null;
  ownerName: string | null;
  quantity: number;
  startedAt: string | null;
  trialEndsAt: string | null;
  cancelBeforeAt: string | null;
  canceledAt: string | null;
  costCenter: string | null;
  paymentMethodLabel: string | null;
  secretManagerUrl: string | null;
  createdAt: string;
  updatedAt: string;
  financials?: {
    currency: string;
    amountMinor: number;
    interval: "monthly" | "quarterly" | "semiannual" | "annual";
  };
};

/** Response envelopes, named after the route that returns them. */
export type TablePreferenceResponse = { preference: TablePreference };
export type CustomerDetailResponse = { customer: CustomerDetail };
export type CompanySubscriptionsResponse = { subscriptions: CompanySubscription[] };
export type CustomerSubscriptionsResponse = { subscriptions: CustomerSubscription[] };
export type FinancialSummaryResponse = { metrics: FinancialMetric[] };
export type RenewalAlertsResponse = { alerts: RenewalAlert[] };
export type ImportResultsResponse = { results: ImportResult[] };
export type ProfitabilityResponse = { profitability: Profitability };
export type ErrorResponse = { code?: string; error?: { code?: string } };

/** The working time record, as `/api/v1/attendance/summary` returns it. */
export type AttendanceEvent = {
  id: string;
  membershipId: string;
  kind: "clock_in" | "clock_out" | "pause_start" | "pause_end";
  occurredAt: string;
  recordedAt: string;
  recordedByMembershipId: string;
  source: "web" | "api";
  correctsEventId: string | null;
  reason: string | null;
};
export type AttendanceDay = { day: string; workedMinutes: number; hasOpenSession: boolean };
export type AttendanceSession = {
  startedAt: string;
  endedAt: string | null;
  day: string;
  pausedMinutes: number;
  workedMinutes: number | null;
};
export type AttendanceMonth = {
  membershipId: string;
  memberName: string;
  days: AttendanceDay[];
  sessions: AttendanceSession[];
  totalMinutes: number;
  events: AttendanceEvent[];
};

export type AttendanceTeamRow = {
  membershipId: string;
  memberName: string;
  days: AttendanceDay[];
  sessions: AttendanceSession[];
  totalMinutes: number;
  declaredEntries: number;
  /** Present only on the reconciliation, which needs `financials:read` as well. */
  loggedMinutes?: number;
  unbilledMinutes?: number;
};
export type AttendanceTeamResponse = { members: AttendanceTeamRow[] };

export type AttendanceHoliday = {
  id: string;
  date: string;
  name: string;
};

export type AttendanceNonWorkingDay = {
  id: string;
  dayOfWeek: number;
};

export type AttendanceVacationStatus = "pending" | "approved" | "rejected";

export type AttendanceVacation = {
  id: string;
  membershipId: string;
  startDate: string;
  endDate: string;
  status: AttendanceVacationStatus;
  approvedByMembershipId: string | null;
  approvedAt: string | null;
  notes: string | null;
};

export type AttendanceAbsenceType = "sick_leave" | "personal_leave" | "other";

export type AttendanceAbsence = {
  id: string;
  membershipId: string;
  startDate: string;
  endDate: string;
  type: AttendanceAbsenceType;
  documentUrl: string | null;
  notes: string | null;
  createdByMembershipId: string;
};

export type AttendanceBlock = {
  id: string;
  membershipId: string;
  date: string;
  startTime: string;
  endTime: string;
  reason: string;
};

export type AttendanceHolidaysResponse = { holidays: AttendanceHoliday[] };
export type AttendanceNonWorkingDaysResponse = { nonWorkingDays: AttendanceNonWorkingDay[] };
export type AttendanceVacationsResponse = { vacations: AttendanceVacation[] };
export type AttendanceAbsencesResponse = { absences: AttendanceAbsence[] };
export type AttendanceBlocksResponse = { blocks: AttendanceBlock[] };

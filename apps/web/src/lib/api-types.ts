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

export type InboxSlaDetail = {
  status: string;
  targetMinutes: number;
  consumedMinutes: number;
  remainingMinutes: number;
  estimatedDeadline: string | null;
  activeTarget: string;
};

export type InboxTicket = {
  id: string;
  ticketNumber: number;
  customerId: string;
  customerName: string;
  projectId: string | null;
  projectName: string | null;
  subject: string;
  status: string;
  priority: string;
  category: string;
  assigneeMembershipId: string | null;
  assigneeName: string | null;
  openedAt: string;
  updatedAt: string;
  firstResponseAt: string | null;
  resolvedAt: string | null;
  closedAt: string | null;
  sla: { firstResponse: SlaTargetState; resolution: SlaTargetState };
  inboxSla: { firstResponse: InboxSlaDetail; resolution: InboxSlaDetail };
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
  inboxSla: { firstResponse: InboxSlaDetail; resolution: InboxSlaDetail };
  assignableMembers: AssignableMember[];
  deliveries: {
    ticketMessageId: string;
    status: "queued" | "running" | "succeeded" | "failed" | "unknown" | "canceled";
    errorCode: string | null;
    externalId: string | null;
    createdAt: string;
    finishedAt: string | null;
  }[];
};

export type InboxPage = { items: InboxTicket[]; total: number; page: number; pageSize: TablePreference["pageSize"] };

export type InboundMessage = {
  id: string;
  instanceName: string;
  senderAddress: string;
  senderName: string | null;
  subject: string | null;
  preview: string | null;
  receivedAt: string;
  status: "pending" | "classified" | "discarded";
  customerId: string | null;
  customerName: string | null;
  ticketId: string | null;
  ticketNumber: number | null;
  suggestedCustomerId: string | null;
  suggestedCustomerName: string | null;
};
export type InboundMessagePage = { items: InboundMessage[]; total: number; page: number; pageSize: number };
export type MailboxTicketOption = { id: string; ticketNumber: number; subject: string; customerId: string };

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

export type Product = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
};
export type Version = {
  id: string;
  productId: string;
  version: string;
  status: string;
  releasedAt: string | null;
  releaseNotes: string | null;
  features: string[];
  contents: string[];
  schemaDocument: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
};
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
export type ProductResource = {
  id: string;
  productId: string;
  productVersionId: string | null;
  kind: "information" | "documentation" | "diagram" | "repository" | "demo";
  label: string;
  url: string;
  createdAt: string;
  updatedAt: string;
};
export type ProductCustomer = {
  serviceId: string;
  customerId: string;
  customerName: string;
  planId: string;
  planName: string;
  status: string;
  startsAt: string;
  endsAt: string | null;
};
export type ProductCatalogDetail = Catalog & {
  product: Product;
  resources: ProductResource[];
  customers: ProductCustomer[];
};

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
  status: AttendanceVacationStatus;
  approvedByMembershipId: string | null;
  approvedAt: string | null;
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

export type UsageQuantity = { unit: string; qualifier?: string; quantity: string };
export type UsageEvent = {
  id: string;
  sourceId: string;
  externalId: string;
  occurredAt: string;
  operation: string;
  sku: string;
  status: "observed" | "estimated" | "void";
  quantities: UsageQuantity[];
  createdAt: string;
  customerId?: string;
  productId?: string;
  customerServiceId?: string;
  projectId?: string;
};
export type UsageCost = {
  id: string;
  eventId: string | null;
  adjustmentId: string | null;
  state: "priced" | "unpriced" | "partial";
  originalCostMinor: string | null;
  originalCurrency: string | null;
  reportCostMinor: string | null;
  reportCurrency: string;
};
export type UsageBudget = {
  id: string;
  name: string;
  amountMinor: string;
  currency: string;
  period: "monthly" | "quarterly" | "annual";
  warningBasisPoints: number;
  enabled: boolean;
  sources: { sourceId: string; required: boolean; maxAgeMinutes: number }[];
  customerId?: string;
  productId?: string;
  customerServiceId?: string;
  projectId?: string;
};
export type UsageBudgetEvaluation = {
  budgetId: string;
  amountMinor: string;
  currency: string;
  periodStart: string;
  spentMinor: string;
  hasMissingValuation: boolean;
  state: "healthy" | "warning" | "exceeded" | "partial" | "stale";
  observedThrough: string;
  sources: { required: boolean; lastCompleteAt: string | null; maxAgeMinutes: number }[];
};
export type UsageEventsResponse = { events: UsageEvent[] };
export type UsageSource = { id: string; instanceId: string; operation: string; lastCompleteAt: string | null };
export type UsageSourcesResponse = { sources: UsageSource[] };
export type UsageCostsResponse = { costs: UsageCost[] };
export type UsageBudgetsResponse = { budgets: UsageBudget[] };

/**
 * The connector platform, as the integrations screen sees it.
 *
 * Note what is absent and must stay absent: a credential has no value here and no `keyId`, and a
 * webhook endpoint has no `publicId`. The API cannot send either — the responses are written
 * field by field — and repeating the omission in the type means a screen cannot ask for one.
 */
export type ConnectorHealthStatus = "unknown" | "healthy" | "degraded" | "failing" | "disabled";
export type ConnectorInstanceStatus = "draft" | "enabled" | "disabled" | "error";

export type ConnectorInstance = {
  id: string;
  connectorType: string;
  name: string;
  status: ConnectorInstanceStatus;
  config: Record<string, unknown>;
  configVersion: number;
  health: { status: ConnectorHealthStatus; checkedAt: string | null; lastErrorCode: string | null };
  createdAt: string;
  updatedAt: string;
};

/**
 * One thing an operator has to fill in for this connector, as the catalogue describes it.
 *
 * `required` is not the connector's opinion but its schema's, resolved when the connector was
 * defined, so a form cannot disagree with what the server will accept.
 */
export type ConnectorConfigField = {
  name: string;
  kind: "url" | "text" | "number" | "toggle" | "list";
  /** `connection` is what it takes to reach the provider; `behaviour` is what to do once there. */
  group: "connection" | "behaviour";
  required: boolean;
  /** What the connector already answers for this field, or `null` when it answers nothing. */
  defaultValue: string | number | boolean | string[] | null;
};

export type ConnectorCatalogueEntry = {
  type: string;
  contractVersion: number;
  configFields: ConnectorConfigField[];
  credentialKinds: string[];
  capabilities: {
    egress: { schemes: string[]; destination: string } | null;
    operations: string[];
    actions?: string[];
    ingress: boolean;
    oauth: { provider: "google" | "microsoft" } | null;
  };
};

export type ConnectorCredential = {
  id: string;
  kind: string;
  slot: "primary" | "secondary";
  rotatedAt: string | null;
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};

export type ConnectorEndpoint = { id: string; createdAt: string; revokedAt: string | null };

export type ConnectorRun = {
  id: string;
  operation: string;
  status: "running" | "succeeded" | "failed" | "dead_letter";
  attempt: number;
  configVersion: number;
  startedAt: string;
  finishedAt: string | null;
  errorCode: string | null;
  itemsProcessed: number;
};

export type IntegrationsResponse = { integrations: ConnectorInstance[] };
export type IntegrationResponse = { integration: ConnectorInstance };
export type ConnectorCatalogueResponse = {
  connectors: ConnectorCatalogueEntry[];
  /** False on an installation with no key ring: nothing here can accept a secret. */
  vaultAvailable: boolean;
};
export type ConnectorCredentialsResponse = { credentials: ConnectorCredential[] };
export type ConnectorEndpointsResponse = { endpoints: ConnectorEndpoint[] };
export type ConnectorRunsResponse = { runs: ConnectorRun[]; total: number; page: number; pageSize: number };
/** The only response that carries an address and a secret, and only the once. */
export type CreatedConnectorEndpointResponse = { endpoint: ConnectorEndpoint; path: string; secret: string };

export type ConnectorOAuthGrant = {
  provider: "google" | "microsoft";
  scopes: string[];
  status: "active" | "reauthorization_required" | "revoked";
  accessExpiresAt: string | null;
  lastRefreshedAt: string | null;
};
export type ConnectorOAuthGrantResponse = { grant: ConnectorOAuthGrant | null };
export type ConnectorOAuthAuthorizationResponse = { authorizationUrl: string; expiresAt: string };

/** Everything the screen shows about one integration, loaded together by the page that selects it. */
export type IntegrationDetail = {
  instance: ConnectorInstance;
  endpoints: ConnectorEndpoint[];
  credentials: ConnectorCredential[];
  runs: ConnectorRun[];
  /** How many runs exist in total, so the panel knows whether there is a second page to fetch. */
  runsTotal: number;
  /**
   * Whether this deployment has a key ring at all.
   *
   * Without one the API declares no credential and no endpoint route, so an empty list and a
   * missing route look identical from here. They are not: offering a button that mints a secret
   * on an installation that cannot seal one is offering an operation that always fails.
   */
  vaultAvailable: boolean;
  oauthGrant: ConnectorOAuthGrant | null;
};

/**
 * The infrastructure module.
 *
 * An automation carries `instanceId` and `externalId` and no address: the link to the provider is
 * built here from the base an operator configured, never received. See `lib/infrastructure-link`.
 */
export type AlertSeverity = "critical" | "high" | "normal" | "low";

export type InfrastructureAutomation = {
  instanceId: string;
  externalId: string;
  name: string;
  active: boolean;
  archived: boolean;
  tags: string[];
  /** When the pull that produced this last succeeded. Every observed figure travels with its age. */
  observedAt: string;
  customerId: string | null;
  notes: string | null;
};

/**
 * A project somebody else hosts, read from the provider (phase 7.4).
 *
 * Two fields for production and not one, which is the connector's first decision arriving here:
 * `productionReady` is what is being served right now, `lastFailureAt` is the last build that
 * broke, and both can be true at once. `productionReady` is null, never false, for a project
 * nobody has deployed yet -- an outage of something that never existed is not an outage.
 */
export type InfrastructureDeployedProject = {
  instanceId: string;
  externalId: string;
  name: string;
  /** What it is built with, as the provider names it. Null when it says nothing. */
  framework: string | null;
  /** When the project was created. Context, not a reading: it never goes stale. */
  createdAt: string | null;
  /** The client's own public domain, the one address on this screen that is not the provider's. */
  domain: string | null;
  productionReady: boolean | null;
  /** What the provider calls it: `READY`, `ERROR`, `BUILDING`. Null when nothing is deployed. */
  productionState: string | null;
  /** When what production serves was built, which is the last good build while it is serving. */
  productionDeployedAt: string | null;
  lastFailureAt: string | null;
  lastFailureRef: string | null;
  /** When the pull that produced this last succeeded. Every observed figure travels with its age. */
  observedAt: string;
  customerId: string | null;
  notes: string | null;
};

/**
 * A Supabase project as the API hands it over. No connection host, no organisation id: what the
 * connector reads is kept off this screen the same way a Vercel project's API token is.
 *
 * `healthy` is null, never false, for a project mid-transition -- restoring, upgrading, resizing
 * -- because none of those are an outage.
 */
export type InfrastructureSupabaseProject = {
  instanceId: string;
  externalId: string;
  name: string;
  /** Where the provider hosts it, as it names the region. Null when it says nothing. */
  region: string | null;
  /** What the provider calls it: `ACTIVE_HEALTHY`, `INACTIVE`, `RESTORING`. */
  status: string | null;
  healthy: boolean | null;
  /** When the project was created. Context, not a reading: it never goes stale. */
  createdAt: string | null;
  /** When the pull that produced this last succeeded. Every observed figure travels with its age. */
  observedAt: string;
  customerId: string | null;
  notes: string | null;
};

export type InfrastructureAlert = {
  id: string;
  ruleId: string;
  ruleName: string;
  dedupKey: string;
  status: "firing" | "resolved";
  severity: AlertSeverity;
  /** Small, flat and ours: identifiers and counts the domain built, never a provider payload. */
  summary: Record<string, string>;
  startedAt: string;
  lastSeenAt: string;
  occurrences: number;
  resolvedAt: string | null;
  acknowledgedAt: string | null;
  acknowledgedByMembershipId: string | null;
  incidentId: string | null;
};

export type InfrastructureOverview = {
  automations: { total: number; active: number; linked: number };
  alerts: { total: number; acknowledged: number; bySeverity: Record<AlertSeverity, number> };
  /** The oldest reading behind the counts, or null when there is nothing to summarise. */
  observedFrom: string | null;
};

/** The one kind of rule phase 7.1 ships. A union, so a kind the API adds is a compile error here. */
export type AlertRuleKind = "workflow_failed" | "service_down" | "certificate_expiring" | "backup_stale";

export type InfrastructureAlertRule = {
  id: string;
  name: string;
  kind: AlertRuleKind;
  instanceId: string;
  targetType: "instance" | "automation";
  /** The `externalId` of the one automation being watched, or null for all of them. */
  targetId: string | null;
  severity: AlertSeverity;
  params: Record<string, unknown>;
  /** How old the data may be before the rule stops claiming to know anything. */
  freshnessSeconds: number;
  opensIncident: boolean;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type InfrastructureAlertRulesResponse = { rules: InfrastructureAlertRule[] };

export type InfrastructureOverviewResponse = { overview: InfrastructureOverview };
export type InfrastructureAutomationsResponse = { automations: InfrastructureAutomation[] };
export type InfrastructureProjectsResponse = { projects: InfrastructureDeployedProject[] };
export type InfrastructureSupabaseProjectsResponse = { projects: InfrastructureSupabaseProject[] };
export type InfrastructureAlertsResponse = { alerts: InfrastructureAlert[] };

/**
 * The inventory with what is currently known of it (phase 7.2, increment B4).
 *
 * The state is the API's and never recomputed here: the same `currentReading` that decides
 * whether a `service_down` alert fires decides what this screen draws, so a green row and a live
 * alert cannot describe one machine at the same time. `unknown` is the third answer and not a
 * shade of `down` -- it is the collector we have lost sight of, and a screen that drew it as
 * `down` would be reporting an outage of its own making.
 */
export type ObservedState = "up" | "down" | "unknown";

/** What a projection carries: flat scalars, named field by field on the way out of the API. */
export type ReadingValue = string | number | boolean | null;

export type Reading = {
  state: ObservedState;
  /** When the figure below was read, or null when there is none. Never drawn as an age of zero. */
  observedAt: string | null;
  /**
   * Which connector instance read this, or null when nothing was read.
   *
   * Ours and never the provider's: the id of a row in `connector_instances`, the same one every
   * automation and alert rule on this screen already carries. It is what the fleet is filtered by
   * and what a machine's own page names as the source of its figures.
   */
  instanceId: string | null;
  data: Record<string, ReadingValue>;
};

export type HostEnvironment = "production" | "staging" | "development";
export type ServiceKind = "container" | "http" | "database" | "automation" | "backup";
export type ServiceExpectedState = "up" | "stopped" | "ignored";

export type InfrastructureHost = {
  id: string;
  name: string;
  /** The label a reading is matched to this machine by, which is why it cannot be empty. */
  hostname: string;
  environment: HostEnvironment;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type InfrastructureService = {
  id: string;
  hostId: string;
  name: string;
  kind: ServiceKind;
  /** How the service is observed: the whole `external_id` of the record, prefix included. */
  matchKey: string;
  expectedState: ServiceExpectedState;
  customerId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ObservedService = InfrastructureService & { reading: Reading };
/**
 * A machine as the inventory hands it over.
 *
 * `services` is what somebody declared on it -- what alert rules are about. `observed` is
 * what the collectors have actually seen on one of its labels, declared or not, because
 * declaring means "I want alerts about this" and not "I want to see this", and the machine's
 * page answers the second question. What is in both appears in `observed` with
 * `declared: true`.
 *
 * `labels` is the other names the machine answers to, beside its `hostname`: a Prometheus
 * aggregates by scrape target, so one VPS reports under several.
 */
export type ObservedHost = InfrastructureHost & {
  reading: Reading;
  services: ObservedService[];
  labels: string[];
  observed: DiscoveredService[];
};

/** How many things are in each state. Counted by the API; a screen that re-counted could differ. */
export type ObservedTally = { total: number; up: number; down: number; unknown: number };

export type InventorySummary = { hosts: ObservedTally; services: ObservedTally };

export type InfrastructureInventory = {
  hosts: ObservedHost[];
  /** The machines and the services counted by state, from the same readings the rows carry. */
  summary: InventorySummary;
  /** The oldest reading behind the screen, or null when nothing has been read yet. */
  observedFrom: string | null;
};

export type InfrastructureInventoryResponse = { inventory: InfrastructureInventory };
export type InfrastructureHostResponse = { host: InfrastructureHost };
export type InfrastructureServiceResponse = { service: InfrastructureService };

/**
 * The guided check, as it crosses the wire.
 *
 * Every rung says what it is and how it went, and the evidence is deliberately narrow: migration
 * file names and `instance` labels, each with the total behind them so a list cut short is drawn
 * as one. No address, no credential and no provider hostname appears here, because none is in the
 * answer -- the sentence that needs one is composed in the browser out of what was just typed.
 */
export type ConnectorDiagnosisStep =
  "migrations" | "allowlist" | "reachable" | "answers_prometheus" | "scraping" | "matching";

export type ConnectorDiagnosisStatus = "passed" | "failed" | "unknown" | "unchecked";

export type ConnectorDiagnosisEvidence = { values: string[]; total: number };

export type ConnectorDiagnosisFinding = {
  step: ConnectorDiagnosisStep;
  status: ConnectorDiagnosisStatus;
  code: string | null;
  evidence: Partial<Record<"migrations" | "seen" | "declared", ConnectorDiagnosisEvidence>>;
};

export type ConnectorDiagnosis = {
  /** The first rung that does not hold, or `null` when the whole chain does. */
  problem: ConnectorDiagnosisStep | null;
  findings: ConnectorDiagnosisFinding[];
};

export type ConnectorDiagnosisResponse = { diagnosis: ConnectorDiagnosis };

/**
 * One label a collector has stored a reading for, and the machine it was declared as if it was.
 *
 * The label is what the collector calls it, which is exactly the field that gets typed wrongly
 * the first time; `declaredAs` is the record it matched, so a screen can link to it instead of
 * offering to declare something twice.
 */
export type DiscoveredInstance = {
  label: string;
  declaredAs: { hostId: string; name: string } | null;
};

export type ConnectorDiscoveryResponse = { instances: DiscoveredInstance[] };

/**
 * One thing a collector has seen that could become a declared service.
 *
 * `seenOn` is the label of whoever saw it -- for a container, the cAdvisor, which is not the
 * label the machine is declared under. It is shown so a person with two machines can tell them
 * apart, and it is never matched on.
 */
export type DiscoveredService = {
  matchKey: string;
  kind: ServiceKind;
  name: string;
  seenOn: string | null;
  declared: boolean;
  /** What is currently known of it, decided by the same rule that decides a declared service. */
  reading: Reading;
};

export type ConnectorServicesResponse = { services: DiscoveredService[] };

/**
 * What an agent is asking for, as the API resolved it.
 *
 * Every field here is the API's answer and not the query string the browser arrived with: the name
 * is the registered one, the scopes are the ones this reader could actually back, and the address
 * is the one already matched against the client's registrations. The screen renders this and never
 * the request, which is what keeps a composed URL from describing itself generously.
 */
export type McpConsentRequest = {
  clientId: string;
  clientName: string;
  clientKind: "public" | "confidential";
  redirectUri: string;
  scopes: string[];
  resource: string;
  /** ISO 8601. When the consent would lapse if it is given now. */
  grantExpiresAt: string;
  /** True when the client registered itself and this approval is what claims it for the tenant. */
  unclaimed: boolean;
};

/** Where to send the browser once the decision is recorded: to the client, either way. */
export type McpConsentDecisionResponse = { redirectTo: string };

/**
 * A registered client, as the security screen lists it.
 *
 * The secret is absent in every shape here and not by omission: a confidential client is handed
 * one when it is registered and never again, so a listing that carried it would be a listing worth
 * stealing.
 */
export type McpClientRow = {
  id: string;
  clientId: string;
  name: string;
  kind: "public" | "confidential";
  redirectUris: string[];
  maxScopes: string[];
  status: "active" | "suspended";
  createdAt: string;
};

/**
 * The clients, plus the two facts the panel must not work out for itself: the vocabulary a
 * ceiling may be drawn from, and the address an agent is pointed at.
 */
export type McpClientsResponse = { clients: McpClientRow[]; scopes: string[]; resource: string };

export type McpGrantRow = {
  id: string;
  clientId: string | null;
  clientName: string | null;
  actorType: "user" | "service_account";
  actorMembershipId: string | null;
  actorServiceAccountId: string | null;
  scopes: string[];
  status: "active" | "revoked" | "expired" | "suspended";
  consentedAt: string;
  expiresAt: string;
  revokedAt: string | null;
  /** Null until an agent uses it. The field that tells a stale consent from a working one. */
  lastUsedAt: string | null;
};

export type McpGrantsResponse = { grants: McpGrantRow[] };

export type McpServiceAccountRow = {
  id: string;
  name: string;
  ownerMembershipId: string;
  scopes: string[];
  permissions: string[];
  expiresAt: string;
  disabledAt: string | null;
  secretRotatedAt: string | null;
  createdAt: string;
};

/** The accounts, plus the scopes this reader could actually back -- not the whole vocabulary. */
export type McpServiceAccountsResponse = { serviceAccounts: McpServiceAccountRow[]; grantableScopes: string[] };

export type SecretMetadataResponse = {
  provider: {
    kind: "environment" | "runtime_files" | "bitwarden";
    health: "available" | "warning" | "not_observed" | "not_applicable";
    checkedAt: string;
  };
  secrets: Array<{
    name: string;
    source: "environment" | "file" | "external_manager" | "not_observed" | "not_applicable";
    configured: boolean | null;
    consumers: string[];
    loadedAt: string | null;
    lastRotatedAt: string | null;
    version: string | null;
    health: "available" | "warning" | "not_observed" | "not_applicable";
  }>;
};

export type PasswordManagerInstallation = {
  id: string;
  displayName: string;
  provider: "bitwarden";
  baseUrl: string;
  deploymentMode: "cloud" | "self_hosted_shared_vps" | "self_hosted_dedicated_vps";
  status: "active" | "degraded" | "disabled";
  lastReviewedAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type CredentialCatalogEntry = {
  id: string;
  installationId: string;
  clientId: string | null;
  companySubscriptionId: string | null;
  applicationName: string;
  category: "hosting" | "email" | "domain" | "website_admin" | "billing" | "social" | "infrastructure" | "other";
  environment: "production" | "staging" | "development" | "other";
  accountLabel: string | null;
  ownerMembershipId: string;
  status: "active" | "review_due" | "revoked" | "archived";
  reviewDueAt: string | null;
  lastReviewedAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
};

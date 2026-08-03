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
  contacts: {
    id: string;
    name: string;
    role: string | null;
    email: string | null;
    phone: string | null;
    isPrimary: boolean;
  }[];
  notes: { id: string; body: string; createdAt: string }[];
  tasks: { id: string; title: string; dueAt: string | null; completedAt: string | null }[];
  activity: { id: string; type: string; occurredAt: string }[];
};

export type CrmSummary = {
  leadsByStatus: Record<string, number>;
  activeCustomers: number;
  openTasks: number;
  overdueTasks: number;
};

export type ImportResult = { row: number; status: string; code?: string };

export type Product = { id: string; code: string; name: string; status: string };
export type Version = { id: string; productId: string; version: string; status: string };
export type Plan = { id: string; productVersionId: string; code: string; name: string; status: string };
export type BillingInterval = "free" | "monthly" | "quarterly" | "semiannual" | "annual";

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
  status: "active" | "trial" | "canceled";
  currency: string;
  amountMinor: number;
  interval: "monthly" | "quarterly" | "semiannual" | "annual";
  renewalAt: string | null;
  renewalAlertDays: number;
  autoRenew: boolean;
  websiteUrl: string | null;
};

/** Response envelopes, named after the route that returns them. */
export type TablePreferenceResponse = { preference: TablePreference };
export type CustomerDetailResponse = { customer: CustomerDetail };
export type CompanySubscriptionsResponse = { subscriptions: CompanySubscription[] };
export type CustomerSubscriptionsResponse = { subscriptions: CustomerSubscription[] };
export type FinancialSummaryResponse = { metrics: FinancialMetric[] };
export type RenewalAlertsResponse = { alerts: RenewalAlert[] };
export type ImportResultsResponse = { results: ImportResult[] };
export type ErrorResponse = { code?: string; error?: { code?: string } };

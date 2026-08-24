export const permissionCodes = [
  "tenant:manage",
  "members:manage",
  "roles:manage",
  "audit:read",
  "customers:read",
  "customers:manage",
  "leads:read",
  "leads:manage",
  "projects:read",
  "projects:manage",
  "time:log",
  "time:manage",
  "rates:manage",
  "products:manage",
  "subscriptions:manage",
  "financials:read",
  "tickets:read",
  "tickets:manage",
  "support:configure",
  "attendance:record",
  "attendance:manage",
  "attendance:holidays",
  "attendance:vacations",
  "infrastructure:read",
  "infrastructure:operate",
  "integrations:read",
  "integrations:manage",
  "credentials:rotate",
  "usage:read",
  "usage:manage",
  "budgets:manage",
  "security:manage"
] as const;

export type Permission = (typeof permissionCodes)[number];
export type RoleCode = "owner" | "administrator" | "technical";

export const rolePermissions: Record<RoleCode, readonly Permission[]> = {
  owner: permissionCodes,
  administrator: [
    "members:manage",
    "roles:manage",
    "audit:read",
    "customers:read",
    "customers:manage",
    "leads:read",
    "leads:manage",
    "projects:read",
    "projects:manage",
    "time:log",
    "time:manage",
    "products:manage",
    "subscriptions:manage",
    "financials:read",
    "tickets:read",
    "tickets:manage",
    "support:configure",
    "attendance:record",
    "attendance:manage",
    "attendance:holidays",
    "attendance:vacations",
    "infrastructure:read",
    "integrations:read",
    "usage:read",
    "budgets:manage"
  ],
  technical: [
    "audit:read",
    "customers:read",
    "leads:read",
    "projects:read",
    "projects:manage",
    // Technical logs its own hours and never sees a rate: `time:manage`, `rates:manage` and
    // `financials:read` are all absent, and cost is what those three protect.
    "time:log",
    "tickets:read",
    "tickets:manage",
    // Fitxa i llegeix el seu registre, i no el de ningu mes: `attendance:manage` revela patrons
    // de presencia, que son dada personal, i per aixo no acompanya els permisos operatius.
    "attendance:record",
    "infrastructure:read",
    "infrastructure:operate",
    "integrations:read",
    "integrations:manage",
    "credentials:rotate",
    "usage:read",
    "security:manage"
  ]
};

export const leadStatuses = ["new", "contacted", "qualified", "proposal", "won", "lost"] as const;
export type LeadStatus = (typeof leadStatuses)[number];
export const leadPriorities = ["low", "normal", "high", "urgent"] as const;
export type LeadPriority = (typeof leadPriorities)[number];

const leadTransitions: Record<LeadStatus, readonly LeadStatus[]> = {
  new: ["contacted", "qualified", "proposal", "lost"],
  contacted: ["new", "qualified", "proposal", "lost"],
  qualified: ["new", "contacted", "proposal", "lost"],
  proposal: ["new", "contacted", "qualified", "lost"],
  won: [],
  lost: []
};

export function canTransitionLead(from: LeadStatus, to: LeadStatus): boolean {
  return leadTransitions[from].includes(to);
}

/** The newest active state wins; old activity rows may not contain a state at all. */
export function recoverLeadStatus(history: readonly (LeadStatus | null)[]): Exclude<LeadStatus, "won" | "lost"> {
  return history.find((status) => status !== null && status !== "won" && status !== "lost") ?? "new";
}

export function normalizeEmail(value: string): string {
  return value.trim().toLocaleLowerCase("en-US");
}

export function normalizePhone(value: string): string {
  const trimmed = value.trim();
  const prefix = trimmed.startsWith("+") ? "+" : "";
  return prefix + trimmed.replace(/\D/g, "");
}

export function normalizeComparableName(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export type TenantContext = {
  tenantId: string;
  membershipId: string;
  userId: string;
  roles: RoleCode[];
  permissions: Permission[];
  mfaEnabled: boolean;
};

export function hasPermission(context: TenantContext, permission: Permission): boolean {
  return context.permissions.includes(permission);
}

export const billingIntervals = ["free", "one_time", "monthly", "quarterly", "semiannual", "annual"] as const;
export type BillingInterval = (typeof billingIntervals)[number];
export const commercialModels = ["subscription", "maintenance", "one_time", "project_service"] as const;
export type CommercialModel = (typeof commercialModels)[number];
export function isCommercialIntervalAllowed(model: CommercialModel, interval: BillingInterval): boolean {
  const oneTime = model === "one_time" || model === "project_service";
  return oneTime ? interval === "one_time" : interval !== "one_time";
}
export const subscriptionStatuses = ["active", "paused", "canceled"] as const;
export type SubscriptionStatus = (typeof subscriptionStatuses)[number];

export type RecurringMoney = { amountMinor: number; costMinor: number; interval: BillingInterval; quantity: number };

function assertSafeMoney(value: number, name: string) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`INVALID_${name.toUpperCase()}`);
}

export function annualizeMinor(amountMinor: number, interval: BillingInterval, quantity = 1): number {
  assertSafeMoney(amountMinor, "amount");
  assertSafeMoney(quantity, "quantity");
  const multiplier: Record<BillingInterval, number> = {
    free: 0,
    one_time: 0,
    monthly: 12,
    quarterly: 4,
    semiannual: 2,
    annual: 1
  };
  const result = BigInt(amountMinor) * BigInt(quantity) * BigInt(multiplier[interval]);
  if (result > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("MONEY_OVERFLOW");
  return Number(result);
}

export function monthlyFromAnnualMinor(annualMinor: number): number {
  assertSafeMoney(annualMinor, "annual");
  return Number((BigInt(annualMinor) + 6n) / 12n);
}

export function recurringMetrics(input: RecurringMoney) {
  const arrMinor = annualizeMinor(input.amountMinor, input.interval, input.quantity);
  const annualCostMinor = annualizeMinor(input.costMinor, input.interval, input.quantity);
  return {
    mrrMinor: monthlyFromAnnualMinor(arrMinor),
    arrMinor,
    annualCostMinor,
    annualMarginMinor: arrMinor - annualCostMinor
  };
}

export function taxMinor(netMinor: number, taxBasisPoints: number): number {
  assertSafeMoney(netMinor, "net");
  if (!Number.isInteger(taxBasisPoints) || taxBasisPoints < 0 || taxBasisPoints > 10000) throw new Error("INVALID_TAX");
  const numerator = BigInt(netMinor) * BigInt(taxBasisPoints);
  const result = (numerator + 5000n) / 10000n;
  if (result > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("MONEY_OVERFLOW");
  return Number(result);
}

export function nextRenewalAt(current: Date, interval: BillingInterval): Date | null {
  if (Number.isNaN(current.getTime())) throw new Error("INVALID_RENEWAL_DATE");
  const months: Record<BillingInterval, number> = {
    free: 0,
    one_time: 0,
    monthly: 1,
    quarterly: 3,
    semiannual: 6,
    annual: 12
  };
  if (interval === "free" || interval === "one_time") return null;
  const result = new Date(current);
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months[interval]);
  const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
  result.setUTCDate(Math.min(day, lastDay));
  return result;
}

export {
  businessMinutesBetween,
  overlappingWindows,
  type SupportCalendar,
  type SupportWindow
} from "./support-calendar.js";
export * from "./support.js";
export * from "./projects.js";
export * from "./attendance.js";
export * from "./connectors.js";
export * from "./egress.js";
export * from "./infrastructure.js";
export * from "./connector-diagnosis.js";
export * from "./usage.js";
export { localDay, localParts, type LocalParts } from "./tenant-clock.js";

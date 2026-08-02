export const permissionCodes = [
  "tenant:manage", "members:manage", "roles:manage", "audit:read", "customers:read", "customers:manage", "leads:read", "leads:manage",
  "projects:manage", "products:manage", "subscriptions:manage", "financials:read", "tickets:manage",
  "infrastructure:read", "infrastructure:operate", "integrations:read", "integrations:manage",
  "credentials:rotate", "usage:read", "security:manage"
] as const;

export type Permission = typeof permissionCodes[number];
export type RoleCode = "owner" | "administrator" | "technical";

export const rolePermissions: Record<RoleCode, readonly Permission[]> = {
  owner: permissionCodes,
  administrator: ["members:manage", "roles:manage", "audit:read", "customers:read", "customers:manage", "leads:read", "leads:manage", "projects:manage", "products:manage", "subscriptions:manage", "financials:read", "tickets:manage", "infrastructure:read", "integrations:read", "usage:read"],
  technical: ["audit:read", "customers:read", "leads:read", "projects:manage", "tickets:manage", "infrastructure:read", "infrastructure:operate", "integrations:read", "integrations:manage", "credentials:rotate", "usage:read", "security:manage"]
};

export const leadStatuses = ["new", "contacted", "qualified", "proposal", "won", "lost"] as const;
export type LeadStatus = typeof leadStatuses[number];
export const leadPriorities = ["low", "normal", "high", "urgent"] as const;
export type LeadPriority = typeof leadPriorities[number];

const leadTransitions: Record<LeadStatus, readonly LeadStatus[]> = {
  new: ["contacted", "qualified", "lost"],
  contacted: ["qualified", "lost"],
  qualified: ["proposal", "lost"],
  proposal: ["lost"],
  won: [],
  lost: []
};

export function canTransitionLead(from: LeadStatus, to: LeadStatus): boolean {
  return leadTransitions[from].includes(to);
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
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("en-US").replace(/[^a-z0-9]+/g, " ").trim();
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

export const permissionCodes = [
  "tenant:manage", "members:manage", "roles:manage", "audit:read", "customers:manage", "leads:manage",
  "projects:manage", "products:manage", "subscriptions:manage", "financials:read", "tickets:manage",
  "infrastructure:read", "infrastructure:operate", "integrations:read", "integrations:manage",
  "credentials:rotate", "usage:read", "security:manage"
] as const;

export type Permission = typeof permissionCodes[number];
export type RoleCode = "owner" | "administrator" | "technical";

export const rolePermissions: Record<RoleCode, readonly Permission[]> = {
  owner: permissionCodes,
  administrator: ["members:manage", "roles:manage", "audit:read", "customers:manage", "leads:manage", "projects:manage", "products:manage", "subscriptions:manage", "financials:read", "tickets:manage", "infrastructure:read", "integrations:read", "usage:read"],
  technical: ["audit:read", "projects:manage", "tickets:manage", "infrastructure:read", "infrastructure:operate", "integrations:read", "integrations:manage", "credentials:rotate", "usage:read", "security:manage"]
};

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

import { randomUUID } from "node:crypto";
import { withTenant, type DatabaseClient } from "@control-hub/database";
import { hasPermission, type Permission, type RoleCode, type TenantContext } from "@control-hub/domain";
import type { FastifyRequest } from "fastify";
import type { ControlHubAuth } from "./auth.js";

export class ApiSecurityError extends Error {
  constructor(
    public readonly statusCode: 401 | 403,
    public readonly code: string
  ) {
    super(code);
  }
}

export async function resolveTenantContext(
  auth: ControlHubAuth,
  database: DatabaseClient,
  request: FastifyRequest
): Promise<TenantContext> {
  const session = await auth.api.getSession({ headers: new Headers(request.headers as HeadersInit) });
  if (!session) throw new ApiSecurityError(401, "AUTHENTICATION_REQUIRED");
  const selected =
    typeof request.headers["x-control-hub-tenant"] === "string" ? request.headers["x-control-hub-tenant"] : null;
  if (selected && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(selected))
    throw new ApiSecurityError(403, "TENANT_ACCESS_DENIED");
  const rows = await database<
    { tenant_id: string; membership_id: string; role: RoleCode | null; permission: Permission | null }[]
  >`
    select m.tenant_id, m.id as membership_id, r.code as role, rp.permission_code as permission
    from memberships m
    left join membership_roles mr on mr.membership_id = m.id
    left join roles r on r.id = mr.role_id and r.tenant_id = m.tenant_id
    left join role_permissions rp on rp.role_id = r.id
    where m.user_id = ${session.user.id} and m.status = 'active'
      and (${selected}::uuid is null or m.tenant_id = ${selected}::uuid)
    order by m.created_at asc
  `;
  if (rows.length === 0) throw new ApiSecurityError(403, "TENANT_ACCESS_DENIED");
  if (new Set(rows.map((row) => row.tenant_id)).size > 1 && !selected)
    throw new ApiSecurityError(403, "TENANT_SELECTION_REQUIRED");
  return {
    tenantId: rows[0]!.tenant_id,
    membershipId: rows[0]!.membership_id,
    userId: session.user.id,
    roles: [...new Set(rows.flatMap((row) => (row.role ? [row.role] : [])))],
    permissions: [...new Set(rows.flatMap((row) => (row.permission ? [row.permission] : [])))],
    mfaEnabled: Boolean("twoFactorEnabled" in session.user && session.user.twoFactorEnabled)
  };
}

export function requirePermission(context: TenantContext, permission: Permission) {
  if (!context.mfaEnabled) throw new ApiSecurityError(403, "MFA_REQUIRED");
  if (!hasPermission(context, permission)) throw new ApiSecurityError(403, "PERMISSION_DENIED");
}

export async function writeAudit(
  database: DatabaseClient,
  context: TenantContext,
  request: FastifyRequest,
  event: {
    action: string;
    targetType: string;
    targetId?: string;
    outcome: "success" | "denied" | "failure";
    metadata?: Record<string, string | number | boolean | null>;
  }
) {
  await withTenant(database, context.tenantId, async (transaction) => {
    await transaction`insert into audit_log (id, tenant_id, actor_user_id, action, target_type, target_id, outcome, ip_address, user_agent, metadata)
      values (${randomUUID()}, ${context.tenantId}, ${context.userId}, ${event.action}, ${event.targetType}, ${event.targetId ?? null}, ${event.outcome},
      ${request.ip}, ${request.headers["user-agent"] ?? null}, ${transaction.json(event.metadata ?? {})})`;
  });
}

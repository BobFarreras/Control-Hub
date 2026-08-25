import { randomUUID } from "node:crypto";
import { withTenant, type DatabaseClient } from "@control-hub/database";
import { hasPermission, type Permission, type RoleCode, type TenantContext } from "@control-hub/domain";
import type { FastifyRequest } from "fastify";
import { sessionFreshAge, type ControlHubAuth } from "./auth.js";

export class ApiSecurityError extends Error {
  constructor(
    public readonly statusCode: 401 | 403,
    public readonly code: string
  ) {
    super(code);
  }
}

/**
 * Every account in Control Hub is a staff account, so the second factor is required for all
 * of them rather than for a privileged subset.
 *
 * The check lives here, not in `requirePermission`, because every authenticated route calls
 * this function while only most of them guard a permission. Enforcing it at the permission
 * check left a route that resolved a context but guarded nothing with no second-factor gate
 * at all, and nothing would have reported that.
 *
 * `allowWithoutSecondFactor` exists for the handful of routes a user must reach in order to
 * enrol: refusing those would leave a new member unable to ever set up the factor being
 * demanded of them. Pass it deliberately, never to make a failing test pass.
 */
/**
 * `requireFreshSession` is the other direction: not "have you enrolled a factor" but "did you prove
 * it recently". Consenting to an MCP client is the operation it exists for -- it hands an agent
 * ninety days of read access to a tenant, which is exactly the kind of thing an unattended laptop
 * should not be able to do. The window is better-auth's own `freshAge`, so the answer here and the
 * answer better-auth gives for changing a password are the same answer.
 */
export type TenantContextOptions = { allowWithoutSecondFactor?: boolean; requireFreshSession?: boolean };

export async function resolveTenantContext(
  auth: ControlHubAuth,
  database: DatabaseClient,
  request: FastifyRequest,
  options: TenantContextOptions = {}
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
  const context: TenantContext = {
    tenantId: rows[0]!.tenant_id,
    membershipId: rows[0]!.membership_id,
    userId: session.user.id,
    roles: [...new Set(rows.flatMap((row) => (row.role ? [row.role] : [])))],
    permissions: [...new Set(rows.flatMap((row) => (row.permission ? [row.permission] : [])))],
    mfaEnabled: Boolean("twoFactorEnabled" in session.user && session.user.twoFactorEnabled)
  };
  if (!options.allowWithoutSecondFactor && !context.mfaEnabled) throw new ApiSecurityError(403, "MFA_REQUIRED");
  if (options.requireFreshSession && !isFresh(session, new Date()))
    throw new ApiSecurityError(403, "SESSION_NOT_FRESH");
  return context;
}

/**
 * Whether this session was established recently enough to authorise something sensitive.
 *
 * Measured from when the session was created rather than from when it was last touched: extending
 * a session because somebody has the panel open in a tab is not evidence that the person is still
 * the one at the keyboard, and treating it as such would make the window meaningless for any
 * session in daily use.
 *
 * A session with no readable creation time is not fresh. The alternative -- assuming it is -- turns
 * a shape this code did not expect into an approval nobody made.
 */
function isFresh(session: unknown, now: Date): boolean {
  const record = session as { session?: { createdAt?: unknown } };
  const createdAt = record.session?.createdAt;
  const created = createdAt instanceof Date ? createdAt : typeof createdAt === "string" ? new Date(createdAt) : null;
  if (!created || Number.isNaN(created.getTime())) return false;
  return now.getTime() - created.getTime() <= sessionFreshAge * 1000;
}

export function requirePermission(context: TenantContext, permission: Permission) {
  // The second factor is already settled by resolveTenantContext; this only decides authority.
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

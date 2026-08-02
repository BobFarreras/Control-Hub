import type { DatabaseClient } from "@control-hub/database";
import { withTenant } from "@control-hub/database";
import type { RoleCode, TenantContext } from "@control-hub/domain";

export class IdentityInvariantError extends Error {}

export async function listMembers(database: DatabaseClient, context: TenantContext) {
  return withTenant(database, context.tenantId, async (tx) => tx`
    select m.id, u.name, u.email, m.status, coalesce(array_agg(r.code) filter (where r.code is not null), '{}') as roles
    from memberships m join "user" u on u.id = m.user_id
    left join membership_roles mr on mr.membership_id = m.id left join roles r on r.id = mr.role_id
    where m.tenant_id = ${context.tenantId} group by m.id, u.name, u.email order by u.name
  `);
}

export async function assignMemberRole(database: DatabaseClient, context: TenantContext, membershipId: string, roleCode: RoleCode) {
  return withTenant(database, context.tenantId, async (tx) => {
    const target = await tx<{ id: string; is_owner: boolean }[]>`
      select m.id, exists(select 1 from membership_roles mr join roles r on r.id = mr.role_id where mr.membership_id = m.id and r.code = 'owner') as is_owner
      from memberships m where m.id = ${membershipId} and m.tenant_id = ${context.tenantId} for update
    `;
    if (!target[0]) throw new IdentityInvariantError("MEMBERSHIP_NOT_FOUND");
    if ((target[0].is_owner || roleCode === "owner") && !context.roles.includes("owner")) throw new IdentityInvariantError("OWNER_ROLE_REQUIRES_OWNER");
    if (target[0].is_owner && roleCode !== "owner") {
      const owners = await tx<{ count: number }[]>`select count(distinct mr.membership_id)::int as count from membership_roles mr join roles r on r.id = mr.role_id where r.tenant_id = ${context.tenantId} and r.code = 'owner'`;
      if (owners[0]?.count === 1) throw new IdentityInvariantError("LAST_OWNER_REQUIRED");
    }
    const role = await tx<{ id: string }[]>`select id from roles where tenant_id = ${context.tenantId} and code = ${roleCode}`;
    if (!role[0]) throw new IdentityInvariantError("ROLE_NOT_FOUND");
    await tx`delete from membership_roles mr using roles r where mr.role_id = r.id and mr.membership_id = ${membershipId} and r.tenant_id = ${context.tenantId}`;
    await tx`insert into membership_roles (membership_id, role_id) values (${membershipId}, ${role[0].id})`;
  });
}

export async function listAuditEvents(database: DatabaseClient, context: TenantContext) {
  return withTenant(database, context.tenantId, async (tx) => tx`
    select id, actor_user_id as "actorUserId", action, target_type as "targetType", target_id as "targetId", outcome, metadata, created_at as "createdAt"
    from audit_log where tenant_id = ${context.tenantId} order by created_at desc limit 100
  `);
}

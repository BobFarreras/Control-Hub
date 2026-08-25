import { randomUUID } from "node:crypto";
import type { McpActorIdentity, McpSessionRepository, McpTenantScope } from "@control-hub/application";
import { withTenant, type DatabaseClient } from "@control-hub/database";
import type { Permission, RoleCode } from "@control-hub/domain";

/**
 * What a live MCP call reads and writes: who the actor is now, and what they just did.
 *
 * Separate from `PostgresMcpOauthRepository` because it answers a different question. That class
 * owns credentials -- minting, hashing, rotating, revoking. This one owns the moment a credential
 * is spent: it resolves the authority behind a token at the instant of the call, and it appends the
 * record of the call. Keeping them apart means the store that can read a permission holds no method
 * that can mint a token.
 *
 * Both methods run inside `withTenant`. The tenant is already settled by the time either is
 * reached -- the bearer resolved it -- so there is no pre-tenant read here and no security definer
 * function to go with one.
 */
export class PostgresMcpSessionRepository implements McpSessionRepository {
  constructor(private readonly database: DatabaseClient) {}

  /**
   * The permissions behind a token, read now rather than carried in it.
   *
   * A user's come from their membership, exactly as the REST surface resolves them, which is what
   * makes the two answer identically. A service account's come from its own row and are narrower
   * than its owner's by construction; it is given no roles, because it holds none -- an agent has
   * the permissions it was granted and nothing a role would imply on top.
   */
  resolveActor(
    scope: McpTenantScope,
    input: {
      readonly actorType: "user" | "service_account";
      readonly membershipId: string | null;
      readonly serviceAccountId: string | null;
    }
  ): Promise<McpActorIdentity | null> {
    return withTenant(this.database, scope.tenantId, async (tx) => {
      if (input.actorType === "user") {
        if (!input.membershipId) return null;
        const rows = await tx<Array<{ userId: string; role: RoleCode | null; permission: Permission | null }>>`
          select m.user_id as "userId", r.code as role, rp.permission_code as permission
          from memberships m
          left join membership_roles mr on mr.membership_id = m.id
          left join roles r on r.id = mr.role_id and r.tenant_id = m.tenant_id
          left join role_permissions rp on rp.role_id = r.id
          where m.tenant_id = ${scope.tenantId} and m.id = ${input.membershipId} and m.status = 'active'`;
        // No rows means the membership was removed or disabled. Nothing revokes a token at that
        // moment, so an empty answer here is what stops one that outlived its person.
        if (rows.length === 0) return null;
        return {
          membershipId: input.membershipId,
          userId: rows[0]!.userId,
          roles: [...new Set(rows.flatMap((row) => (row.role ? [row.role] : [])))],
          permissions: [...new Set(rows.flatMap((row) => (row.permission ? [row.permission] : [])))]
        };
      }

      if (!input.serviceAccountId) return null;
      const [row] = await tx<Array<{ membershipId: string; userId: string; permissions: Permission[] }>>`
        select s.owner_membership_id as "membershipId", m.user_id as "userId", s.permissions
        from mcp_service_accounts s
        join memberships m on m.tenant_id = s.tenant_id and m.id = s.owner_membership_id
        where s.tenant_id = ${scope.tenantId} and s.id = ${input.serviceAccountId}
          and s.disabled_at is null and s.expires_at > now()
          and m.status = 'active'`;
      // The owner's membership is joined, not assumed: an agent whose owner has left the tenant
      // stops working, which is the point of recording an owner at all.
      if (!row) return null;
      return { membershipId: row.membershipId, userId: row.userId, roles: [], permissions: row.permissions };
    });
  }

  /**
   * One `audit_log` row per tool call, in the same table every other action lands in.
   *
   * A separate table would have made "what happened in this tenant" two queries that have to be
   * merged, and the merged view is the one anybody actually wants. The three columns migration
   * `0049` added are what tell the rows apart: `source = 'mcp'`, and an actor that can be an agent
   * rather than a person.
   *
   * `metadata` carries the count and never the payload. A customer list copied in here would be a
   * customer list in an append-only table, which is a copy nobody can delete.
   */
  recordToolCall(
    scope: McpTenantScope,
    input: {
      readonly tool: string;
      readonly outcome: "success" | "denied" | "failure";
      readonly code: string | null;
      readonly items: number | null;
      readonly actorType: "user" | "service_account";
      readonly actorId: string;
      readonly userId: string;
      readonly grantId: string;
      readonly at: Date;
    }
  ): Promise<void> {
    return withTenant(this.database, scope.tenantId, async (tx) => {
      await tx`
        insert into audit_log (
          id, tenant_id, actor_user_id, action, target_type, target_id, outcome,
          created_at, metadata, actor_type, actor_id, source
        )
        values (
          ${randomUUID()}, ${scope.tenantId}, ${input.userId}, ${"mcp.tool.called"}, ${"mcp_tool"},
          ${input.tool}, ${input.outcome}, ${input.at},
          ${tx.json({ grantId: input.grantId, ...(input.code ? { code: input.code } : {}), ...(input.items === null ? {} : { items: input.items }) })},
          ${input.actorType}, ${input.actorId}, ${"mcp"}
        )`;
    });
  }
}

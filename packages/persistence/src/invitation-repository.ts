import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { DatabaseClient } from "@control-hub/database";
import { withTenant } from "@control-hub/database";
import type { RoleCode, TenantContext } from "@control-hub/domain";

export type InvitationRole = Exclude<RoleCode, "owner">;
export class InvitationError extends Error {}

export function hashInvitationToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function createInvitation(
  database: DatabaseClient,
  context: TenantContext,
  input: { email: string; role: InvitationRole; expiresAt: Date }
) {
  const token = randomBytes(32).toString("base64url");
  const invitationId = randomUUID();
  const email = input.email.trim().toLowerCase();
  try {
    await withTenant(
      database,
      context.tenantId,
      (tx) => tx`
      insert into member_invitations (id, tenant_id, email, role_code, token_hash, invited_by_user_id, expires_at)
      values (${invitationId}, ${context.tenantId}, ${email}, ${input.role}, ${hashInvitationToken(token)}, ${context.userId}, ${input.expiresAt})
    `
    );
  } catch (error) {
    if (typeof error === "object" && error && "code" in error && error.code === "23505")
      throw new InvitationError("INVITATION_ALREADY_PENDING");
    throw error;
  }
  return { id: invitationId, email, role: input.role, token, expiresAt: input.expiresAt };
}

export async function listInvitations(database: DatabaseClient, context: TenantContext) {
  return withTenant(
    database,
    context.tenantId,
    (tx) => tx`
    select id, email, role_code as role, expires_at as "expiresAt", created_at as "createdAt"
    from member_invitations where tenant_id = ${context.tenantId} and accepted_at is null and revoked_at is null and expires_at > now()
    order by created_at desc
  `
  );
}

export async function revokeInvitation(database: DatabaseClient, context: TenantContext, invitationId: string) {
  const rows = await withTenant(
    database,
    context.tenantId,
    (tx) => tx`
    update member_invitations set revoked_at = now()
    where id = ${invitationId} and tenant_id = ${context.tenantId} and accepted_at is null and revoked_at is null
    returning id
  `
  );
  if (!rows[0]) throw new InvitationError("INVITATION_NOT_FOUND");
}

export async function lookupInvitation(database: DatabaseClient, token: string) {
  if (token.length < 32 || token.length > 128) throw new InvitationError("INVITATION_INVALID");
  const rows = await database<
    { id: string; tenant_id: string; tenant_name: string; email: string; role_code: InvitationRole; expires_at: Date }[]
  >`
    select * from lookup_member_invitation(${hashInvitationToken(token)})
  `;
  const invitation = rows[0];
  if (!invitation) throw new InvitationError("INVITATION_INVALID");
  return {
    id: invitation.id,
    tenantId: invitation.tenant_id,
    tenantName: invitation.tenant_name,
    email: invitation.email,
    role: invitation.role_code,
    expiresAt: invitation.expires_at
  };
}

export async function acceptInvitation(database: DatabaseClient, token: string, userId: string, email: string) {
  const rows = await database<{ membership_id: string; tenant_id: string }[]>`
    select * from accept_member_invitation(${hashInvitationToken(token)}, ${userId}, ${email.trim().toLowerCase()})
  `;
  if (!rows[0]) throw new InvitationError("INVITATION_INVALID");
  return { membershipId: rows[0].membership_id, tenantId: rows[0].tenant_id };
}

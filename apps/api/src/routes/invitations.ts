import { invitationMessage } from "../invitation-message.js";
import {
  createInvitation,
  InvitationError,
  listInvitations,
  revokeInvitation,
  type InvitationRole
} from "../invitation-repository.js";
import { requirePermission, resolveTenantContext, writeAudit } from "../security.js";
import type { InvitationContext } from "./context.js";

/** Inviting and revoking members. The matching public routes live in ./public.ts. */
export function registerInvitationRoutes({ app, database, auth, appOrigin, sendMail }: InvitationContext) {
  app.get("/api/v1/invitations", async (request) => {
    const context = await resolveTenantContext(auth, database, request);
    requirePermission(context, "members:manage");
    return { invitations: await listInvitations(database, context) };
  });
  app.post<{ Body: { email: string; role: InvitationRole; locale?: "ca" | "es" | "en" } }>(
    "/api/v1/invitations",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["email", "role"],
          properties: {
            email: { type: "string", format: "email", maxLength: 254 },
            role: { type: "string", enum: ["administrator", "technical"] },
            locale: { type: "string", enum: ["ca", "es", "en"] }
          }
        }
      }
    },
    async (request, reply) => {
      const context = await resolveTenantContext(auth, database, request);
      requirePermission(context, "members:manage");
      if (!sendMail || !appOrigin) throw new InvitationError("INVITATIONS_NOT_CONFIGURED");
      const invitation = await createInvitation(database, context, {
        email: request.body.email,
        role: request.body.role,
        expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000)
      });
      const locale = request.body.locale ?? "ca";
      const url = new URL(`/${locale}/accept-invitation`, appOrigin);
      url.searchParams.set("token", invitation.token);
      try {
        await sendMail({ to: invitation.email, ...invitationMessage(locale, url.toString()) });
      } catch (error) {
        await revokeInvitation(database, context, invitation.id);
        throw error;
      }
      await writeAudit(database, context, request, {
        action: "membership.invited",
        targetType: "invitation",
        targetId: invitation.id,
        outcome: "success",
        metadata: { email: invitation.email, role: invitation.role }
      });
      return reply.code(201).send({
        invitation: {
          id: invitation.id,
          email: invitation.email,
          role: invitation.role,
          expiresAt: invitation.expiresAt
        }
      });
    }
  );
  app.delete<{ Params: { invitationId: string } }>("/api/v1/invitations/:invitationId", async (request, reply) => {
    const context = await resolveTenantContext(auth, database, request);
    requirePermission(context, "members:manage");
    await revokeInvitation(database, context, request.params.invitationId);
    await writeAudit(database, context, request, {
      action: "membership.invitation.revoked",
      targetType: "invitation",
      targetId: request.params.invitationId,
      outcome: "success"
    });
    return reply.code(204).send();
  });
}

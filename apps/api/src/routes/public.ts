import { acceptInvitation, InvitationError, lookupInvitation } from "@control-hub/persistence";
import type { PublicContext } from "./context.js";

/** Reachable without a session: invitation lookup and acceptance. Everything here is rate
 *  limited tightly and must not leak whether an address is already registered. */
export function registerPublicRoutes({ app, database, invitationAuth }: PublicContext) {
  app.get<{ Querystring: { token: string } }>(
    "/api/v1/public/invitations",
    {
      config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          required: ["token"],
          properties: { token: { type: "string", minLength: 32, maxLength: 128 } }
        }
      }
    },
    async (request) => ({ invitation: await lookupInvitation(database, request.query.token) })
  );
  app.post<{ Body: { token: string; name: string; password: string } }>(
    "/api/v1/public/invitations/accept",
    {
      config: { rateLimit: { max: 5, timeWindow: "15 minutes" } },
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["token", "name", "password"],
          properties: {
            token: { type: "string", minLength: 32, maxLength: 128 },
            name: { type: "string", minLength: 2, maxLength: 120 },
            password: { type: "string", minLength: 12, maxLength: 128 }
          }
        }
      }
    },
    async (request, reply) => {
      if (!invitationAuth) throw new InvitationError("INVITATIONS_NOT_CONFIGURED");
      const invitation = await lookupInvitation(database, request.body.token);
      const existing = await database<{ id: string }[]>`select id from "user" where email = ${invitation.email}`;
      if (existing[0]) throw new InvitationError("INVITATION_ACCOUNT_EXISTS");
      const registration = await invitationAuth.api.signUpEmail({
        body: { email: invitation.email, password: request.body.password, name: request.body.name.trim() }
      });
      if (!registration.user) throw new InvitationError("INVITATION_REGISTRATION_FAILED");
      try {
        await acceptInvitation(database, request.body.token, registration.user.id, invitation.email);
      } catch (error) {
        await database`delete from "user" where id = ${registration.user.id}`;
        throw error;
      }
      return reply.code(201).send({ status: "accepted", email: invitation.email });
    }
  );
}

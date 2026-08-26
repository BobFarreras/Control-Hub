import type { McpAuthorizationDescription, McpOauthService } from "@control-hub/application";
import type { DatabaseClient } from "@control-hub/database";
import type { TenantContext } from "@control-hub/domain";
import type { FastifyRequest } from "fastify";
import type { ControlHubAuth } from "../auth.js";
import { resolveTenantContext, writeAudit } from "../security.js";
import type { ControlHubApp } from "../server-instance.js";

/**
 * The two calls the consent screen makes: what am I being asked, and here is the answer.
 *
 * They are not part of the OAuth surface even though they sit in the middle of an OAuth flow, and
 * the split is on purpose. `/api/v1/mcp/oauth/*` speaks RFC 6749 to programs that have never heard
 * of this codebase; these two speak to our own panel, over a session cookie, in the problem details
 * every other screen already knows how to read.
 *
 * What the request carried in its query string is treated as a carrier and never as a source of
 * truth. The client's name, the scopes that would really be granted and the date the consent would
 * lapse are all re-read through the service, so a client cannot compose a URL that makes the screen
 * say something generous about it.
 *
 * Approving demands a session that was established recently, not merely one that is valid. Handing
 * an agent ninety days of read access is exactly the operation an unattended laptop should not be
 * able to perform, and the window is better-auth's own `freshAge` so that this answer and the one
 * given for changing a password are the same answer.
 *
 * Specification: `docs/specifications/mcp-and-client-portal.md`.
 */

export type McpConsentContext = {
  app: ControlHubApp;
  database: DatabaseClient;
  auth: ControlHubAuth;
  mcp: McpOauthService;
};

/**
 * The request as the screen renders it.
 *
 * `redirectUri` travels because the screen tells the person where approving will send them, which
 * is the one fact that distinguishes a client running on their own machine from one that is not.
 */
export function mcpConsentResponse(description: McpAuthorizationDescription) {
  return {
    clientId: description.clientId,
    clientName: description.clientName,
    clientKind: description.clientKind,
    redirectUri: description.redirectUri,
    scopes: description.scopes,
    resource: description.audience,
    grantExpiresAt: description.grantExpiresAt,
    // The screen warns when nobody in the organisation has ever seen this client before. It is the
    // difference between approving something an administrator set up and approving something that
    // introduced itself a moment ago, and only the store knows which of the two this is.
    unclaimed: description.unclaimed
  };
}

/** The parameters the authorization endpoint handed to the screen, on their way back. */
type ConsentRequest = {
  client_id?: string;
  redirect_uri?: string;
  scope?: string;
  state?: string;
  code_challenge?: string;
  code_challenge_method?: string;
  resource?: string;
};

const asAuthorization = (request: ConsentRequest) => ({
  clientId: request.client_id ?? "",
  redirectUri: request.redirect_uri ?? "",
  // An empty `scope` is not an empty list: RFC 6749 section 3.3 lets a client ask for nothing in
  // particular and take what the server decides, which here is everything the person can back.
  scopes: (request.scope ?? "").split(" ").filter((name) => name !== ""),
  codeChallenge: request.code_challenge ?? "",
  codeChallengeMethod: request.code_challenge_method ?? "",
  resource: request.resource
});

/**
 * Where the browser goes next, with the outcome attached.
 *
 * Built from the address the service has already matched against the registered ones, so this
 * function cannot be the place an open redirect gets in. A registered address may carry no query
 * of its own, which is what makes appending one safe rather than a guess about precedence.
 */
const redirectWith = (redirectUri: string, state: string | undefined, outcome: Record<string, string>) =>
  `${redirectUri}?${new URLSearchParams({ ...outcome, ...(state === undefined ? {} : { state }) }).toString()}`;

export function registerMcpConsentRoutes({ app, database, auth, mcp }: McpConsentContext) {
  app.get<{ Querystring: ConsentRequest }>(
    "/api/v1/mcp/consent",
    {
      schema: {
        tags: ["mcp"],
        summary: "What a client is asking for",
        description:
          "Describes the pending authorization for the screen that will decide it: who is asking, under what name it is registered, what would actually be granted to this person, and when the consent would lapse. Every field is re-read rather than echoed from the request."
      }
    },
    // Budgeted by the global limiter in `app.ts`, which CodeQL cannot see through a plugin.
    // codeql[js/missing-rate-limiting]
    async (request) => {
      // No freshness demanded to read. Being told what an agent wants is not the sensitive act,
      // and refusing here would send somebody to sign in again before they know why they should.
      const context = await resolveTenantContext(auth, database, request);
      return mcpConsentResponse(await mcp.describeAuthorization(context, asAuthorization(request.query)));
    }
  );

  app.post<{ Body: ConsentRequest & { decision?: string } }>(
    "/api/v1/mcp/consent",
    {
      schema: {
        tags: ["mcp"],
        summary: "Approve or refuse an authorization",
        description:
          "Records the decision and answers with where to send the browser: to the client with an authorization code, or to the client with `access_denied`. Approving requires a session established within the last ten minutes, as every sensitive operation in this product does."
      }
    },
    // Budgeted by the global limiter in `app.ts`, which CodeQL cannot see through a plugin.
    // codeql[js/missing-rate-limiting]
    async (request, reply) => {
      const body = request.body ?? {};
      const authorization = asAuthorization(body);
      const approving = body.decision === "approve";

      /**
       * Refusing does not need a fresh session, and demanding one would be a trap.
       *
       * Somebody who wants to say no to an agent should be able to say it now, from the session
       * they have. Sending them to sign in again first is how "no" turns into an abandoned tab and
       * a request nobody ever answered.
       */
      const context: TenantContext = await resolveTenantContext(auth, database, request, {
        requireFreshSession: approving
      });

      // Both paths validate first. A refusal still ends in a redirect, and a redirect to an
      // address nobody checked is an open redirect whatever the outcome attached to it says.
      const description = await mcp.describeAuthorization(context, authorization);

      if (!approving) {
        await audit(context, request, description, "denied");
        return reply.send({
          redirectTo: redirectWith(description.redirectUri, body.state, {
            error: "access_denied",
            error_description: "The person asked to authorize refused."
          })
        });
      }

      const { code } = await mcp.approveAuthorization(context, authorization);
      await audit(context, request, description, "approved");
      return reply.send({ redirectTo: redirectWith(description.redirectUri, body.state, { code }) });
    }
  );

  /**
   * What was decided, by whom, and over what.
   *
   * The scopes are recorded because they are the substance of the decision: "approved Claude
   * Desktop" answers nothing six weeks later, and the grant row that carries them can be revoked
   * and stop existing as an answer. The code is not recorded, and neither is anything derived from
   * it -- it is a credential for the next sixty seconds.
   */
  function audit(
    context: TenantContext,
    request: FastifyRequest,
    description: McpAuthorizationDescription,
    decision: "approved" | "denied"
  ) {
    return writeAudit(database, context, request, {
      action: `mcp.consent.${decision}`,
      targetType: "mcp_client",
      targetId: description.clientId,
      outcome: decision === "approved" ? "success" : "denied",
      metadata: {
        clientName: description.clientName,
        scopes: description.scopes.join(" "),
        // The registration itself cannot be audited: it happens with nobody signed in, and an
        // audit row belongs to a tenant. This is where it becomes visible instead -- approving an
        // unclaimed client is the act that brought it into this tenant, and the trail should say
        // that the client was one that introduced itself rather than one somebody registered.
        selfRegistered: String(description.unclaimed)
      }
    });
  }
}

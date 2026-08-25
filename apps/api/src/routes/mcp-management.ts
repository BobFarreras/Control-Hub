import type {
  McpClientRecord,
  McpGrantRecord,
  McpOauthService,
  McpServiceAccountRecord
} from "@control-hub/application";
import type { DatabaseClient } from "@control-hub/database";
import { grantableMcpScopes, mcpScopes, type TenantContext } from "@control-hub/domain";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { ControlHubAuth } from "../auth.js";
import { problemContentType, problemDetails } from "../problem.js";
import { requirePermission, resolveTenantContext, writeAudit } from "../security.js";
import type { ControlHubApp } from "../server-instance.js";

/**
 * The screen behind the agents: which clients may ask, what has been consented to, and which
 * service accounts hold a key.
 *
 * Three properties hold for every handler here and are worth stating once instead of repeating.
 *
 * A secret is returned by exactly two operations -- creating a credential and rotating one -- and
 * by nothing else. No listing carries one, no read returns one, and the response shapes are
 * written field by field so that a column added to a table later cannot reach a screen by merely
 * existing.
 *
 * Every call is audited, including the refused ones, and including the reads. This is the surface
 * that decides what an agent may see for the next ninety days; "who looked at the keys" and "who
 * was told no" are the first two questions asked after an incident, and a denial nobody recorded
 * is the one an investigation cannot see.
 *
 * And `security:manage` is demanded on all of them, with a second factor already settled by
 * `resolveTenantContext`. There is no read-only tier here on purpose: knowing which agents exist,
 * what they may reach and when their consent lapses is itself the sensitive part.
 *
 * Specification: `docs/specifications/mcp-and-client-portal.md`.
 */

/** A client as a screen sees it. The secret was shown once, at registration, and is not here. */
export function mcpClientResponse(client: McpClientRecord) {
  return {
    id: client.id,
    clientId: client.clientId,
    name: client.name,
    kind: client.kind,
    redirectUris: client.redirectUris,
    maxScopes: client.maxScopes,
    status: client.status,
    createdAt: client.createdAt
  };
}

/**
 * A consent as a screen sees it.
 *
 * `lastUsedAt` is here because it is the field that makes the list actionable: a consent nobody
 * has exercised in two months is the one to withdraw, and without it every row looks alike.
 */
export function mcpGrantResponse(grant: McpGrantRecord) {
  return {
    id: grant.id,
    clientId: grant.clientId,
    clientName: grant.clientName,
    actorType: grant.actorType,
    actorMembershipId: grant.actorMembershipId,
    actorServiceAccountId: grant.actorServiceAccountId,
    scopes: grant.scopes,
    status: grant.status,
    consentedAt: grant.consentedAt,
    expiresAt: grant.expiresAt,
    revokedAt: grant.revokedAt,
    lastUsedAt: grant.lastUsedAt
  };
}

/**
 * A service account as a screen sees it.
 *
 * `permissions` travels because it is the ceiling the account's scopes are measured against, and a
 * screen that showed the scopes without it would be showing half of the decision. The secret and
 * its hash are not here in any form.
 */
export function mcpServiceAccountResponse(account: McpServiceAccountRecord) {
  return {
    id: account.id,
    name: account.name,
    ownerMembershipId: account.ownerMembershipId,
    scopes: account.scopes,
    permissions: account.permissions,
    expiresAt: account.expiresAt,
    disabledAt: account.disabledAt,
    secretRotatedAt: account.secretRotatedAt,
    createdAt: account.createdAt
  };
}

/**
 * The scopes a client may be given as its ceiling.
 *
 * It travels with the listing so the screen that offers them does not carry a second copy of a
 * closed vocabulary -- a copy that would go stale the day a scope is added and be wrong in the
 * quietest way, by offering fewer choices than exist. `mcp:tools.list` is left out because a
 * ceiling records what may be withheld, and listing what you may call is never withheld.
 */
const registrableScopes = mcpScopes.filter((scope) => scope !== "mcp:tools.list");

export type McpManagementContext = {
  app: ControlHubApp;
  database: DatabaseClient;
  auth: ControlHubAuth;
  mcp: McpOauthService;
};

type AuditEvent = {
  action: string;
  targetType: string;
  targetId?: string;
  metadata?: Record<string, string | number | boolean | null>;
};

export function registerMcpManagementRoutes({ app, database, auth, mcp }: McpManagementContext) {
  /**
   * Resolve the caller, demand the permission, and record the answer either way.
   *
   * The denial is written under the tenant that was resolved and before the error travels, so it
   * is visible to whoever reviews the log rather than only to whoever was watching the response.
   */
  async function authorise(request: FastifyRequest, event: AuditEvent): Promise<TenantContext> {
    const context = await resolveTenantContext(auth, database, request);
    try {
      requirePermission(context, "security:manage");
    } catch (error) {
      await writeAudit(database, context, request, { ...event, outcome: "denied" });
      throw error;
    }
    return context;
  }

  const listing = (summary: string, description: string) => ({
    schema: { tags: ["mcp"], summary, description }
  });

  /**
   * The one shape a "there was nothing there" answer takes on this surface.
   *
   * These come back from a delete or a revoke that matched no row, which the service reports as
   * `false` rather than by throwing -- so the error handler never sees them and the document has to
   * be written here. Built through `problemDetails` rather than by hand so that the type, the title
   * and the request id are the same ones every other refusal on this surface carries.
   */
  const missing = (request: FastifyRequest, reply: FastifyReply, code: string) =>
    reply
      .code(404)
      .type(problemContentType)
      .send(
        problemDetails({
          status: 404,
          code,
          instance: request.url.split("?")[0] ?? request.url,
          requestId: request.id
        })
      );

  app.get(
    "/api/v1/mcp/clients",
    listing(
      "The MCP clients registered here",
      "Every client that may start an authorization on this installation, with the scopes it is allowed to ask for. Registration is manual: nothing self-registers, so this list is exactly what somebody decided to add."
    ),
    async (request) => {
      const context = await authorise(request, { action: "mcp.clients.list", targetType: "mcp_client" });
      await writeAudit(database, context, request, {
        action: "mcp.clients.list",
        targetType: "mcp_client",
        outcome: "success"
      });
      return { clients: (await mcp.listClients(context)).map(mcpClientResponse), scopes: registrableScopes };
    }
  );

  app.post<{
    Body: {
      name: string;
      kind: "public" | "confidential";
      redirectUris: string[];
      maxScopes: string[];
    };
  }>(
    "/api/v1/mcp/clients",
    {
      schema: {
        tags: ["mcp"],
        summary: "Register an MCP client",
        description:
          "Declares a client, its exact redirect addresses and the scopes it will be allowed to ask for. A confidential client is handed a secret here and only here: the store keeps its hash, so a secret that is lost is rotated rather than looked up."
      }
    },
    async (request, reply) => {
      const context = await authorise(request, { action: "mcp.client.register", targetType: "mcp_client" });
      const { client, secret } = await mcp.registerClient(context, request.body);
      await writeAudit(database, context, request, {
        action: "mcp.client.register",
        targetType: "mcp_client",
        targetId: client.id,
        outcome: "success",
        // What was created, never what was minted. The kind is what decides whether a secret
        // exists at all, which is the fact an audit reader needs and the only one recorded.
        metadata: { name: client.name, kind: client.kind, scopes: client.maxScopes.join(" ") }
      });
      return reply.code(201).send({ client: mcpClientResponse(client), secret });
    }
  );

  app.delete<{ Params: { clientId: string } }>(
    "/api/v1/mcp/clients/:clientId",
    {
      schema: {
        tags: ["mcp"],
        summary: "Remove an MCP client",
        description:
          "Removes a client so it can start no further authorizations. Consents already granted through it are withdrawn separately, and deliberately: forgetting the client is not the same decision as ending what it was allowed to do."
      }
    },
    async (request, reply) => {
      const context = await authorise(request, {
        action: "mcp.client.delete",
        targetType: "mcp_client",
        targetId: request.params.clientId
      });
      const deleted = await mcp.deleteClient(context, request.params.clientId);
      await writeAudit(database, context, request, {
        action: "mcp.client.delete",
        targetType: "mcp_client",
        targetId: request.params.clientId,
        // A delete that matched nothing is recorded as a failure rather than dropped: somebody
        // aiming at a client that is not there is a thing worth being able to see afterwards.
        outcome: deleted ? "success" : "failure"
      });
      return deleted ? reply.code(204).send() : missing(request, reply, "MCP_CLIENT_UNKNOWN");
    }
  );

  app.get(
    "/api/v1/mcp/grants",
    listing(
      "The consents this tenant has given",
      "Every grant an agent is acting under, who approved it, what it may reach, when it lapses and when it was last used. A consent nobody exercises is visible as such, which is what makes the list worth reading."
    ),
    async (request) => {
      const context = await authorise(request, { action: "mcp.grants.list", targetType: "mcp_grant" });
      await writeAudit(database, context, request, {
        action: "mcp.grants.list",
        targetType: "mcp_grant",
        outcome: "success"
      });
      return { grants: (await mcp.listGrants(context)).map(mcpGrantResponse) };
    }
  );

  app.delete<{ Params: { grantId: string } }>(
    "/api/v1/mcp/grants/:grantId",
    {
      schema: {
        tags: ["mcp"],
        summary: "Withdraw a consent",
        description:
          "Ends a grant and every token issued under it, at once. Access tokens here are references rather than signed claims, so there is no window to wait out: the next call the agent makes is refused."
      }
    },
    async (request, reply) => {
      const context = await authorise(request, {
        action: "mcp.grant.revoke",
        targetType: "mcp_grant",
        targetId: request.params.grantId
      });
      const revoked = await mcp.revokeGrant(context, request.params.grantId);
      await writeAudit(database, context, request, {
        action: "mcp.grant.revoke",
        targetType: "mcp_grant",
        targetId: request.params.grantId,
        outcome: revoked ? "success" : "failure"
      });
      return revoked ? reply.code(204).send() : missing(request, reply, "MCP_GRANT_UNKNOWN");
    }
  );

  app.get(
    "/api/v1/mcp/service-accounts",
    listing(
      "The agents that log in without a browser",
      "Service accounts, their scopes, the permissions those scopes are capped by, and when each secret expires. The secret itself was shown once when it was minted and is not readable from here."
    ),
    async (request) => {
      const context = await authorise(request, {
        action: "mcp.service-accounts.list",
        targetType: "mcp_service_account"
      });
      await writeAudit(database, context, request, {
        action: "mcp.service-accounts.list",
        targetType: "mcp_service_account",
        outcome: "success"
      });
      return {
        serviceAccounts: (await mcp.listServiceAccounts(context)).map(mcpServiceAccountResponse),
        // What this reader could actually back, not the whole vocabulary. An account cannot be
        // created with more than its creator holds, and a form that offered more would be inviting
        // a refusal it could have foreseen.
        grantableScopes: grantableMcpScopes(context.permissions)
      };
    }
  );

  app.post<{ Body: { name: string; scopes: string[]; permissions: string[] } }>(
    "/api/v1/mcp/service-accounts",
    {
      schema: {
        tags: ["mcp"],
        summary: "Create a service account",
        description:
          "Creates an agent that authenticates with a secret instead of a browser. Its permissions are capped by those of the person creating it, so nobody can leave behind an agent that reaches further than they do. The secret is returned here and nowhere else."
      }
    },
    async (request, reply) => {
      const context = await authorise(request, {
        action: "mcp.service-account.create",
        targetType: "mcp_service_account"
      });
      const { account, secret } = await mcp.createServiceAccount(context, request.body);
      await writeAudit(database, context, request, {
        action: "mcp.service-account.create",
        targetType: "mcp_service_account",
        targetId: account.id,
        outcome: "success",
        metadata: {
          name: account.name,
          scopes: account.scopes.join(" "),
          permissions: account.permissions.join(" ")
        }
      });
      return reply.code(201).send({ serviceAccount: mcpServiceAccountResponse(account), secret });
    }
  );

  app.post<{ Params: { serviceAccountId: string } }>(
    "/api/v1/mcp/service-accounts/:serviceAccountId/rotate",
    {
      schema: {
        tags: ["mcp"],
        summary: "Rotate a service account secret",
        description:
          "Mints a new secret and leaves the previous one working for a day, so the agent can be redeployed without an outage. When the old secret is known to be compromised the operation is `retire-previous-secret`, which ends that window now."
      }
    },
    async (request, reply) => {
      const context = await authorise(request, {
        action: "mcp.service-account.rotate",
        targetType: "mcp_service_account",
        targetId: request.params.serviceAccountId
      });
      const secret = await mcp.rotateServiceAccountSecret(context, request.params.serviceAccountId);
      await writeAudit(database, context, request, {
        action: "mcp.service-account.rotate",
        targetType: "mcp_service_account",
        targetId: request.params.serviceAccountId,
        outcome: "success"
      });
      return reply.code(200).send({ secret });
    }
  );

  app.post<{ Params: { serviceAccountId: string } }>(
    "/api/v1/mcp/service-accounts/:serviceAccountId/retire-previous-secret",
    {
      schema: {
        tags: ["mcp"],
        summary: "End the rotation window now",
        description:
          "Stops the previous secret from working immediately, for the case where it is known to be compromised. Separate from rotation because it answers a different question: rotation is routine and wants the overlap, this is the emergency and waiting a day would be the wrong answer to it."
      }
    },
    async (request, reply) => {
      const context = await authorise(request, {
        action: "mcp.service-account.retire-previous-secret",
        targetType: "mcp_service_account",
        targetId: request.params.serviceAccountId
      });
      const retired = await mcp.retirePreviousSecret(context, request.params.serviceAccountId);
      await writeAudit(database, context, request, {
        action: "mcp.service-account.retire-previous-secret",
        targetType: "mcp_service_account",
        targetId: request.params.serviceAccountId,
        outcome: retired ? "success" : "failure"
      });
      return retired ? reply.code(204).send() : missing(request, reply, "MCP_SERVICE_ACCOUNT_UNKNOWN");
    }
  );

  app.delete<{ Params: { serviceAccountId: string } }>(
    "/api/v1/mcp/service-accounts/:serviceAccountId",
    {
      schema: {
        tags: ["mcp"],
        summary: "Disable a service account",
        description:
          "Disables the account rather than deleting it. Its grants and its audit trail stay readable, which is what an investigation needs; what stops is that the secret no longer authenticates."
      }
    },
    async (request, reply) => {
      const context = await authorise(request, {
        action: "mcp.service-account.disable",
        targetType: "mcp_service_account",
        targetId: request.params.serviceAccountId
      });
      const disabled = await mcp.disableServiceAccount(context, request.params.serviceAccountId);
      await writeAudit(database, context, request, {
        action: "mcp.service-account.disable",
        targetType: "mcp_service_account",
        targetId: request.params.serviceAccountId,
        outcome: disabled ? "success" : "failure"
      });
      return disabled ? reply.code(204).send() : missing(request, reply, "MCP_SERVICE_ACCOUNT_UNKNOWN");
    }
  );
}

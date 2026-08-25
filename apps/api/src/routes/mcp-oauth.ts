import { McpOauthError, type McpOauthService } from "@control-hub/application";
import type { McpDenialCode, McpOauthDenialCode } from "@control-hub/domain";
import type { FastifyInstance, FastifyReply } from "fastify";
import type { ControlHubApp } from "../server-instance.js";

/**
 * The MCP authorization server, on the wire.
 *
 * These routes answer in OAuth's own envelope (RFC 6749 section 5.2) rather than in the problem
 * details the rest of this API is moving towards, and that is deliberate. The caller here is a
 * generic OAuth client -- Claude Desktop, an SDK, a CLI -- which branches on the `error` member
 * and knows nothing about `code`. An envelope it cannot read turns "your consent was withdrawn,
 * authorize again" into an opaque failure, and the whole point of speaking a standard is that
 * software nobody here wrote can act on the answer. Our own `code` and `requestId` ride along as
 * extra members, so logs and support keep the identifiers every other route uses; an OAuth client
 * ignores members it does not recognise, which is what makes that free.
 *
 * Specification: `docs/specifications/mcp-and-client-portal.md`.
 */

/**
 * The error names a client is allowed to receive, and where each was registered.
 *
 * A name outside this list reaches the client as an unrecognised failure, which is how "reconnect
 * your account" becomes "this integration is broken". RFC 6749 section 5.2 and section 4.1.2.1,
 * RFC 6750 section 3.1, RFC 8707 section 2.
 */
export const registeredOauthErrors = [
  "invalid_request",
  "invalid_client",
  "invalid_grant",
  "invalid_scope",
  "unsupported_grant_type",
  "access_denied",
  "invalid_token",
  "insufficient_scope",
  "invalid_target"
] as const;
export type RegisteredOauthError = (typeof registeredOauthErrors)[number];

export type McpOauthAnswer = {
  readonly status: number;
  readonly error: RegisteredOauthError;
  /**
   * A fixed sentence, never a submitted value.
   *
   * This travels to logs, terminals and screen shares. Echoing back the redirect_uri or the scope
   * somebody typed is how a caller's configuration ends up somewhere nobody meant to put it.
   */
  readonly description: string;
};

/**
 * Every refusal this server can reach, and what an OAuth client is told about it.
 *
 * A `Record` over the union rather than a switch with a default: a denial code added to the domain
 * and forgotten here fails to compile, instead of falling through to a generic answer that
 * misdescribes what happened.
 */
const answers: Record<McpOauthDenialCode | McpDenialCode, McpOauthAnswer> = {
  // Unknown, suspended and wrong secret are one answer. Telling them apart would turn the token
  // endpoint into a directory of which clients this installation has.
  MCP_CLIENT_UNKNOWN: { status: 401, error: "invalid_client", description: "Client authentication failed." },
  MCP_CLIENT_SUSPENDED: { status: 401, error: "invalid_client", description: "Client authentication failed." },
  MCP_CLIENT_AUTH_FAILED: { status: 401, error: "invalid_client", description: "Client authentication failed." },

  // OAuth 2.1 section 4.1.2.1: an address that was not registered is never redirected to, so the
  // refusal has to be visible at the endpoint. Bouncing to it is how this server would be turned
  // into a way of delivering a code to somebody else.
  MCP_REDIRECT_URI_MISMATCH: {
    status: 400,
    error: "invalid_request",
    description: "The redirect address is not registered for this client."
  },
  MCP_REQUEST_INVALID: { status: 400, error: "invalid_request", description: "The request is missing or malformed." },
  MCP_SCOPE_UNAVAILABLE: {
    status: 400,
    error: "invalid_scope",
    description: "One of the scopes asked for cannot be granted here."
  },

  // Spent, mismatched, reused and withdrawn are one fact to the client: what it holds no longer
  // works. Reuse in particular answers identically on purpose -- the family is already revoked by
  // the time this is written, and a distinct error would tell a thief their token had been noticed.
  MCP_CODE_INVALID: { status: 400, error: "invalid_grant", description: "The grant presented is no longer valid." },
  MCP_PKCE_INVALID: { status: 400, error: "invalid_grant", description: "The grant presented is no longer valid." },
  MCP_REFRESH_INVALID: { status: 400, error: "invalid_grant", description: "The grant presented is no longer valid." },
  MCP_REFRESH_REUSED: { status: 400, error: "invalid_grant", description: "The grant presented is no longer valid." },
  MCP_GRANT_REVOKED: { status: 400, error: "invalid_grant", description: "The grant presented is no longer valid." },

  // RFC 8707 section 2 registered this name for exactly this. `invalid_request` would tell a client
  // to fix its syntax when what it has to fix is which server it asked.
  MCP_AUDIENCE_INVALID: {
    status: 400,
    error: "invalid_target",
    description: "This token was not issued for this resource."
  },

  // RFC 6750 section 3.1. A token that will not be accepted is a credential problem, which earns a
  // challenge; a scope that is merely too narrow is not, and a client can act on the difference.
  MCP_TOKEN_INVALID: { status: 401, error: "invalid_token", description: "The access token is not valid." },
  MCP_TOKEN_EXPIRED: { status: 401, error: "invalid_token", description: "The access token has expired." },
  MCP_SCOPE_INSUFFICIENT: {
    status: 403,
    error: "insufficient_scope",
    description: "This token does not carry the scope the call requires."
  },

  // Product decisions rather than protocol ones. `access_denied` says what happened without
  // inventing a protocol error that would misdescribe it.
  MCP_TENANT_MISMATCH: { status: 403, error: "access_denied", description: "The request was denied." },
  TOOL_NOT_PUBLISHED: { status: 403, error: "access_denied", description: "The request was denied." },
  PERMISSION_DENIED: { status: 403, error: "access_denied", description: "The request was denied." }
};

export function mcpOauthAnswer(code: McpOauthDenialCode | McpDenialCode): McpOauthAnswer {
  return answers[code];
}

const unsupportedGrant: McpOauthAnswer = {
  status: 400,
  error: "unsupported_grant_type",
  description: "This authorization server does not offer that grant type."
};

export type McpOauthContext = {
  app: ControlHubApp;
  mcp: McpOauthService;
};

type TokenBody = {
  grant_type?: string;
  client_id?: string;
  client_secret?: string;
  code?: string;
  code_verifier?: string;
  redirect_uri?: string;
  refresh_token?: string;
  resource?: string;
};

/**
 * Form encoding, confined to the two endpoints the RFC requires it for.
 *
 * RFC 6749 section 4.1.3 says the token endpoint takes `application/x-www-form-urlencoded`, and
 * every OAuth client sends exactly that. Registering the parser inside a plugin scope rather than
 * on the root instance keeps it off every other route: a content type this API otherwise refuses
 * should stay refused, and Fastify's encapsulation is what makes that a boundary rather than a
 * convention.
 */
function registerFormParser(scope: FastifyInstance) {
  scope.addContentTypeParser<string>(
    "application/x-www-form-urlencoded",
    { parseAs: "string" },
    (_request, body, done) => {
      try {
        done(null, Object.fromEntries(new URLSearchParams(body)));
      } catch {
        // The message would quote the body, and the body of a token request is a credential.
        done(new McpOauthError("MCP_REQUEST_INVALID"), undefined);
      }
    }
  );
}

/** RFC 6749 section 5.1: a token response must not be stored by anything on the way back. */
function noStore(reply: FastifyReply) {
  return reply.header("cache-control", "no-store").header("pragma", "no-cache");
}

function refuse(reply: FastifyReply, error: unknown) {
  const answer = error instanceof McpOauthError ? mcpOauthAnswer(error.code) : null;
  if (!answer) throw error;
  return noStore(reply)
    .code(answer.status)
    .send({
      error: answer.error,
      error_description: answer.description,
      code: error instanceof McpOauthError ? error.code : "INTERNAL_ERROR",
      requestId: reply.request.id
    });
}

export function registerMcpOauthRoutes({ app, mcp }: McpOauthContext) {
  /**
   * The two discovery documents, unauthenticated by design.
   *
   * A client has to be able to read them before it holds anything, which is the whole point of
   * RFC 9728 and RFC 8414. They describe the server and never a tenant, so there is nothing here
   * that an anonymous reader learns beyond what this installation already publishes by existing.
   *
   * Five minutes of caching rather than an hour: these documents change when the server is
   * reconfigured, and an agent holding a stale endpoint list for an hour after a rollout is a
   * support ticket nobody can explain.
   */
  const metadata = { schema: { tags: ["mcp"], summary: "OAuth discovery document" } };

  for (const path of [
    "/.well-known/oauth-protected-resource",
    // RFC 9728 section 3.1 puts the resource's path after the well-known segment. Clients differ on
    // which they try first, so both are served rather than betting on one.
    "/.well-known/oauth-protected-resource/mcp"
  ]) {
    app.get(path, metadata, async (_request, reply) =>
      reply.header("cache-control", "public, max-age=300").send(mcp.protectedResourceMetadata())
    );
  }

  app.get("/.well-known/oauth-authorization-server", metadata, async (_request, reply) =>
    reply.header("cache-control", "public, max-age=300").send(mcp.authorizationServerMetadata())
  );

  // The callback form rather than an async one: nothing in here awaits, and a promise that
  // resolves immediately would only hide that from the next reader.
  app.register((scope, _options, done) => {
    registerFormParser(scope);

    scope.post<{ Body: TokenBody }>(
      "/api/v1/mcp/oauth/token",
      { schema: { tags: ["mcp"], summary: "Exchange a code, a refresh token or a service account secret" } },
      async (request, reply) => {
        const body = request.body ?? {};
        try {
          switch (body.grant_type) {
            case "authorization_code":
              return noStore(reply).send(
                await mcp.exchangeCode({
                  clientId: body.client_id ?? "",
                  ...(body.client_secret === undefined ? {} : { clientSecret: body.client_secret }),
                  code: body.code ?? "",
                  codeVerifier: body.code_verifier ?? "",
                  redirectUri: body.redirect_uri ?? "",
                  resource: body.resource
                })
              );
            case "refresh_token":
              return noStore(reply).send(
                await mcp.refresh({
                  clientId: body.client_id ?? "",
                  ...(body.client_secret === undefined ? {} : { clientSecret: body.client_secret }),
                  refreshToken: body.refresh_token ?? "",
                  resource: body.resource
                })
              );
            case "client_credentials": {
              // A service account is not a registered client, and accepting a `client_id` here
              // would suggest it is one -- an operator would then look for it in the client list
              // and find nothing. The secret alone identifies it, and its prefix says what it is.
              if (body.client_id !== undefined || body.client_secret === undefined)
                throw new McpOauthError("MCP_REQUEST_INVALID");
              const issued = await mcp.authenticateServiceAccount({
                secret: body.client_secret,
                resource: body.resource
              });
              // `usedPreviousSecret` is ours, not OAuth's: an agent still presenting the rotated
              // secret is about to stop working, and the login is the only moment anybody sees it.
              if (issued.usedPreviousSecret)
                request.log.warn({ scope: issued.scope }, "service account used its previous secret");
              const { usedPreviousSecret: _rotated, ...token } = issued;
              return noStore(reply).send(token);
            }
            default:
              return noStore(reply).code(unsupportedGrant.status).send({
                error: unsupportedGrant.error,
                error_description: unsupportedGrant.description,
                code: "MCP_REQUEST_INVALID",
                requestId: request.id
              });
          }
        } catch (error) {
          return refuse(reply, error);
        }
      }
    );

    /**
     * RFC 7009. An unknown token is a successful revocation, and the empty 200 is the whole answer.
     *
     * Saying anything else would make this endpoint an oracle for which tokens exist -- a caller
     * could learn whether a value it found somewhere was ever issued here, without holding
     * anything. The only refusal is a client that cannot prove who it is.
     */
    scope.post<{ Body: { token?: string; client_id?: string; client_secret?: string } }>(
      "/api/v1/mcp/oauth/revoke",
      { schema: { tags: ["mcp"], summary: "Revoke an access or refresh token" } },
      async (request, reply) => {
        const body = request.body ?? {};
        try {
          await mcp.revokeToken({
            clientId: body.client_id ?? "",
            ...(body.client_secret === undefined ? {} : { clientSecret: body.client_secret }),
            token: body.token ?? ""
          });
          return noStore(reply).code(200).send();
        } catch (error) {
          return refuse(reply, error);
        }
      }
    );

    done();
  });
}

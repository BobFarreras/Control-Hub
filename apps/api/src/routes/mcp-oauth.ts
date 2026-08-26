import { McpOauthError, type McpOauthService } from "@control-hub/application";
import { mcpScopes, type McpDenialCode, type McpOauthDenialCode, type McpScope } from "@control-hub/domain";
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
  "invalid_target",
  // RFC 6749 section 4.1.2.1, which the authorization endpoint answers with and the token endpoint
  // never does: by the time a client reaches `/token` it has already been told what it may ask for.
  "unsupported_response_type",
  // RFC 7591 section 3.2.2, which only the registration endpoint answers with. A client reading
  // `invalid_request` there would look for a syntax error; what it has to fix is one of the fields
  // it sent, and these two names say which kind.
  "invalid_redirect_uri",
  "invalid_client_metadata"
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
  /**
   * Where a person is sent to read what they are about to approve, or null if there is no panel.
   *
   * The absolute address of the consent screen, built from the configured app origin. It carries
   * no locale: which language the screen speaks is the panel's decision, made from what the
   * browser asks for, and the API has no business holding a copy of that list.
   */
  consentUrl: string | null;
};

/**
 * The authorization request, as it arrives in a query string.
 *
 * Every member is optional because every one of them can be missing from a URL somebody typed or
 * a client got wrong, and the handler answers each absence with the error that names it rather
 * than with a validation failure that names none of them.
 */
type AuthorizeQuery = {
  response_type?: string;
  client_id?: string;
  redirect_uri?: string;
  scope?: string;
  state?: string;
  code_challenge?: string;
  code_challenge_method?: string;
  resource?: string;
};

/** Base64url of a SHA-256 digest, which is 43 characters. The upper bound is RFC 7636 section 4.1. */
const isPkceChallenge = (value: string | undefined): boolean =>
  value !== undefined && value.length >= 43 && value.length <= 128;

/**
 * A registration request, RFC 7591 section 2.
 *
 * Every member optional for the same reason the authorize query's are: these arrive from software
 * nobody here wrote, and each absence is answered by the check that names it rather than by a
 * schema failure that names none of them.
 */
type RegistrationBody = {
  client_name?: string;
  redirect_uris?: unknown;
  scope?: string;
};

/** What the client is told it registered as. RFC 7591 section 3.2.1. */
export function oauthRegistrationResponse(registration: {
  readonly clientId: string;
  readonly clientName: string;
  readonly redirectUris: readonly string[];
  readonly scopes: readonly string[];
  readonly issuedAt: Date;
}) {
  return {
    client_id: registration.clientId,
    client_id_issued_at: Math.floor(registration.issuedAt.getTime() / 1000),
    client_name: registration.clientName,
    redirect_uris: registration.redirectUris,
    // Stated rather than echoed. A client may ask for `client_secret_basic` or for the implicit
    // flow; RFC 7591 section 3.2.1 lets the server answer with what it actually assigned, and
    // answering is more useful than refusing -- the client reads these three fields and configures
    // itself from them, whereas a refusal leaves somebody to guess which of the two was wrong.
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
    scope: registration.scopes.join(" ")
  };
}

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
/**
 * The names RFC 6749 section 5.1 gave these fields.
 *
 * The service speaks this codebase's own casing, and the wire speaks OAuth's. Handing a client
 * `accessToken` would be handing it a body no OAuth library reads: every one of them looks for
 * `access_token`, finds nothing, and reports a broken server -- which is the exact failure the
 * decision to answer in OAuth's envelope at all was meant to avoid. The refresh token is omitted
 * rather than sent empty when there is none, because a service account is deliberately given no
 * refresh token and a null field would read as one that failed to arrive.
 */
export function oauthTokenResponse(issued: {
  readonly accessToken: string;
  readonly refreshToken?: string;
  readonly tokenType: "Bearer";
  readonly expiresIn: number;
  readonly scope: string;
}) {
  return {
    access_token: issued.accessToken,
    token_type: issued.tokenType,
    expires_in: issued.expiresIn,
    scope: issued.scope,
    ...(issued.refreshToken === undefined ? {} : { refresh_token: issued.refreshToken })
  };
}

function noStore(reply: FastifyReply) {
  return reply.header("cache-control", "no-store").header("pragma", "no-cache");
}

/**
 * The refusals the registration endpoint gives different names to.
 *
 * The same domain codes, because the same checks made them: what changes is that RFC 7591 section
 * 3.2.2 registered its own two names for this endpoint, and a client reading `invalid_request`
 * here would go looking for a syntax error instead of at the field it got wrong. Everything not
 * listed falls through to the shared table, so a code added to the domain still cannot be missed.
 */
const registrationAnswers: Partial<Record<McpOauthDenialCode | McpDenialCode, McpOauthAnswer>> = {
  MCP_REDIRECT_URI_MISMATCH: {
    status: 400,
    error: "invalid_redirect_uri",
    description: "A redirect address must be https, or http on a literal loopback address."
  },
  MCP_REQUEST_INVALID: {
    status: 400,
    error: "invalid_client_metadata",
    description: "A client name and between one and five redirect addresses are required."
  },
  MCP_SCOPE_UNAVAILABLE: {
    status: 400,
    error: "invalid_client_metadata",
    description: "One of the scopes asked for is not offered here."
  }
};

function refuse(
  reply: FastifyReply,
  error: unknown,
  overrides: Partial<Record<McpOauthDenialCode | McpDenialCode, McpOauthAnswer>> = {}
) {
  const answer = error instanceof McpOauthError ? (overrides[error.code] ?? mcpOauthAnswer(error.code)) : null;
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

export function registerMcpOauthRoutes({ app, mcp, consentUrl }: McpOauthContext) {
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
  const metadata = {
    // Public, unauthenticated and cached for five minutes, so the budget only has to stop
    // somebody hammering it rather than ration honest discovery.
    config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
    schema: { tags: ["mcp"], summary: "OAuth discovery document" }
  };

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

  /**
   * The authorization endpoint: the one place in this file a person arrives rather than a program.
   *
   * It decides nothing about consent. What it does is settle, before anybody is sent anywhere,
   * which of the two kinds of failure this is -- because OAuth 2.1 section 4.1.2.1 draws the line
   * here and the line matters. An unknown client or an address that was not registered is refused
   * where the person can see it: bouncing those to the address in the request is precisely how
   * this server would be turned into a way of delivering a code to somebody who should not have
   * one. Everything after that is sent back to the registered address as an `error`, because the
   * client is the one that can fix it and a browser left on our error page tells it nothing.
   *
   * Then it hands over. The screen lives in the panel, in the person's own language, and re-reads
   * every fact it shows from the store -- so what travels in this redirect is a carrier and not a
   * source of truth.
   *
   * Declared only when there is a panel to hand over to. An installation configured without one
   * has no interactive authorization to offer, and a route that redirects into nothing would be a
   * worse answer than not being there.
   */
  if (consentUrl !== null) {
    app.get<{ Querystring: AuthorizeQuery }>(
      "/api/v1/mcp/oauth/authorize",
      {
        schema: {
          tags: ["mcp"],
          summary: "Start an authorization",
          description:
            "Validates what must never be redirected -- the client and the address -- and then sends the person to the consent screen. Errors a client can act on travel back to the registered address with an `error` from RFC 6749 section 4.1.2.1; the rest stop here."
        }
      },
      async (request, reply) => {
        const query = request.query;
        const clientId = query.client_id ?? "";
        const redirectUri = query.redirect_uri ?? "";

        try {
          await mcp.requireRedirectable(clientId, redirectUri);
        } catch (error) {
          // Not redirected to the client, on purpose: this is the failure that says the request
          // did not come from anything this installation knows.
          const code = error instanceof McpOauthError ? error.code : "MCP_REQUEST_INVALID";
          return noStore(reply).redirect(`${consentUrl}?${new URLSearchParams({ error: code }).toString()}`, 303);
        }

        // From here the address is registered, so a failure can be reported to the client that
        // owns it. The names are the ones RFC 6749 section 4.1.2.1 registered for this endpoint --
        // not the token endpoint's, which a client would not recognise here.
        const bounce = (error: RegisteredOauthError, description: string) =>
          noStore(reply).redirect(
            `${redirectUri}?${new URLSearchParams({
              error,
              error_description: description,
              ...(query.state === undefined ? {} : { state: query.state })
            }).toString()}`,
            303
          );

        if (query.response_type !== "code")
          return bounce("unsupported_response_type", "This server issues authorization codes only.");
        if (query.code_challenge_method !== "S256" || !isPkceChallenge(query.code_challenge))
          return bounce("invalid_request", "A PKCE challenge computed with S256 is required.");
        if (query.resource !== mcp.audience) return bounce("invalid_target", "The request did not name this resource.");
        // Only that the names exist. Whether this person may grant them depends on permissions
        // nobody has read yet, and answering that here would mean answering it twice.
        if ((query.scope ?? "").split(" ").some((name) => name !== "" && !mcpScopes.includes(name as McpScope)))
          return bounce("invalid_scope", "One of the scopes asked for is not offered here.");

        return noStore(reply).redirect(
          `${consentUrl}?${new URLSearchParams({
            client_id: clientId,
            redirect_uri: redirectUri,
            scope: query.scope ?? "",
            code_challenge: query.code_challenge ?? "",
            code_challenge_method: "S256",
            // The audience rather than the echoed value: they are equal by the check above, and
            // taking ours means the screen cannot be handed a spelling we never validated.
            resource: mcp.audience,
            ...(query.state === undefined ? {} : { state: query.state })
          }).toString()}`,
          303
        );
      }
    );

    /**
     * Dynamic client registration, RFC 7591, and the only unauthenticated write in this API.
     *
     * It exists because every assistant that speaks MCP begins by registering itself and none of
     * them offers a field to paste an identifier into: without this endpoint, "registration is
     * manual" meant in practice that nothing could connect. What makes an open write acceptable is
     * that the row it creates belongs to nobody and can reach nothing -- it is public, holds no
     * secret, is invisible to every tenant-scoped query, and stays that way until a person with a
     * fresh session approves it on a screen that says out loud that it registered itself.
     *
     * Declared beside `/authorize` and under the same condition. An installation with no consent
     * screen has no interactive authorization to offer, and letting a client register into a flow
     * it can never finish would be a worse answer than not being there.
     *
     * The limit is per caller and deliberately low. There is no cost to a registration nobody
     * claims -- the next one sweeps it after a day -- but a table somebody can grow without bound
     * is a table somebody will.
     */
    app.post<{ Body: RegistrationBody }>(
      "/api/v1/mcp/oauth/register",
      {
        config: { rateLimit: { max: 20, timeWindow: "1 hour" } },
        schema: {
          tags: ["mcp"],
          summary: "Register a client",
          description:
            "Registers a public client for an assistant that has no identifier yet (RFC 7591). The client is created without a tenant and without a secret; the first person who authorizes it claims it for theirs. A `client_name` is required although the RFC makes it optional, because it is what the consent screen shows."
        }
      },
      async (request, reply) => {
        const body = request.body ?? {};
        const redirectUris = Array.isArray(body.redirect_uris)
          ? body.redirect_uris.filter((uri): uri is string => typeof uri === "string")
          : [];
        try {
          const registration = await mcp.selfRegisterClient({
            ...(body.client_name === undefined ? {} : { clientName: body.client_name }),
            redirectUris,
            // Absent is not empty: RFC 6749 section 3.3 lets a client name no scope and take what
            // the server decides, which the service reads as the whole registrable vocabulary.
            ...(body.scope === undefined ? {} : { scopes: body.scope.split(" ").filter((name) => name !== "") })
          });
          // The identifier is not a credential -- it travels in a query string by design -- but the
          // rest of this response says what a caller may ask for, and a cache that answered a
          // second registration with the first one's identifier would hand two clients one row.
          return noStore(reply).code(201).send(oauthRegistrationResponse(registration));
        } catch (error) {
          return refuse(reply, error, registrationAnswers);
        }
      }
    );
  }

  // The callback form rather than an async one: nothing in here awaits, and a promise that
  // resolves immediately would only hide that from the next reader.
  app.register((scope, _options, done) => {
    registerFormParser(scope);

    scope.post<{ Body: TokenBody }>(
      "/api/v1/mcp/oauth/token",
      {
        // A credential endpoint reached without a cookie, so the limiter keys it on the
        // address. Tight enough to matter against a guessed secret, loose enough that an
        // agent refreshing on schedule never notices it.
        config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
        schema: { tags: ["mcp"], summary: "Exchange a code, a refresh token or a service account secret" }
      },
      async (request, reply) => {
        const body = request.body ?? {};
        try {
          switch (body.grant_type) {
            case "authorization_code":
              return noStore(reply).send(
                oauthTokenResponse(
                  await mcp.exchangeCode({
                    clientId: body.client_id ?? "",
                    ...(body.client_secret === undefined ? {} : { clientSecret: body.client_secret }),
                    code: body.code ?? "",
                    codeVerifier: body.code_verifier ?? "",
                    redirectUri: body.redirect_uri ?? "",
                    resource: body.resource
                  })
                )
              );
            case "refresh_token":
              return noStore(reply).send(
                oauthTokenResponse(
                  await mcp.refresh({
                    clientId: body.client_id ?? "",
                    ...(body.client_secret === undefined ? {} : { clientSecret: body.client_secret }),
                    refreshToken: body.refresh_token ?? "",
                    resource: body.resource
                  })
                )
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
              return noStore(reply).send(oauthTokenResponse(token));
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

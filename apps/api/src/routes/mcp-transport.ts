import {
  McpOauthError,
  McpToolInputError,
  type McpActor,
  type McpCrypto,
  type McpSessionService
} from "@control-hub/application";
import type { McpDenialCode, McpOauthDenialCode } from "@control-hub/domain";
import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { problemContentType, problemDetails } from "../problem.js";
import type { ControlHubApp } from "../server-instance.js";
import { apiVersion } from "../version.js";

/**
 * The MCP transport: JSON-RPC over one HTTP endpoint.
 *
 * It is an adapter and nothing else. Who the caller is, what they may see and what gets written
 * down are decided in `McpSessionService`, so this file holds only what is genuinely about the
 * wire -- the challenge that makes a client authorize, the session header, and the envelope each
 * kind of refusal has to travel in.
 *
 * That envelope is the one decision here worth arguing about, and it is split on purpose. A token
 * problem is answered at the HTTP layer, because an MCP client's authorization code watches for
 * `401` and the `WWW-Authenticate` challenge and acts on them without a human: burying that in a
 * JSON-RPC error would leave the client with nothing to act on. Everything else -- a permission the
 * actor lacks, a tool this installation does not publish, arguments that did not fit -- travels
 * inside the JSON-RPC envelope, because none of it is fixed by authorizing again, and answering it
 * at the transport layer would make a client tear the session down over a refusal that is simply
 * the truthful answer to what it asked.
 *
 * Specification: `docs/specifications/mcp-and-client-portal.md`.
 */

/**
 * The protocol version this server speaks.
 *
 * Answered to every `initialize`, whatever the client proposed. A client that needs another
 * version can see that it is not on offer, which is a decision it can make; agreeing to a version
 * we do not implement would be a decision nobody can recover from.
 */
export const mcpProtocolVersion = "2025-06-18";

/**
 * The JSON-RPC 2.0 codes, and the one we chose.
 *
 * `authorization` is in the implementation-defined range the specification reserves for exactly
 * this: a refusal the protocol has no name for. `internal` would say the server broke, which is
 * the opposite of what a permission check answering correctly means.
 */
export const jsonRpcCodes = {
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internal: -32603,
  authorization: -32001
} as const;

export type McpTransportAnswer =
  | { readonly kind: "http"; readonly status: number; readonly challenge: "invalid_token" | "insufficient_scope" }
  | {
      readonly kind: "rpc";
      readonly code: number;
      /** A fixed sentence. Never a submitted value, never a code the UI is meant to localise. */
      readonly message: string;
    };

/**
 * Every refusal the session can raise, and where the client is told about it.
 *
 * A `Record` over the domain's union rather than a switch with a default: a denial code added
 * later and forgotten here does not compile, instead of reaching a client as a generic failure
 * that misdescribes what happened.
 */
const answers: Record<McpDenialCode, McpTransportAnswer> = {
  MCP_TOKEN_INVALID: { kind: "http", status: 401, challenge: "invalid_token" },
  MCP_TOKEN_EXPIRED: { kind: "http", status: 401, challenge: "invalid_token" },
  MCP_AUDIENCE_INVALID: { kind: "http", status: 401, challenge: "invalid_token" },
  MCP_SCOPE_INSUFFICIENT: { kind: "http", status: 403, challenge: "insufficient_scope" },
  MCP_TENANT_MISMATCH: {
    kind: "rpc",
    code: jsonRpcCodes.authorization,
    message: "The call named a tenant this token does not carry"
  },
  // Indistinguishable from a name that exists somewhere else, on purpose: probing the catalogue
  // must not tell anybody which tools another installation publishes.
  TOOL_NOT_PUBLISHED: {
    kind: "rpc",
    code: jsonRpcCodes.invalidParams,
    message: "No tool by that name is published here"
  },
  // The same code REST answers with, which is the parity criterion of the whole phase.
  PERMISSION_DENIED: { kind: "rpc", code: jsonRpcCodes.authorization, message: "Permission denied" }
};

/**
 * What reaches a client for a refusal that belongs to the authorization server.
 *
 * None of those codes can arrive here: they are raised while exchanging a code or refreshing, and
 * this endpoint only ever sees a bearer token. If one does arrive, something is wired wrong, and
 * answering `invalid_token` would send a client into an OAuth loop that cannot end.
 */
const wiredWrong: McpTransportAnswer = {
  kind: "rpc",
  code: jsonRpcCodes.internal,
  message: "The server could not complete the call"
};

export function mcpTransportAnswer(code: McpDenialCode | McpOauthDenialCode): McpTransportAnswer {
  return Object.hasOwn(answers, code) ? answers[code as McpDenialCode] : wiredWrong;
}

/**
 * The session id a grant is given, derived rather than stored.
 *
 * Everything a session would hold -- tenant, actor, scopes -- is re-read from the token on every
 * request, because authority resolved once and cached is authority that outlives its withdrawal.
 * That leaves the id with nothing to key into, so it is a hash of the grant: no table, no memory
 * that grows while nobody looks, and no state to replicate between instances. Presenting the id of
 * another grant is then an error and not a resumption, checked by recomputing it from the token in
 * hand.
 */
export function mcpSessionId(crypto: Pick<McpCrypto, "sha256">, grantId: string): string {
  return crypto.sha256(`mcp-session:${grantId}`);
}

export type McpTransportContext = {
  app: ControlHubApp;
  session: McpSessionService;
  crypto: Pick<McpCrypto, "sha256" | "matches">;
  /** The public origin of this API, so the challenge can name the metadata document. */
  issuer: string;
};

type JsonRpcId = string | number | null;
type JsonRpcRequest = { readonly id: JsonRpcId | undefined; readonly method: string; readonly params: unknown };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The one well-formed shape this endpoint accepts.
 *
 * Batches are gone from this protocol version, so an array is a request from something speaking an
 * older dialect; answering it half-way would be worse than saying so.
 */
function readRequest(body: unknown): JsonRpcRequest | null {
  if (!isObject(body) || body.jsonrpc !== "2.0" || typeof body.method !== "string") return null;
  const id = body.id;
  if (id !== undefined && typeof id !== "string" && typeof id !== "number" && id !== null) return null;
  return { id, method: body.method, params: body.params };
}

function bearer(header: string | undefined): string | undefined {
  if (!header) return undefined;
  return /^Bearer\s+(\S+)$/i.exec(header)?.[1];
}

export function registerMcpTransportRoutes({ app, session, crypto, issuer }: McpTransportContext) {
  const resourceMetadata = `${issuer}/.well-known/oauth-protected-resource`;

  const result = (id: JsonRpcId | undefined, value: unknown) => ({ jsonrpc: "2.0", id: id ?? null, result: value });

  const failed = (id: JsonRpcId | undefined, code: number, message: string, detail?: Record<string, unknown>) => ({
    jsonrpc: "2.0",
    id: id ?? null,
    error: { code, message, ...(detail ? { data: detail } : {}) }
  });

  /**
   * A refusal at the HTTP layer, with the challenge RFC 9728 asks for.
   *
   * The challenge names the metadata document rather than describing what to do, because that
   * document is the whole discovery path for a client that has never seen this server.
   */
  const challenge = (
    request: FastifyRequest,
    reply: FastifyReply,
    answer: Extract<McpTransportAnswer, { kind: "http" }>,
    code: string
  ) =>
    reply
      .code(answer.status)
      .type(problemContentType)
      .header("www-authenticate", `Bearer error="${answer.challenge}", resource_metadata="${resourceMetadata}"`)
      .send(
        problemDetails({
          status: answer.status,
          code,
          instance: request.url.split("?")[0] ?? request.url,
          requestId: request.id
        })
      );

  const refuse = (request: FastifyRequest, reply: FastifyReply, error: unknown, id: JsonRpcId | undefined) => {
    if (error instanceof McpToolInputError) {
      // Its message quotes what was submitted, and that string would travel to logs, terminals and
      // screen shares. The client is told which call was wrong, not what was in it.
      return reply.send(
        failed(id, jsonRpcCodes.invalidParams, "The arguments did not match the schema of that tool", {
          code: "TOOL_INPUT_INVALID",
          requestId: request.id
        })
      );
    }
    if (error instanceof McpOauthError) {
      const answer = mcpTransportAnswer(error.code);
      if (answer.kind === "http") return challenge(request, reply, answer, error.code);
      return reply.send(failed(id, answer.code, answer.message, { code: error.code, requestId: request.id }));
    }
    // Ours, not the caller's. A failure from a use case can quote a query, a host or a row, so it
    // goes to the log with the request id and the client gets a sentence.
    request.log.error({ err: error }, "mcp tool call failed");
    return reply.send(
      failed(id, jsonRpcCodes.internal, "The tool did not complete", {
        code: "TOOL_EXECUTION_FAILED",
        requestId: request.id
      })
    );
  };

  void app.register((scope, _options, done) => {
    /**
     * The framework's own refusals, in the envelope this endpoint speaks.
     *
     * A body that is not JSON, or is too large, reaches here as a Fastify error. The API's handler
     * would answer it in the shape the rest of the API uses, which an MCP client cannot read at
     * all. Scoped to this plugin, so nothing else changes envelope.
     */
    scope.setErrorHandler((error: FastifyError, request: FastifyRequest, reply: FastifyReply) => {
      const statusCode = typeof error.statusCode === "number" ? error.statusCode : 500;
      const clientsFault = statusCode >= 400 && statusCode < 500;
      if (!clientsFault) request.log.error({ err: error }, "mcp transport failed");
      return reply
        .code(clientsFault ? 400 : 500)
        .send(
          clientsFault
            ? failed(null, jsonRpcCodes.invalidRequest, "The request was not a JSON-RPC message this server accepts")
            : failed(null, jsonRpcCodes.internal, "The server could not complete the call")
        );
    });

    scope.post(
      "/mcp",
      { schema: { tags: ["mcp"], summary: "MCP JSON-RPC transport" } },
      async (request: FastifyRequest, reply: FastifyReply) => {
        let actor: McpActor;
        try {
          // Even an absent header goes through the session, so that absent, unknown and revoked
          // keep on being one answer decided in one place.
          actor = await session.authenticate(bearer(request.headers.authorization));
        } catch (error) {
          return refuse(request, reply, error, null);
        }

        const sessionId = mcpSessionId(crypto, actor.grantId);
        const presented = request.headers["mcp-session-id"];
        if (typeof presented === "string" && presented.length > 0 && !crypto.matches(presented, sessionId)) {
          // The transport's own answer for an id this server will not honour: the client starts
          // again with `initialize` rather than keep presenting one that belongs to another grant.
          return reply
            .code(404)
            .type(problemContentType)
            .send(
              problemDetails({
                status: 404,
                code: "MCP_SESSION_UNKNOWN",
                instance: request.url,
                requestId: request.id
              })
            );
        }

        const message = readRequest(request.body);
        if (!message) {
          return reply
            .code(400)
            .send(
              failed(null, jsonRpcCodes.invalidRequest, "The request was not a JSON-RPC message this server accepts")
            );
        }

        // A notification has no id and therefore no answer. Acknowledging the delivery is all a
        // sender is owed, including for one this server does not act on.
        if (message.id === undefined) return reply.code(202).send();

        switch (message.method) {
          case "initialize":
            return reply.header("mcp-session-id", sessionId).send(
              result(message.id, {
                protocolVersion: mcpProtocolVersion,
                capabilities: { tools: { listChanged: false } },
                serverInfo: { name: "control-hub", version: apiVersion() }
              })
            );

          case "tools/list":
            // Exactly what the session decided this token may call. Filtering again here would be
            // a second answer to the same question, and the two would drift.
            return reply.send(result(message.id, { tools: session.listTools(actor) }));

          case "tools/call": {
            const params = isObject(message.params) ? message.params : {};
            if (typeof params.name !== "string") {
              return reply.send(failed(message.id, jsonRpcCodes.invalidParams, "The call named no tool"));
            }
            try {
              const called = await session.callTool(actor, params.name, params.arguments ?? {});
              return reply.send(result(message.id, { content: [{ type: "text", text: JSON.stringify(called.data) }] }));
            } catch (error) {
              return refuse(request, reply, error, message.id);
            }
          }

          default:
            return reply.send(
              failed(
                message.id,
                jsonRpcCodes.methodNotFound,
                "This server implements initialize, tools/list and tools/call"
              )
            );
        }
      }
    );

    /**
     * No stream to open, and no session to close.
     *
     * `405` is what the transport specification reserves for a server that offers neither, and it
     * is the truthful answer here: there is no server-initiated stream, and a session that holds
     * nothing has nothing to terminate. A `404` would say the endpoint is not there at all, which
     * would send a client looking for a different address.
     */
    scope.route({
      method: ["GET", "DELETE"],
      url: "/mcp",
      schema: { tags: ["mcp"], summary: "Not offered: this transport has no stream and no stored session" },
      handler: (_request: FastifyRequest, reply: FastifyReply) => reply.code(405).header("allow", "POST").send()
    });

    done();
  });
}

import { McpOauthError, McpToolInputError, type McpActor, type McpSessionService } from "@control-hub/application";
import { mcpDenialCodes, mcpOauthDenialCodes } from "@control-hub/domain";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import type { ControlHubApp } from "../server-instance.js";
import {
  jsonRpcCodes,
  mcpProtocolVersion,
  mcpSessionId,
  mcpTransportAnswer,
  registerMcpTransportRoutes
} from "./mcp-transport.js";

const issuer = "https://hub.test";

describe("where a refusal travels, and why", () => {
  it("answers every refusal the session can raise", () => {
    // A `Record` over the union makes this exhaustive at compile time already. The loop makes it
    // visible: a code added to the domain with no answer here would reach a client as a shape
    // nothing in it knows how to read.
    for (const code of mcpDenialCodes) {
      expect(mcpTransportAnswer(code), code).toBeDefined();
    }
  });

  it("keeps a token problem at the HTTP layer, where a client's OAuth code is listening", () => {
    // An MCP client discovers it must authorize by reading a 401 and the challenge on it. Wrapping
    // that in a JSON-RPC error would hide the one signal the client acts on automatically.
    for (const code of ["MCP_TOKEN_INVALID", "MCP_TOKEN_EXPIRED", "MCP_AUDIENCE_INVALID"] as const) {
      expect(mcpTransportAnswer(code), code).toMatchObject({ kind: "http", status: 401, challenge: "invalid_token" });
    }
    expect(mcpTransportAnswer("MCP_SCOPE_INSUFFICIENT")).toMatchObject({
      kind: "http",
      status: 403,
      challenge: "insufficient_scope"
    });
  });

  it("keeps a product decision inside the envelope, so the agent is told rather than disconnected", () => {
    // A missing permission is not a broken session. Answering it at the HTTP layer would make a
    // client tear down and re-authorize over something no amount of re-authorizing fixes.
    for (const code of ["MCP_TENANT_MISMATCH", "TOOL_NOT_PUBLISHED", "PERMISSION_DENIED"] as const) {
      expect(mcpTransportAnswer(code), code).toMatchObject({ kind: "rpc" });
    }
    expect(mcpTransportAnswer("TOOL_NOT_PUBLISHED")).toMatchObject({ code: jsonRpcCodes.invalidParams });
  });

  it("never puts an internal code where a client reads a sentence", () => {
    // The message reaches terminals and screen shares. A fixed sentence, and never a value the
    // caller sent or a code the UI is supposed to localise.
    for (const code of mcpDenialCodes) {
      const answer = mcpTransportAnswer(code);
      if (answer.kind !== "rpc") continue;
      expect(answer.message, code).toMatch(/^[A-Z][A-Za-z0-9 ,.'-]+$/);
      expect(answer.message, code).not.toContain("MCP_");
    }
  });

  it("treats an authorization server refusal here as a fault of ours, not as a 401", () => {
    // None of these can reach a bearer-authenticated transport: they belong to the code exchange
    // and the refresh. If one ever arrives, something is wired wrong, and answering `invalid_token`
    // would send a client into an OAuth loop that cannot end.
    for (const code of mcpOauthDenialCodes) {
      if ((mcpDenialCodes as readonly string[]).includes(code)) continue;
      expect(mcpTransportAnswer(code), code).toMatchObject({ kind: "rpc", code: jsonRpcCodes.internal });
    }
  });
});

/**
 * The wire, with a stub session behind it.
 *
 * What is under test is everything the session cannot see: whether a client is challenged in the
 * way that makes it authorize, whether a session id from another grant is refused, and whether
 * anything the caller sent or the tool failed on travels back out. None of that depends on a
 * database, and a test that needed one to prove a header is a test nobody runs.
 */
const actor: McpActor = {
  tenantId: "tenant-1",
  tokenId: "token-1",
  grantId: "grant-1",
  scopes: ["mcp:tools.list", "crm.read"],
  actorType: "user",
  actorId: "membership-1",
  context: {
    tenantId: "tenant-1",
    userId: "user-1",
    membershipId: "membership-1",
    roles: ["owner"],
    permissions: ["customers:read"],
    mfaEnabled: true
  }
};

const sha256 = (value: string) => `sha256(${value})`;

const boot = async (
  overrides: {
    authenticate?: unknown;
    call?: unknown;
    tools?: readonly unknown[];
  } = {}
) => {
  const calls: Array<{ method: string; input: unknown }> = [];
  const session = {
    authenticate: (bearer: string | undefined) => {
      calls.push({ method: "authenticate", input: bearer });
      const answer = overrides.authenticate ?? actor;
      return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
    },
    listTools: () => {
      calls.push({ method: "listTools", input: null });
      return (
        overrides.tools ?? [
          { name: "crm.customers.list", description: "List customers", inputSchema: { type: "object" } }
        ]
      );
    },
    callTool: (_actor: McpActor, name: string, input: unknown) => {
      calls.push({ method: "callTool", input: { name, input } });
      const answer = overrides.call ?? { data: { items: [{ id: "customer-1" }] }, items: 1 };
      return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
    }
  } as unknown as McpSessionService;

  const app = Fastify();
  registerMcpTransportRoutes({
    app: app as unknown as ControlHubApp,
    session,
    crypto: { sha256, matches: (a: string, b: string) => a === b },
    issuer
  });
  await app.ready();
  return { app, calls };
};

const rpc = (body: unknown, headers: Record<string, string> = {}) => ({
  method: "POST" as const,
  url: "/mcp",
  headers: { "content-type": "application/json", authorization: "Bearer chm_at_1", ...headers },
  payload: JSON.stringify(body)
});

describe("the transport on the wire", () => {
  it("tells an unauthenticated client where to go and get authorized", async () => {
    // RFC 9728 section 5.1: the challenge names the metadata document, and that is the whole
    // discovery path for a client that has never seen this server before.
    const { app, calls } = await boot({ authenticate: new McpOauthError("MCP_TOKEN_INVALID") });
    const response = await app.inject({
      ...rpc({ jsonrpc: "2.0", id: 1, method: "initialize" }, { authorization: "" })
    });

    expect(response.statusCode).toBe(401);
    expect(response.headers["www-authenticate"]).toContain(
      `resource_metadata="${issuer}/.well-known/oauth-protected-resource"`
    );
    expect(response.headers["www-authenticate"]).toContain('error="invalid_token"');
    expect(response.headers["content-type"]).toContain("application/problem+json");
    expect(response.json()).toMatchObject({ status: 401, code: "MCP_TOKEN_INVALID" });
    // Nothing was dispatched: the method never ran.
    expect(calls.map((call) => call.method)).toEqual(["authenticate"]);
  });

  it("tells an expired token apart, because that is the one refusal a client can act on", async () => {
    const { app } = await boot({ authenticate: new McpOauthError("MCP_TOKEN_EXPIRED") });
    const response = await app.inject({ ...rpc({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ code: "MCP_TOKEN_EXPIRED" });
  });

  it("opens a session and names it after the grant it belongs to", async () => {
    const { app } = await boot();
    const response = await app.inject({
      ...rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05" } })
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      result: { protocolVersion: mcpProtocolVersion, capabilities: { tools: {} } }
    });
    // Derived, not stored: everything a session would hold is re-read from the token on every
    // request, so the id is a binding to the grant and not a key into anything.
    expect(response.headers["mcp-session-id"]).toBe(mcpSessionId({ sha256 }, "grant-1"));
  });

  it("refuses to resume a session that belongs to another grant", async () => {
    // The spec calls this an error and not a resumption. A 404 is what tells the client to start
    // again with `initialize` rather than to keep presenting an id from somebody else's session.
    const { app, calls } = await boot();
    const response = await app.inject({
      ...rpc({ jsonrpc: "2.0", id: 1, method: "tools/list" }, { "mcp-session-id": mcpSessionId({ sha256 }, "grant-2") })
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ code: "MCP_SESSION_UNKNOWN" });
    expect(calls.map((call) => call.method)).not.toContain("listTools");
  });

  it("carries on when the session id is the one this grant was given", async () => {
    const { app } = await boot();
    const response = await app.inject({
      ...rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" }, { "mcp-session-id": mcpSessionId({ sha256 }, "grant-1") })
    });
    expect(response.statusCode).toBe(200);
  });

  it("lists exactly what the session listed, and adds nothing of its own", async () => {
    // The narrowing is a decision the session makes from the token. A transport that filtered
    // again, or that padded the list from the catalogue, would be a second answer to the same
    // question -- and the two would drift.
    const { app } = await boot({
      tools: [{ name: "support.tickets.list", description: "List tickets", inputSchema: { type: "object" } }]
    });
    const response = await app.inject({ ...rpc({ jsonrpc: "2.0", id: 3, method: "tools/list" }) });

    expect(response.json().result).toEqual({
      tools: [{ name: "support.tickets.list", description: "List tickets", inputSchema: { type: "object" } }]
    });
  });

  it("passes the arguments through untouched and hands back what the tool produced", async () => {
    const { app, calls } = await boot();
    const response = await app.inject({
      ...rpc({
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: { name: "crm.customers.list", arguments: { limit: 5 } }
      })
    });

    expect(calls).toContainEqual({ method: "callTool", input: { name: "crm.customers.list", input: { limit: 5 } } });
    const content = response.json().result.content as Array<{ type: string; text: string }>;
    expect(content[0]).toMatchObject({ type: "text" });
    expect(JSON.parse(content[0]!.text)).toEqual({ items: [{ id: "customer-1" }] });
  });

  it("gives a missing permission the same code REST would, inside the envelope", async () => {
    // Parity is the acceptance criterion of the whole phase: the same actor asking the same thing
    // through the UI, through REST or through MCP is refused with the same code.
    const { app } = await boot({ call: new McpOauthError("PERMISSION_DENIED") });
    const response = await app.inject({
      ...rpc({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "usage.summary" } })
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      id: 5,
      error: { code: jsonRpcCodes.authorization, data: { code: "PERMISSION_DENIED" } }
    });
  });

  it("challenges a token that is simply too narrow, so the client can ask for more", async () => {
    const { app } = await boot({ call: new McpOauthError("MCP_SCOPE_INSUFFICIENT") });
    const response = await app.inject({
      ...rpc({ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "usage.summary" } })
    });

    expect(response.statusCode).toBe(403);
    expect(response.headers["www-authenticate"]).toContain('error="insufficient_scope"');
    expect(response.json()).toMatchObject({ code: "MCP_SCOPE_INSUFFICIENT" });
  });

  it("answers a method it does not implement without touching the session", async () => {
    const { app, calls } = await boot();
    const response = await app.inject({ ...rpc({ jsonrpc: "2.0", id: 7, method: "resources/list" }) });

    expect(response.json()).toMatchObject({ id: 7, error: { code: jsonRpcCodes.methodNotFound } });
    expect(calls.map((call) => call.method)).toEqual(["authenticate"]);
  });

  it("accepts a notification and says nothing back, because a notification has no answer", async () => {
    const { app } = await boot();
    const response = await app.inject({ ...rpc({ jsonrpc: "2.0", method: "notifications/initialized" }) });
    expect(response.statusCode).toBe(202);
    expect(response.body).toBe("");
  });

  it("refuses a batch, which this protocol version does not have", async () => {
    const { app, calls } = await boot();
    const response = await app.inject({ ...rpc([{ jsonrpc: "2.0", id: 8, method: "tools/list" }]) });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: jsonRpcCodes.invalidRequest }, id: null });
    expect(calls.map((call) => call.method)).not.toContain("listTools");
  });

  it("refuses a call that names no tool before the session is asked to run one", async () => {
    const { app, calls } = await boot();
    const response = await app.inject({ ...rpc({ jsonrpc: "2.0", id: 9, method: "tools/call", params: {} }) });

    expect(response.json()).toMatchObject({ id: 9, error: { code: jsonRpcCodes.invalidParams } });
    expect(calls.map((call) => call.method)).not.toContain("callTool");
  });

  it("says the arguments were wrong without repeating them", async () => {
    // The message of an input error quotes what was submitted. That string ends up in logs and on
    // screens, so the sentence the client receives is ours and the detail stays where it was.
    const { app } = await boot({ call: new McpToolInputError("customerId must be a uuid, got 'secret-value'") });
    const response = await app.inject({
      ...rpc({ jsonrpc: "2.0", id: 10, method: "tools/call", params: { name: "crm.customers.get", arguments: {} } })
    });

    const body = response.body;
    expect(response.json()).toMatchObject({ id: 10, error: { code: jsonRpcCodes.invalidParams } });
    expect(body).not.toContain("secret-value");
  });

  it("says a tool failed without saying what it failed on", async () => {
    // A failure from a use case can quote a query, a host or a row. None of that is the caller's.
    const { app } = await boot({ call: new Error("connection to 10.0.0.4:5432 refused") });
    const response = await app.inject({
      ...rpc({ jsonrpc: "2.0", id: 11, method: "tools/call", params: { name: "crm.customers.list" } })
    });

    expect(response.json()).toMatchObject({ id: 11, error: { code: jsonRpcCodes.internal } });
    expect(response.body).not.toContain("10.0.0.4");
  });

  it("answers a body that is not a JSON-RPC message in the envelope, not in ours", async () => {
    // A parse failure reaches the endpoint as a framework error. Answered in this API's usual
    // shape it would be unreadable to an MCP client, which is the one caller this route has.
    const { app } = await boot();
    const response = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: { "content-type": "application/json", authorization: "Bearer chm_at_1" },
      payload: "{ not json"
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ jsonrpc: "2.0", error: { code: jsonRpcCodes.invalidRequest } });
  });

  it("offers no stream to open and no session to close, and says so with the status that means it", async () => {
    // The transport specification reserves 405 for a server that offers neither. A 404 would say
    // the endpoint is not there at all, and send a client looking for another address.
    const { app } = await boot();
    for (const method of ["GET", "DELETE"] as const) {
      const response = await app.inject({ method, url: "/mcp", headers: { authorization: "Bearer chm_at_1" } });
      expect(response.statusCode, method).toBe(405);
      expect(response.headers["allow"], method).toBe("POST");
    }
  });

  it("never lets the presented token back out in an answer", async () => {
    const { app } = await boot();
    const response = await app.inject({ ...rpc({ jsonrpc: "2.0", id: 12, method: "tools/list" }) });
    expect(response.body).not.toContain("chm_at_1");
  });
});

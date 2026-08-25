import { McpOauthError, type McpOauthService } from "@control-hub/application";
import { mcpDenialCodes, mcpOauthDenialCodes } from "@control-hub/domain";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import type { ControlHubApp } from "../server-instance.js";
import { mcpOauthAnswer, registerMcpOauthRoutes, registeredOauthErrors } from "./mcp-oauth.js";

const everyCode = [...mcpOauthDenialCodes, ...mcpDenialCodes];

describe("what an OAuth client is told when it is refused", () => {
  it("answers every code this server can raise", () => {
    // The implementation keeps a `Record` over the union, so this is already exhaustive at compile
    // time. The loop makes the guarantee visible: a code added to the domain with no answer here
    // would be a token endpoint failing in a way no client can parse.
    for (const code of everyCode) {
      expect(mcpOauthAnswer(code), code).toBeDefined();
    }
  });

  it("uses only error names the RFCs registered, because a client matches on them", () => {
    // An OAuth client branches on `error`. An invented value reaches it as an unrecognised
    // failure, which is how "reconnect your account" becomes "this integration is broken".
    for (const code of everyCode) {
      expect(registeredOauthErrors, code).toContain(mcpOauthAnswer(code).error);
    }
  });

  it("never puts our internal code where the client reads the error name", () => {
    for (const code of everyCode) {
      expect(mcpOauthAnswer(code).error).not.toContain("MCP_");
    }
  });

  it("keeps the description a fixed sentence, so nothing the caller sent can travel back", () => {
    // The description reaches logs, terminals and screen shares. Echoing a submitted value there
    // is how a redirect_uri or a scope somebody typed ends up somewhere it was never meant to be.
    for (const code of everyCode) {
      expect(mcpOauthAnswer(code).description, code).toMatch(/^[A-Z][A-Za-z0-9 ,.'-]+$/);
    }
  });

  it("says 401 exactly when the credential presented is the problem", () => {
    // RFC 6749 section 5.2 and RFC 6750 section 3.1. Everything else is a well-formed caller
    // asking for something it may not have, which is a 400 or a 403 rather than a challenge.
    for (const code of everyCode) {
      const answer = mcpOauthAnswer(code);
      const aboutTheCredential = answer.error === "invalid_client" || answer.error === "invalid_token";
      expect(answer.status === 401, code).toBe(aboutTheCredential);
    }
  });

  it("calls a spent, mismatched or withdrawn credential an invalid grant and nothing else", () => {
    // These are the same fact to a client -- what it holds no longer works -- and telling them
    // apart would say whether a token existed, which is what a probe wants to learn.
    for (const code of ["MCP_CODE_INVALID", "MCP_PKCE_INVALID", "MCP_REFRESH_INVALID", "MCP_GRANT_REVOKED"] as const) {
      expect(mcpOauthAnswer(code).error, code).toBe("invalid_grant");
    }
    // Reuse answers identically on the wire, deliberately: the family is already revoked by the
    // time this is written, and a distinct error would tell a thief their token had been noticed.
    expect(mcpOauthAnswer("MCP_REFRESH_REUSED")).toEqual(mcpOauthAnswer("MCP_REFRESH_INVALID"));
  });

  it("uses invalid_target for a token asked of the wrong resource", () => {
    // RFC 8707 section 2 registered this exact name for it. `invalid_request` would tell a client
    // to fix its syntax when what it must fix is which server it asked.
    expect(mcpOauthAnswer("MCP_AUDIENCE_INVALID").error).toBe("invalid_target");
  });

  it("refuses a bad redirect at the endpoint instead of sending anything to it", () => {
    // OAuth 2.1 section 4.1.2.1: an unvalidated redirect must never be redirected to. A 400 here
    // is what keeps an attacker from using this server to bounce a code to an address of theirs.
    expect(mcpOauthAnswer("MCP_REDIRECT_URI_MISMATCH")).toMatchObject({ status: 400, error: "invalid_request" });
  });

  it("separates a scope that cannot be granted from a scope a live token does not carry", () => {
    // The first is a consent that will never be offered; the second is a token that exists and is
    // too narrow. A client can retry the second with a new authorization and not the first.
    expect(mcpOauthAnswer("MCP_SCOPE_UNAVAILABLE")).toMatchObject({ status: 400, error: "invalid_scope" });
    expect(mcpOauthAnswer("MCP_SCOPE_INSUFFICIENT")).toMatchObject({ status: 403, error: "insufficient_scope" });
    expect(mcpOauthAnswer("MCP_REQUEST_INVALID").error).toBe("invalid_request");
  });

  it("treats a token this server will not accept as an invalid token, not as a bad request", () => {
    for (const code of ["MCP_TOKEN_INVALID", "MCP_TOKEN_EXPIRED"] as const) {
      expect(mcpOauthAnswer(code), code).toMatchObject({ status: 401, error: "invalid_token" });
    }
  });

  it("gives a client that cannot prove who it is one answer, whatever was wrong with it", () => {
    // Unknown, suspended and wrong secret are one answer. Distinguishing them turns the token
    // endpoint into a directory of which clients this installation has.
    const answers = (["MCP_CLIENT_UNKNOWN", "MCP_CLIENT_SUSPENDED", "MCP_CLIENT_AUTH_FAILED"] as const).map(
      mcpOauthAnswer
    );
    expect(new Set(answers.map((answer) => JSON.stringify(answer))).size).toBe(1);
    expect(answers[0]).toMatchObject({ status: 401, error: "invalid_client" });
  });

  it("answers the decisions that are not about OAuth at all with a plain denial", () => {
    // A tool that is not published, a permission the actor lacks and a token from another tenant
    // are product decisions, not protocol ones. `access_denied` is the registered name for exactly
    // that, and inventing a protocol error for them would misdescribe what happened.
    for (const code of ["MCP_TENANT_MISMATCH", "TOOL_NOT_PUBLISHED", "PERMISSION_DENIED"] as const) {
      expect(mcpOauthAnswer(code), code).toMatchObject({ status: 403, error: "access_denied" });
    }
  });
});

/**
 * The wire itself, with a stub service behind it.
 *
 * What is under test here is everything the service cannot see: whether a form-encoded body is
 * parsed at all, whether a token response can be cached on the way back, and whether a refusal
 * comes out in the envelope an OAuth client knows how to read. A stub rather than the real service
 * because none of those depend on what the answer was -- and a test that needed a database to
 * prove that `cache-control` is set is a test nobody runs.
 */
const stub = (overrides: Partial<Record<string, unknown>> = {}) => {
  const calls: Array<{ method: string; input: unknown }> = [];
  const record =
    (method: string, result: unknown) =>
    (input: unknown): Promise<unknown> => {
      calls.push({ method, input });
      if (result instanceof McpOauthError) return Promise.reject(result);
      return Promise.resolve(result);
    };
  const service = {
    protectedResourceMetadata: () => ({ resource: "https://hub.test/mcp" }),
    authorizationServerMetadata: () => ({ issuer: "https://hub.test" }),
    exchangeCode: record("exchangeCode", overrides.exchangeCode ?? { access_token: "x" }),
    refresh: record("refresh", overrides.refresh ?? { access_token: "y" }),
    authenticateServiceAccount: record(
      "authenticateServiceAccount",
      overrides.authenticateServiceAccount ?? {
        accessToken: "chm_at_1",
        tokenType: "Bearer",
        expiresIn: 1800,
        scope: "mcp:tools.list",
        usedPreviousSecret: false
      }
    ),
    revokeToken: record("revokeToken", overrides.revokeToken ?? undefined)
  } as unknown as McpOauthService;
  return { service, calls };
};

const boot = async (overrides?: Partial<Record<string, unknown>>) => {
  const { service, calls } = stub(overrides);
  const app = Fastify();
  registerMcpOauthRoutes({ app: app as unknown as ControlHubApp, mcp: service });
  await app.ready();
  return { app, calls };
};

const form = (body: Record<string, string>) => ({
  method: "POST" as const,
  headers: { "content-type": "application/x-www-form-urlencoded" },
  payload: new URLSearchParams(body).toString()
});

describe("the token endpoint on the wire", () => {
  it("reads the form encoding every OAuth client sends", async () => {
    const { app, calls } = await boot();
    const response = await app.inject({
      ...form({
        grant_type: "authorization_code",
        client_id: "client-1",
        code: "chm_ac_1",
        code_verifier: "verifier",
        redirect_uri: "http://127.0.0.1:51763/callback",
        resource: "https://hub.test/mcp"
      }),
      url: "/api/v1/mcp/oauth/token"
    });

    expect(response.statusCode).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ method: "exchangeCode", input: { clientId: "client-1", code: "chm_ac_1" } });
  });

  it("omits the client secret rather than passing an empty one for a public client", async () => {
    // An empty string is not the same as no secret at all: the service refuses a public client
    // that presents one, and every public client would look like that mistake.
    const { app, calls } = await boot();
    await app.inject({
      ...form({ grant_type: "refresh_token", client_id: "client-1", refresh_token: "chm_rt_1" }),
      url: "/api/v1/mcp/oauth/token"
    });
    expect(calls[0]!.input).not.toHaveProperty("clientSecret");
  });

  it("tells every cache on the way back not to keep the answer", async () => {
    // RFC 6749 section 5.1. The body is a bearer credential, and a proxy that stores it hands it
    // to the next caller who asks for the same URL.
    const { app } = await boot();
    const response = await app.inject({
      ...form({ grant_type: "refresh_token", client_id: "client-1", refresh_token: "chm_rt_1" }),
      url: "/api/v1/mcp/oauth/token"
    });
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers.pragma).toBe("no-cache");
  });

  it("keeps that promise on the refusals too, which are the ones that get logged", async () => {
    const { app } = await boot({ refresh: new McpOauthError("MCP_REFRESH_REUSED") });
    const response = await app.inject({
      ...form({ grant_type: "refresh_token", client_id: "client-1", refresh_token: "chm_rt_1" }),
      url: "/api/v1/mcp/oauth/token"
    });
    expect(response.statusCode).toBe(400);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toMatchObject({ error: "invalid_grant", code: "MCP_REFRESH_REUSED" });
  });

  it("names an unknown grant type instead of answering as though the request were malformed", async () => {
    const { app, calls } = await boot();
    const response = await app.inject({
      ...form({ grant_type: "password", username: "someone", password: "hunter2" }),
      url: "/api/v1/mcp/oauth/token"
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("unsupported_grant_type");
    // And nothing reached the service: a grant type we do not offer is decided at the door.
    expect(calls).toHaveLength(0);
  });

  it("never echoes what the caller sent, whatever it sent", async () => {
    // The description reaches logs and terminals. A value typed into the wrong field must not come
    // back out of this endpoint.
    const { app } = await boot({ exchangeCode: new McpOauthError("MCP_REDIRECT_URI_MISMATCH") });
    const response = await app.inject({
      ...form({
        grant_type: "authorization_code",
        client_id: "secret-looking-value",
        code: "chm_ac_1",
        code_verifier: "verifier",
        redirect_uri: "https://attacker.example/steal"
      }),
      url: "/api/v1/mcp/oauth/token"
    });
    expect(response.payload).not.toContain("attacker.example");
    expect(response.payload).not.toContain("secret-looking-value");
  });

  it("takes a service account secret alone, and refuses one that also names a client", async () => {
    // A service account is not a registered client. Accepting a client_id would send an operator
    // looking for it in the client list, where it will never be.
    const withoutClient = await boot();
    const accepted = await withoutClient.app.inject({
      ...form({ grant_type: "client_credentials", client_secret: "chm_sa_1", resource: "https://hub.test/mcp" }),
      url: "/api/v1/mcp/oauth/token"
    });
    expect(accepted.statusCode).toBe(200);
    // `usedPreviousSecret` is ours and stays ours: an operational signal, not part of the token
    // response any client parses.
    expect(accepted.json()).not.toHaveProperty("usedPreviousSecret");
    expect(accepted.json()).toMatchObject({ tokenType: "Bearer" });

    const withClient = await boot();
    const refused = await withClient.app.inject({
      ...form({ grant_type: "client_credentials", client_id: "client-1", client_secret: "chm_sa_1" }),
      url: "/api/v1/mcp/oauth/token"
    });
    expect(refused.statusCode).toBe(400);
    expect(withClient.calls).toHaveLength(0);
  });
});

describe("the revocation endpoint on the wire", () => {
  it("answers 200 with nothing in it, RFC 7009", async () => {
    const { app } = await boot();
    const response = await app.inject({
      ...form({ token: "chm_at_1", client_id: "client-1" }),
      url: "/api/v1/mcp/oauth/revoke"
    });
    expect(response.statusCode).toBe(200);
    expect(response.payload).toBe("");
  });

  it("refuses only the client that cannot prove who it is", async () => {
    const { app } = await boot({ revokeToken: new McpOauthError("MCP_CLIENT_AUTH_FAILED") });
    const response = await app.inject({
      ...form({ token: "chm_at_1", client_id: "client-1", client_secret: "wrong" }),
      url: "/api/v1/mcp/oauth/revoke"
    });
    expect(response.statusCode).toBe(401);
    expect(response.json().error).toBe("invalid_client");
  });
});

describe("the discovery documents", () => {
  it("serves the protected resource document at both paths clients look in", async () => {
    // RFC 9728 section 3.1 puts the resource path after the well-known segment; clients differ on
    // which they try first, and a 404 on the one a client picked is a client that cannot start.
    const { app } = await boot();
    for (const url of ["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"]) {
      const response = await app.inject({ method: "GET", url });
      expect(response.statusCode, url).toBe(200);
      expect(response.json(), url).toMatchObject({ resource: "https://hub.test/mcp" });
    }
  });

  it("lets them be cached, but only for minutes", async () => {
    // They change when the server is reconfigured. An agent holding a stale endpoint list for an
    // hour after a rollout is a support ticket nobody can explain.
    const { app } = await boot();
    const response = await app.inject({ method: "GET", url: "/.well-known/oauth-authorization-server" });
    expect(response.headers["cache-control"]).toBe("public, max-age=300");
  });
});

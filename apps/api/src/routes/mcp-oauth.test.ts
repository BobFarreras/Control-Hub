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
    revokeToken: record("revokeToken", overrides.revokeToken ?? undefined),
    // Not built through `record`: this one takes two arguments, and flattening them into a single
    // `input` would make the test that checks the address was the one submitted unreadable.
    audience,
    requireRedirectable: (clientId: string, redirectUri: string): Promise<void> => {
      calls.push({ method: "requireRedirectable", input: { clientId, redirectUri } });
      const refusal = overrides.requireRedirectable;
      return refusal instanceof Error ? Promise.reject(refusal) : Promise.resolve();
    }
  } as unknown as McpOauthService;
  return { service, calls };
};

/** The audience this stubbed installation answers for, in both the service and the requests. */
const audience = "https://hub.test/mcp";

/** Where the authorization endpoint hands a person over: the panel, not this API. */
const consentUrl = "https://panel.test/mcp/consent";

const boot = async (overrides?: Partial<Record<string, unknown>>, screen: string | null = consentUrl) => {
  const { service, calls } = stub(overrides);
  const app = Fastify();
  registerMcpOauthRoutes({ app: app as unknown as ControlHubApp, mcp: service, consentUrl: screen });
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

  it("answers in the field names every OAuth library looks for", async () => {
    // RFC 6749 section 5.1. A library reads `access_token` and nothing else: our own casing here
    // would be a body that parses fine and contains no token, which reaches a person as "this
    // integration is broken" rather than as anything anybody can debug.
    const { app } = await boot({
      exchangeCode: {
        accessToken: "chm_at_1",
        refreshToken: "chm_rt_1",
        tokenType: "Bearer",
        expiresIn: 1800,
        scope: "crm.read"
      }
    });
    const response = await app.inject({
      ...form({ grant_type: "authorization_code", client_id: "client-1", code: "chm_ac_1" }),
      url: "/api/v1/mcp/oauth/token"
    });

    expect(response.json()).toEqual({
      access_token: "chm_at_1",
      refresh_token: "chm_rt_1",
      token_type: "Bearer",
      expires_in: 1800,
      scope: "crm.read"
    });
  });

  it("omits the refresh token a service account was deliberately not given", async () => {
    // Sending it as null would read as one that failed to arrive, and a client would keep trying
    // to refresh with nothing. The account presents its secret again instead.
    const { app } = await boot();
    const response = await app.inject({
      ...form({ grant_type: "client_credentials", client_secret: "chm_sa_1", resource: "https://hub.test/mcp" }),
      url: "/api/v1/mcp/oauth/token"
    });

    expect(response.json()).not.toHaveProperty("refresh_token");
    expect(response.json()).toMatchObject({ access_token: "chm_at_1", token_type: "Bearer" });
    // Ours, not OAuth's: it is a log line at the login, never a field on the wire.
    expect(response.json()).not.toHaveProperty("usedPreviousSecret");
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
    expect(accepted.json()).toMatchObject({ token_type: "Bearer" });

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

describe("the authorization endpoint on the wire", () => {
  const challenge = "a".repeat(43);
  const redirectUri = "http://127.0.0.1:51763/callback";

  const authorize = (query: Record<string, string>) =>
    `/api/v1/mcp/oauth/authorize?${new URLSearchParams(query).toString()}`;

  const wellFormed = (overrides: Record<string, string> = {}): Record<string, string> => ({
    response_type: "code",
    client_id: "client-1",
    redirect_uri: redirectUri,
    scope: "crm.read",
    state: "s-1",
    code_challenge: challenge,
    code_challenge_method: "S256",
    resource: audience,
    ...overrides
  });

  /** Where a 303 points, parsed, so a test can assert on parameters rather than on a string. */
  const destination = (location: string) => new URL(location);

  it("sends a well-formed request to the consent screen, carrying what it will need", async () => {
    const { app } = await boot();
    const response = await app.inject({ method: "GET", url: authorize(wellFormed()) });

    expect(response.statusCode).toBe(303);
    const target = destination(response.headers.location as string);
    expect(`${target.origin}${target.pathname}`).toBe(consentUrl);
    expect(Object.fromEntries(target.searchParams)).toEqual({
      client_id: "client-1",
      redirect_uri: redirectUri,
      scope: "crm.read",
      code_challenge: challenge,
      code_challenge_method: "S256",
      resource: audience,
      state: "s-1"
    });
  });

  it("never lets the browser or a proxy keep the handover", async () => {
    // The address carries a state a client will match a code against. A cached copy is that state
    // handed to whoever opens the endpoint next.
    const { app } = await boot();
    const response = await app.inject({ method: "GET", url: authorize(wellFormed()) });
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("checks the client and the address before anything else, and does so through the service", async () => {
    const { app, calls } = await boot();
    await app.inject({ method: "GET", url: authorize(wellFormed()) });
    expect(calls[0]).toMatchObject({
      method: "requireRedirectable",
      input: { clientId: "client-1", redirectUri }
    });
  });

  it("keeps an unregistered address out of the redirect it would otherwise be handed", async () => {
    // The whole reason this check comes first: bouncing the error back to the submitted address
    // would make this endpoint an open redirect for anybody who can compose a URL.
    const { app } = await boot({ requireRedirectable: new McpOauthError("MCP_REDIRECT_URI_MISMATCH") });
    const response = await app.inject({
      method: "GET",
      url: authorize(wellFormed({ redirect_uri: "https://attacker.test/collect" }))
    });

    const target = destination(response.headers.location as string);
    expect(target.origin).toBe(new URL(consentUrl).origin);
    expect(target.searchParams.get("error")).toBe("MCP_REDIRECT_URI_MISMATCH");
  });

  it("stops an unknown client at the screen too, since nothing registered it to be answered", async () => {
    const { app } = await boot({ requireRedirectable: new McpOauthError("MCP_CLIENT_UNKNOWN") });
    const response = await app.inject({ method: "GET", url: authorize(wellFormed()) });
    const target = destination(response.headers.location as string);
    expect(target.origin).toBe(new URL(consentUrl).origin);
    expect(target.searchParams.get("error")).toBe("MCP_CLIENT_UNKNOWN");
  });

  it("reports a failure it cannot name as an invalid request rather than leaking what it was", async () => {
    const { app } = await boot({ requireRedirectable: new Error("the database is down") });
    const response = await app.inject({ method: "GET", url: authorize(wellFormed()) });
    const target = destination(response.headers.location as string);
    expect(target.searchParams.get("error")).toBe("MCP_REQUEST_INVALID");
  });

  it("bounces the errors a client can act on back to its own address, with the state it sent", async () => {
    // RFC 6749 section 4.1.2.1. A client waiting on a loopback port learns nothing from a page it
    // never sees; these have to arrive where it is listening, and `state` is how it matches them
    // to the request it made.
    const cases: Array<{ query: Record<string, string>; error: string }> = [
      { query: { response_type: "token" }, error: "unsupported_response_type" },
      { query: { code_challenge_method: "plain" }, error: "invalid_request" },
      { query: { code_challenge: "too-short" }, error: "invalid_request" },
      { query: { resource: "https://elsewhere.test/mcp" }, error: "invalid_target" },
      { query: { scope: "crm.read invented.scope" }, error: "invalid_scope" }
    ];

    for (const { query, error } of cases) {
      const { app } = await boot();
      const response = await app.inject({ method: "GET", url: authorize(wellFormed(query)) });

      expect(response.statusCode, error).toBe(303);
      const target = destination(response.headers.location as string);
      expect(`${target.origin}${target.pathname}`, error).toBe(redirectUri);
      expect(target.searchParams.get("error"), error).toBe(error);
      expect(target.searchParams.get("state"), error).toBe("s-1");
      expect(target.searchParams.get("error_description"), error).toBeTruthy();
    }
  });

  it("omits the state when none was sent, rather than inventing an empty one", async () => {
    // A client that sent no state and gets `state=` back has to decide whether that is its own
    // value coming home. It is not, and the answer should not pose the question.
    const { app } = await boot();
    const query = wellFormed({ response_type: "token" });
    delete query.state;
    const response = await app.inject({ method: "GET", url: authorize(query) });
    expect(destination(response.headers.location as string).searchParams.has("state")).toBe(false);
  });

  it("accepts a request that names no scope, because the server may decide", async () => {
    // RFC 6749 section 3.3. What such a request is actually granted is settled at the screen,
    // against what the person can back -- not here, where nobody has been identified yet.
    const { app } = await boot();
    const response = await app.inject({ method: "GET", url: authorize(wellFormed({ scope: "" })) });
    const target = destination(response.headers.location as string);
    expect(`${target.origin}${target.pathname}`).toBe(consentUrl);
    expect(target.searchParams.get("scope")).toBe("");
  });

  it("is not declared at all on an installation with no panel to hand over to", async () => {
    // Better a 404 than a redirect into nothing: a client that gets one knows this server offers
    // no interactive authorization, and can say so.
    const { app } = await boot({}, null);
    const response = await app.inject({ method: "GET", url: authorize(wellFormed()) });
    expect(response.statusCode).toBe(404);
  });
});

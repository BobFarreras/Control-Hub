import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";

/**
 * What the composed application actually exposes, rather than what a route module does in isolation.
 *
 * The route tests prove the handlers. This proves the wiring around them: that the surface exists
 * when the flag and the issuer say it should, that it is genuinely absent otherwise, and that the
 * audience a client discovers is the one built from the configured origin. None of it needs a
 * database -- every answer here is decided before anything is read -- which is what keeps it a test
 * that runs everywhere instead of a manual check somebody remembers to do.
 */
const apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => Promise.all(apps.splice(0).map((app) => app.close())));

const unreachable = { databaseUrl: "postgres://localhost:1/missing", redisUrl: "redis://localhost:1" };
const issuer = "https://hub.test";

const boot = (options: Partial<Parameters<typeof buildApp>[0]> = {}) => {
  const app = buildApp({ ...unreachable, ...options });
  apps.push(app);
  return app;
};

const enabled = { featureFlags: new Set(["mcp"] as const), mcpIssuer: issuer };

describe("the MCP surface, as the composition root declares it", () => {
  it("challenges an unauthenticated call at the transport, with the document that explains how to fix it", async () => {
    const app = boot(enabled);
    const response = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" })
    });

    expect(response.statusCode).toBe(401);
    expect(response.headers["www-authenticate"]).toContain(
      `resource_metadata="${issuer}/.well-known/oauth-protected-resource"`
    );
  });

  it("publishes the resource the tokens are minted for, and not a second spelling of it", async () => {
    // The audience travels from configuration to the metadata document to every token. Two places
    // building it would be two places to disagree, and the disagreement would only show up as
    // clients being refused for an audience that looks identical in the logs.
    const app = boot(enabled);
    const response = await app.inject({ method: "GET", url: "/.well-known/oauth-protected-resource" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ resource: `${issuer}/mcp`, authorization_servers: [issuer] });
  });

  it("offers no stream and no session to close", async () => {
    const app = boot(enabled);
    const response = await app.inject({ method: "GET", url: "/mcp" });
    expect(response.statusCode).toBe(405);
  });

  it("declares no management surface on an installation with no interactive authentication", async () => {
    // The OAuth endpoints and the transport work without a session -- one caller holds a code, the
    // other holds a token. The management routes act for a person, so on an installation that
    // configures no authentication they are absent rather than reachable and unguarded.
    const app = boot(enabled);
    for (const url of [
      "/api/v1/mcp/clients",
      "/api/v1/mcp/grants",
      "/api/v1/mcp/service-accounts",
      "/api/v1/mcp/consent"
    ]) {
      const response = await app.inject({ method: "GET", url });
      expect(response.statusCode, url).toBe(404);
    }
  });

  it("offers no interactive authorization on an installation with no panel to send anybody to", async () => {
    // Without a screen there is nothing to hand a person over to. A 404 tells a client that this
    // server offers no interactive authorization; a redirect into nothing would tell it nothing.
    const app = boot(enabled);
    const response = await app.inject({ method: "GET", url: "/api/v1/mcp/oauth/authorize" });
    expect(response.statusCode).toBe(404);
  });

  it("hands a person over to the panel, at an address with no locale in it", async () => {
    // Which language the screen speaks is the panel's decision, made from what the browser asks
    // for. A list of locales copied into the API would be a second place for it to be wrong.
    //
    // The client cannot be resolved here -- there is no database behind this app -- so what the
    // handover carries is a refusal. That is the case worth pinning: a request nobody can make
    // sense of still ends at our screen rather than at an address the request chose.
    const app = boot({ ...enabled, appOrigin: "https://panel.test" });
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/mcp/oauth/authorize?client_id=nobody-registered&redirect_uri=http://127.0.0.1/callback"
    });

    expect(response.statusCode).toBe(303);
    const target = new URL(response.headers.location as string);
    expect(`${target.origin}${target.pathname}`).toBe("https://panel.test/mcp/consent");
    expect(target.searchParams.get("error")).toBe("MCP_REQUEST_INVALID");
  });

  it("is not there at all while the flag is off", async () => {
    // 404 is the truth rather than a refusal: with the flag closed there is nothing behind the
    // path, exactly as the infrastructure module already behaves.
    const app = boot({ mcpIssuer: issuer });
    for (const url of ["/mcp", "/.well-known/oauth-protected-resource", "/api/v1/mcp/oauth/token"]) {
      const response = await app.inject({ method: "POST", url });
      expect(response.statusCode, url).toBe(404);
    }
  });

  it("declares nothing when the flag is on but the server does not know its own name", async () => {
    // An audience taken from a request header is an audience the caller chooses, which protects
    // nothing. Without a configured issuer the surface stays closed rather than inventing one.
    const app = boot({ featureFlags: new Set(["mcp"] as const) });
    const response = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" })
    });
    expect(response.statusCode).toBe(404);
  });
});

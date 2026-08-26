import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import type { ControlHubAuth } from "../auth.js";
import type { ControlHubApp } from "../server-instance.js";
import { registerInstallationRoutes } from "./installation.js";

function databaseFor(role: "owner" | "administrator" | "technical") {
  return vi.fn().mockResolvedValue([
    {
      tenant_id: "11111111-1111-4111-8111-111111111111",
      membership_id: "membership-1",
      role,
      permission: "security:manage"
    }
  ]) as never;
}

const auth = {
  api: { getSession: () => Promise.resolve({ user: { id: "user-1", twoFactorEnabled: true } }) }
} as unknown as ControlHubAuth;

async function boot(role: "owner" | "administrator" | "technical") {
  const app = Fastify();
  registerInstallationRoutes({
    app: app as unknown as ControlHubApp,
    auth,
    database: databaseFor(role),
    installation: { version: "0.3.0", build: "abc1234" }
  });
  await app.ready();
  return app;
}

describe("installation identity route", () => {
  it("tells an Owner which version and which build", async () => {
    const app = await boot("owner");
    const response = await app.inject({ method: "GET", url: "/api/v1/settings/installation" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ version: "0.3.0", build: "abc1234" });
    await app.close();
  });

  it("tells an Administrator too, because they are who acts on an update", async () => {
    const app = await boot("administrator");
    const response = await app.inject({ method: "GET", url: "/api/v1/settings/installation" });
    expect(response.statusCode).toBe(200);
    await app.close();
  });

  it("refuses anyone else, so the build never reaches a session that cannot act on it", async () => {
    const app = await boot("technical");
    const response = await app.inject({ method: "GET", url: "/api/v1/settings/installation" });
    expect(response.statusCode).toBe(403);
    expect(response.body).not.toContain("abc1234");
    await app.close();
  });

  it("declares a rate limit, because an unauthenticated caller reaches the handler to be refused", async () => {
    const app = Fastify();
    const routes: { method: unknown; url: string; config?: unknown }[] = [];
    app.addHook("onRoute", (route) => {
      routes.push(route);
    });
    registerInstallationRoutes({
      app: app as unknown as ControlHubApp,
      auth,
      database: databaseFor("owner"),
      installation: { version: "0.3.0", build: "abc1234" }
    });
    await app.ready();

    // Every route, not the first one: Fastify registers a HEAD alongside each GET, so counting
    // them pins a detail of the framework instead of the thing worth holding. And the budget has
    // to be visible on the declaration itself -- CodeQL reads `config.rateLimit` at the call site
    // and does not follow a helper that returns one, which is how fifteen MCP routes ended up
    // rate limited and reported as unprotected at the same time.
    expect(routes.length).toBeGreaterThan(0);
    for (const route of routes) {
      expect(route.config, `${String(route.method)} ${route.url}`).toMatchObject({
        rateLimit: { max: expect.any(Number) }
      });
    }
    await app.close();
  });
});

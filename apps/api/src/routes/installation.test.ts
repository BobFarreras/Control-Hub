import type { UpdateCheckState } from "@control-hub/contracts/release";
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

const pending = (version: string): UpdateCheckState => ({
  checkedAt: "2026-08-27T06:00:00.000Z",
  available: { version, released: "2026-08-27T05:00:00Z", migrations: 3, configuration: true }
});

async function boot(role: "owner" | "administrator" | "technical", updateCheck?: () => Promise<UpdateCheckState>) {
  const app = Fastify();
  registerInstallationRoutes({
    app: app as unknown as ControlHubApp,
    auth,
    database: databaseFor(role),
    installation: { version: "0.3.0", build: "abc1234" },
    ...(updateCheck ? { updateCheck } : {})
  });
  await app.ready();
  return app;
}

describe("installation identity route", () => {
  it("tells an Owner which version and which build", async () => {
    const app = await boot("owner");
    const response = await app.inject({ method: "GET", url: "/api/v1/settings/installation" });
    expect(response.statusCode).toBe(200);
    // No check has run, which is a state this route has to answer for: an installation with the
    // check switched off is permanently in it.
    expect(response.json()).toEqual({ version: "0.3.0", build: "abc1234", updateCheck: null });
    await app.close();
  });

  it("passes on what the worker found, and does not go looking itself", async () => {
    const updateCheck = vi.fn().mockResolvedValue(pending("0.4.0"));
    const app = await boot("owner", updateCheck as () => Promise<UpdateCheckState>);
    const response = await app.inject({ method: "GET", url: "/api/v1/settings/installation" });

    expect(response.statusCode).toBe(200);
    // The work, not merely the number: a notice that only says «there is a new version» moves the
    // decision without giving anybody anything to decide it with.
    expect(response.json().updateCheck).toEqual({
      checkedAt: "2026-08-27T06:00:00.000Z",
      available: { version: "0.4.0", released: "2026-08-27T05:00:00Z", migrations: 3, configuration: true }
    });
    // And nothing an update could be applied from. The banner has no button, which is invariant 2
    // and not caution: the alternative wants the Docker socket.
    expect(response.body).not.toMatch(/sha256:|ghcr\.io|https?:/);
    await app.close();
  });

  it("says it looked and found nothing, which is not the same as not looking", async () => {
    const app = await boot("owner", () => Promise.resolve({ checkedAt: "2026-08-27T06:00:00.000Z", available: null }));
    const response = await app.inject({ method: "GET", url: "/api/v1/settings/installation" });
    expect(response.json().updateCheck).toEqual({ checkedAt: "2026-08-27T06:00:00.000Z", available: null });
    await app.close();
  });

  it("drops an update this installation has already applied", async () => {
    // The worker clears a pending update on its next daily pass, which leaves up to a day where
    // the stored answer names the version now running -- exactly the day somebody has just
    // updated and is looking at the screen to confirm it worked.
    for (const stale of ["0.3.0", "0.2.9"]) {
      const app = await boot("owner", () => Promise.resolve(pending(stale)));
      const response = await app.inject({ method: "GET", url: "/api/v1/settings/installation" });
      expect(response.json().updateCheck, stale).toEqual({ checkedAt: "2026-08-27T06:00:00.000Z", available: null });
      await app.close();
    }
  });

  it("tells an Administrator too, because they are who acts on an update", async () => {
    const app = await boot("administrator");
    const response = await app.inject({ method: "GET", url: "/api/v1/settings/installation" });
    expect(response.statusCode).toBe(200);
    await app.close();
  });

  it("refuses anyone else, so the build never reaches a session that cannot act on it", async () => {
    const updateCheck = vi.fn().mockResolvedValue(pending("0.4.0"));
    const app = await boot("technical", updateCheck as () => Promise<UpdateCheckState>);
    const response = await app.inject({ method: "GET", url: "/api/v1/settings/installation" });
    expect(response.statusCode).toBe(403);
    expect(response.body).not.toContain("abc1234");
    expect(response.body).not.toContain("0.4.0");
    // Refused before the state is read at all: a reader who cannot act on an update has no
    // business causing a lookup on their behalf either.
    expect(updateCheck).not.toHaveBeenCalled();
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

import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import type { ControlHubAuth } from "../auth.js";
import type { ControlHubApp } from "../server-instance.js";
import { registerSecretRoutes } from "./secrets.js";

const snapshot = {
  provider: { kind: "runtime_files" as const, health: "available" as const, checkedAt: "2026-08-26T08:00:00Z" },
  secrets: [
    {
      name: "BETTER_AUTH_SECRET",
      source: "file" as const,
      configured: true,
      consumers: ["api"],
      loadedAt: "2026-08-26T08:00:00Z",
      lastRotatedAt: null,
      version: null,
      health: "available" as const
    }
  ]
};

function databaseFor(role: "owner" | "administrator") {
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

async function boot(role: "owner" | "administrator") {
  const app = Fastify();
  registerSecretRoutes({
    app: app as unknown as ControlHubApp,
    auth,
    database: databaseFor(role),
    secretSnapshot: snapshot
  });
  await app.ready();
  return app;
}

describe("Owner secret metadata route", () => {
  it("returns only the fixed safe snapshot to an Owner", async () => {
    const app = await boot("owner");
    const response = await app.inject({ method: "GET", url: "/api/v1/settings/secrets" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(snapshot);
    expect(response.body).not.toContain("value");
    await app.close();
  });

  it("refuses an administrator even when they manage security", async () => {
    const app = await boot("administrator");
    const response = await app.inject({ method: "GET", url: "/api/v1/settings/secrets" });
    expect(response.statusCode).toBe(403);
    expect(response.body).not.toContain("BETTER_AUTH_SECRET");
    await app.close();
  });
});

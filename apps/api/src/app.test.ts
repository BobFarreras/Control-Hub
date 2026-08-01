import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";

const apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => Promise.all(apps.splice(0).map((app) => app.close())));

describe("health", () => {
  it("returns liveness without dependencies", async () => {
    const app = buildApp({ databaseUrl: "postgres://localhost:1/missing", redisUrl: "redis://localhost:1" });
    apps.push(app);
    const response = await app.inject({ method: "GET", url: "/health/live" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: "ok", service: "api" });
  });

  it("returns 503 readiness when required dependencies are unavailable", async () => {
    const app = buildApp({ databaseUrl: "postgres://localhost:1/missing", redisUrl: "redis://localhost:1" });
    apps.push(app);
    const response = await app.inject({ method: "GET", url: "/health/ready" });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      status: "not_ready",
      dependencies: { postgres: { status: "down" }, queue: { status: "down" } }
    });
  });
});

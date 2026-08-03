import type { FastifyRequest } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp, isSensitiveAuthRequest, rateLimitKey } from "./app.js";

const apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => Promise.all(apps.splice(0).map((app) => app.close())));

const unreachable = { databaseUrl: "postgres://localhost:1/missing", redisUrl: "redis://localhost:1" };
const fakeRequest = (url: string, cookie?: string, ip = "203.0.113.10") =>
  ({ url, ip, headers: cookie ? { cookie } : {} }) as unknown as FastifyRequest;

describe("health", () => {
  it("returns liveness without dependencies", async () => {
    const app = buildApp(unreachable);
    apps.push(app);
    const response = await app.inject({ method: "GET", url: "/health/live" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: "ok", service: "api" });
  });

  it("returns 503 readiness when required dependencies are unavailable", async () => {
    const app = buildApp(unreachable);
    apps.push(app);
    const response = await app.inject({ method: "GET", url: "/health/ready" });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      status: "not_ready",
      dependencies: { postgres: { status: "down" }, queue: { status: "down" } }
    });
  });
});

describe("api documentation exposure", () => {
  it("does not serve the documentation browser unless it is explicitly enabled", async () => {
    const app = buildApp(unreachable);
    apps.push(app);
    const response = await app.inject({ method: "GET", url: "/api/docs" });
    expect(response.statusCode).toBe(404);
  });

  it("serves the documentation browser when enabled", async () => {
    const app = buildApp({ ...unreachable, exposeApiDocs: true });
    apps.push(app);
    const response = await app.inject({ method: "GET", url: "/api/docs/" });
    expect(response.statusCode).toBe(200);
  });
});

describe("rate limit keys", () => {
  it("treats credential endpoints as sensitive", () => {
    expect(isSensitiveAuthRequest(fakeRequest("/api/auth/sign-in/email"))).toBe(true);
    expect(isSensitiveAuthRequest(fakeRequest("/api/auth/two-factor/verify-totp"))).toBe(true);
    expect(isSensitiveAuthRequest(fakeRequest("/api/auth/reset-password?token=abc"))).toBe(true);
  });

  it("does not treat session bookkeeping as sensitive", () => {
    expect(isSensitiveAuthRequest(fakeRequest("/api/auth/get-session"))).toBe(false);
    expect(isSensitiveAuthRequest(fakeRequest("/api/auth/sign-out"))).toBe(false);
  });

  it("gives each session its own budget so users behind the web tier do not share one", () => {
    const first = rateLimitKey(fakeRequest("/api/v1/crm/leads", "better-auth.session_token=aaa"));
    const second = rateLimitKey(fakeRequest("/api/v1/crm/leads", "better-auth.session_token=bbb"));
    expect(first).not.toBe(second);
    expect(first).toMatch(/^session:[0-9a-f]{64}$/);
  });

  it("never exposes the raw session token as a store key", () => {
    expect(rateLimitKey(fakeRequest("/api/v1/crm/leads", "better-auth.session_token=secret-token"))).not.toContain(
      "secret-token"
    );
  });

  it("keys credential endpoints on the address even when a cookie is present", () => {
    const key = rateLimitKey(fakeRequest("/api/auth/sign-in/email", "better-auth.session_token=aaa"));
    expect(key).toBe("ip:203.0.113.10");
  });

  it("falls back to the address for anonymous callers", () => {
    expect(rateLimitKey(fakeRequest("/api/v1/crm/leads"))).toBe("ip:203.0.113.10");
  });
});

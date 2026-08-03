import type { FastifyRequest } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import type { ControlHubAuth } from "./auth.js";
import { isSensitiveAuthRequest, rateLimitKey } from "./rate-limit.js";

const apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => Promise.all(apps.splice(0).map((app) => app.close())));

const unreachable = { databaseUrl: "postgres://localhost:1/missing", redisUrl: "redis://localhost:1" };
const fakeRequest = (url: string, cookie?: string, ip = "203.0.113.10") =>
  ({ url, ip, headers: cookie ? { cookie } : {} }) as unknown as FastifyRequest;

/** Registration never touches the auth instance; only handlers do. */
const stubAuth = { close: () => Promise.resolve() } as unknown as ControlHubAuth;

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

describe("route registration", () => {
  /**
   * The routers under ./routes are wired by hand in buildApp. Splitting them out of one file
   * is only safe if something notices a router that stops being registered, which a type
   * check cannot: dropping a `register...Routes` call still compiles.
   */
  const expected = [
    ["GET", "/api/auth/*"],
    ["GET", "/api/v1/me"],
    ["GET", "/api/v1/table-preferences/:tableId"],
    ["PUT", "/api/v1/table-preferences/:tableId"],
    ["GET", "/api/v1/sessions"],
    ["GET", "/api/v1/members"],
    ["PATCH", "/api/v1/members/:membershipId/role"],
    ["GET", "/api/v1/audit"],
    ["GET", "/api/v1/commerce/catalog"],
    ["POST", "/api/v1/commerce/products"],
    ["POST", "/api/v1/commerce/products/:productId/versions"],
    ["POST", "/api/v1/commerce/versions/:versionId/plans"],
    ["POST", "/api/v1/commerce/plans/:planId/prices"],
    ["GET", "/api/v1/commerce/subscriptions"],
    ["POST", "/api/v1/commerce/subscriptions"],
    ["PATCH", "/api/v1/commerce/subscriptions/:subscriptionId/status"],
    ["PATCH", "/api/v1/commerce/subscriptions/:subscriptionId/plan"],
    ["POST", "/api/v1/commerce/subscriptions/:subscriptionId/renew"],
    ["GET", "/api/v1/commerce/financial-summary"],
    ["GET", "/api/v1/commerce/renewal-alerts"],
    ["GET", "/api/v1/company-subscriptions"],
    ["POST", "/api/v1/company-subscriptions"],
    ["PATCH", "/api/v1/company-subscriptions/:subscriptionId/status"],
    ["GET", "/api/v1/invitations"],
    ["POST", "/api/v1/invitations"],
    ["DELETE", "/api/v1/invitations/:invitationId"],
    ["GET", "/api/v1/crm/leads"],
    ["POST", "/api/v1/crm/leads"],
    ["PATCH", "/api/v1/crm/leads/:leadId/status"],
    ["POST", "/api/v1/crm/leads/:leadId/convert"],
    ["GET", "/api/v1/crm/customers"],
    ["GET", "/api/v1/crm/customers/:customerId"],
    ["POST", "/api/v1/crm/customers/:customerId/contacts"],
    ["POST", "/api/v1/crm/customers/:customerId/notes"],
    ["POST", "/api/v1/crm/customers/:customerId/tasks"],
    ["POST", "/api/v1/crm/tasks/:taskId/complete"],
    ["GET", "/api/v1/crm/summary"],
    ["GET", "/api/v1/crm/leads/export"],
    ["POST", "/api/v1/crm/leads/import"],
    ["GET", "/api/v1/public/invitations"],
    ["POST", "/api/v1/public/invitations/accept"],
    ["GET", "/health/live"],
    ["GET", "/health/ready"]
  ] as const;

  it("registers every domain surface once authentication is configured", async () => {
    const app = buildApp({ ...unreachable, auth: stubAuth, invitationAuth: stubAuth, appOrigin: "http://localhost" });
    apps.push(app);
    await app.ready();
    const missing = expected.filter(([method, url]) => !app.hasRoute({ method, url }));
    expect(missing).toEqual([]);
  });

  it("exposes only the public and health surface without authentication", async () => {
    const app = buildApp(unreachable);
    apps.push(app);
    await app.ready();
    expect(app.hasRoute({ method: "GET", url: "/api/v1/public/invitations" })).toBe(true);
    expect(app.hasRoute({ method: "GET", url: "/health/live" })).toBe(true);
    expect(app.hasRoute({ method: "GET", url: "/api/v1/crm/leads" })).toBe(false);
    expect(app.hasRoute({ method: "GET", url: "/api/v1/members" })).toBe(false);
  });
});

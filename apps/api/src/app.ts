import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import Fastify, { LogController } from "fastify";
import Redis from "ioredis";
import { checkDatabase, createDatabaseClient } from "@control-hub/database";
import { createLogger } from "@control-hub/observability";
import type { LiveHealth, ReadyHealth } from "@control-hub/contracts";
import type { ControlHubAuth } from "./auth.js";
import { ApiSecurityError, requirePermission, resolveTenantContext } from "./security.js";
import { assignMemberRole, IdentityInvariantError, listAuditEvents, listMembers } from "./identity-repository.js";
import { writeAudit } from "./security.js";
import type { RoleCode } from "@control-hub/domain";

type BuildAppOptions = { databaseUrl: string; redisUrl: string; appOrigin?: string; auth?: ControlHubAuth; logLevel?: string; version?: string };

function requestHeaders(headers: Record<string, string | string[] | undefined>) {
  const result = new Headers();
  for (const [name, value] of Object.entries(headers)) if (value) result.set(name, Array.isArray(value) ? value.join(",") : value);
  return result;
}

export function buildApp(options: BuildAppOptions) {
  const logger = createLogger("control-hub-api", options.logLevel);
  const app = Fastify({ loggerInstance: logger, trustProxy: true, requestIdHeader: "x-request-id", logController: new LogController({ disableRequestLogging: true }) });
  const database = createDatabaseClient(options.databaseUrl);
  const redis = new Redis(options.redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1, enableOfflineQueue: false });
  redis.on("error", (error) => logger.warn({ err: error }, "queue connection unavailable"));

  void app.register(cors, { origin: options.appOrigin ?? false, credentials: Boolean(options.appOrigin), allowedHeaders: ["content-type", "x-control-hub-tenant", "x-request-id"] });
  void app.register(helmet, { contentSecurityPolicy: false });
  void app.register(rateLimit, { max: 120, timeWindow: "1 minute", ban: 3 });
  void app.register(swagger, { openapi: { info: { title: "Control Hub API", version: options.version ?? "0.1.0" } } });
  void app.register(swaggerUi, { routePrefix: "/api/docs" });

  app.addHook("onRequest", async (request, reply) => {
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(request.method) || !request.url.startsWith("/api/")) return;
    const origin = request.headers.origin;
    if (origin && options.appOrigin && origin !== options.appOrigin) return reply.code(403).send({ code: "ORIGIN_DENIED" });
    if (request.headers.cookie && !origin) return reply.code(403).send({ code: "ORIGIN_REQUIRED" });
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ApiSecurityError) return reply.code(error.statusCode).send({ code: error.code, requestId: request.id });
    if (error instanceof IdentityInvariantError) return reply.code(error.message === "MEMBERSHIP_NOT_FOUND" ? 404 : 409).send({ code: error.message, requestId: request.id });
    request.log.error({ err: error }, "request failed");
    return reply.code(500).send({ code: "INTERNAL_ERROR", requestId: request.id });
  });

  if (options.auth) {
    const auth = options.auth;
    app.route({ method: ["GET", "POST"], url: "/api/auth/*", config: { rateLimit: { max: 10, timeWindow: "1 minute" } }, handler: async (request, reply) => {
      const url = new URL(request.url, options.appOrigin ?? "http://localhost:3000");
      const init: RequestInit = { method: request.method, headers: requestHeaders(request.headers) };
      if (request.method !== "GET" && request.body !== undefined) init.body = JSON.stringify(request.body);
      const response = await auth.handler(new Request(url, init));
      reply.code(response.status);
      response.headers.forEach((value, name) => { if (name !== "set-cookie") reply.header(name, value); });
      const cookies = response.headers.getSetCookie();
      if (cookies.length) reply.header("set-cookie", cookies);
      return reply.send(response.body ? Buffer.from(await response.arrayBuffer()) : null);
    }});

    app.get("/api/v1/me", async (request) => ({ context: await resolveTenantContext(auth, database, request) }));
    app.get("/api/v1/sessions", async (request) => {
      await resolveTenantContext(auth, database, request);
      return { sessions: await auth.api.listSessions({ headers: requestHeaders(request.headers) }) };
    });
    app.get("/api/v1/members", async (request) => {
      const context = await resolveTenantContext(auth, database, request);
      requirePermission(context, "members:manage");
      return { members: await listMembers(database, context) };
    });
    app.patch<{ Params: { membershipId: string }; Body: { role: RoleCode } }>("/api/v1/members/:membershipId/role", { schema: { body: { type: "object", additionalProperties: false, required: ["role"], properties: { role: { type: "string", enum: ["owner", "administrator", "technical"] } } } } }, async (request) => {
      const context = await resolveTenantContext(auth, database, request); requirePermission(context, "roles:manage");
      await assignMemberRole(database, context, request.params.membershipId, request.body.role);
      await writeAudit(database, context, request, { action: "membership.role.changed", targetType: "membership", targetId: request.params.membershipId, outcome: "success", metadata: { role: request.body.role } });
      return { status: "updated" };
    });
    app.get("/api/v1/audit", async (request) => {
      const context = await resolveTenantContext(auth, database, request);
      requirePermission(context, "audit:read");
      return { events: await listAuditEvents(database, context) };
    });
  }

  app.get<{ Reply: LiveHealth }>("/health/live", { schema: { tags: ["health"] } }, async () => ({ status: "ok", service: "api", version: options.version ?? "0.1.0" }));
  app.get<{ Reply: ReadyHealth }>("/health/ready", { schema: { tags: ["health"] } }, async (_request, reply) => {
    const dependencies: ReadyHealth["dependencies"] = {}; let ready = true;
    try { dependencies.postgres = { status: "up", latencyMs: await checkDatabase(database) }; } catch { dependencies.postgres = { status: "down", latencyMs: 0 }; ready = false; }
    try { const startedAt = performance.now(); if (redis.status === "wait") await redis.connect(); await redis.ping(); dependencies.queue = { status: "up", latencyMs: Math.round(performance.now() - startedAt) }; }
    catch { dependencies.queue = { status: "down", latencyMs: 0 }; ready = false; }
    if (!ready) reply.code(503); return { status: ready ? "ready" : "not_ready", service: "api", dependencies };
  });
  app.addHook("onClose", async () => { if (redis.status === "ready") await redis.quit(); else redis.disconnect(); await database.end({ timeout: 5 }); if (options.auth) await options.auth.close(); });
  return app;
}

import {
  CommerceError,
  CommerceService,
  CompanySubscriptionError,
  CompanySubscriptionService,
  CrmError,
  CrmService,
  ProjectsError,
  ProjectsService,
  SupportError,
  SupportService
} from "@control-hub/application";
import { isFeatureEnabled, parseFeatureFlags, type FeatureFlagSet } from "@control-hub/config";
import type { LiveHealth, ReadyHealth } from "@control-hub/contracts";
import { checkDatabase, createDatabaseClient } from "@control-hub/database";
import { createMetrics } from "@control-hub/observability";
import {
  PostgresCommerceRepository,
  PostgresCompanySubscriptionRepository,
  PostgresCrmRepository,
  IdentityInvariantError,
  InvitationError,
  PostgresProjectsRepository,
  PostgresSupportRepository
} from "@control-hub/persistence";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import Redis from "ioredis";
import type { ControlHubAuth } from "./auth.js";
import type { MailSender } from "./email.js";
import { rateLimitKey } from "./rate-limit.js";
import { registerAuthProxyRoutes } from "./routes/auth-proxy.js";
import { registerCommerceRoutes } from "./routes/commerce.js";
import { registerCompanySubscriptionRoutes } from "./routes/company-subscriptions.js";
import { registerCrmRoutes } from "./routes/crm.js";
import { registerIdentityRoutes } from "./routes/identity.js";
import { registerInvitationRoutes } from "./routes/invitations.js";
import { registerProjectRoutes } from "./routes/projects.js";
import { registerPublicRoutes } from "./routes/public.js";
import { registerSupportRoutes } from "./routes/support.js";
import { ApiSecurityError } from "./security.js";
import { createServer } from "./server-instance.js";

type BuildAppOptions = {
  databaseUrl: string;
  redisUrl: string;
  appOrigin?: string;
  auth?: ControlHubAuth;
  invitationAuth?: ControlHubAuth;
  sendMail?: MailSender;
  logLevel?: string;
  version?: string;
  exposeApiDocs?: boolean;
  /** Enabled feature flags. Absent means the environment decides; see @control-hub/config. */
  featureFlags?: FeatureFlagSet;
};

/**
 * The composition root: it builds the server, wires the cross-cutting concerns that every
 * route depends on, and hands the routing itself to the modules under ./routes.
 *
 * Route handlers deliberately do not live here. When they did, this file held roughly forty
 * of them and a missing permission check was invisible in review.
 */
export function buildApp(options: BuildAppOptions) {
  const app = createServer(options);
  const database = createDatabaseClient(options.databaseUrl);
  const crm = new CrmService(new PostgresCrmRepository(database));
  const commerce = new CommerceService(new PostgresCommerceRepository(database));
  const companySubscriptions = new CompanySubscriptionService(new PostgresCompanySubscriptionRepository(database));
  const support = new SupportService(new PostgresSupportRepository(database));
  const projects = new ProjectsService(new PostgresProjectsRepository(database));
  const featureFlags = options.featureFlags ?? parseFeatureFlags(process.env.CONTROL_HUB_FLAGS);
  const redis = new Redis(options.redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1, enableOfflineQueue: false });
  redis.on("error", (error) => app.log.warn({ err: error }, "queue connection unavailable"));
  // A connection of its own: sharing the health-check client would let a slow limiter command
  // sit in front of readiness, and the limiter needs a short timeout that readiness does not.
  //
  // Unlike the queue client this one connects eagerly and keeps the offline queue. With
  // `lazyConnect` plus `enableOfflineQueue: false` every counter write was rejected before the
  // connection existed, `skipOnError` allowed the request, and the limiter silently did
  // nothing at all — worse than the in-memory store it replaced.
  const rateLimitStore = new Redis(options.redisUrl, { maxRetriesPerRequest: 1, connectTimeout: 500 });
  rateLimitStore.on("error", (error) => app.log.warn({ err: error }, "rate limit store unavailable"));

  void app.register(cors, {
    origin: options.appOrigin ?? false,
    credentials: Boolean(options.appOrigin),
    allowedHeaders: ["content-type", "x-control-hub-tenant", "x-request-id"]
  });
  void app.register(helmet, { contentSecurityPolicy: false });
  // No global `ban`: a ban on ordinary read traffic locks a user out of the whole product,
  // which is the failure this budget exists to prevent. Bans stay on the credential routes.
  //
  // Counters live in Valkey rather than in this process: in memory they reset on every deploy
  // and each replica keeps its own, so brute force protection weakened exactly as the service
  // scaled. `skipOnError` keeps the trade-off honest in the other direction: if the store is
  // unreachable the request is served rather than the product going down with its limiter.
  void app.register(rateLimit, {
    max: 300,
    timeWindow: "1 minute",
    keyGenerator: rateLimitKey,
    redis: rateLimitStore,
    nameSpace: "control-hub:rate-limit:",
    skipOnError: true
  });
  void app.register(swagger, { openapi: { info: { title: "Control Hub API", version: options.version ?? "0.1.0" } } });
  if (options.exposeApiDocs) void app.register(swaggerUi, { routePrefix: "/api/docs" });

  app.addHook("onRequest", async (request, reply) => {
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(request.method) || !request.url.startsWith("/api/")) return;
    const origin = request.headers.origin;
    if (origin && options.appOrigin && origin !== options.appOrigin)
      return reply.code(403).send({ code: "ORIGIN_DENIED" });
    if (request.headers.cookie && !origin) return reply.code(403).send({ code: "ORIGIN_REQUIRED" });
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ApiSecurityError)
      return reply.code(error.statusCode).send({ code: error.code, requestId: request.id });
    if (error instanceof IdentityInvariantError)
      return reply
        .code(error.message === "MEMBERSHIP_NOT_FOUND" ? 404 : 409)
        .send({ code: error.message, requestId: request.id });
    if (error instanceof InvitationError)
      return reply
        .code(error.message === "INVITATION_NOT_FOUND" ? 404 : 409)
        .send({ code: error.message, requestId: request.id });
    if (error instanceof CrmError) {
      const status = error.code.endsWith("NOT_FOUND")
        ? 404
        : error.code.startsWith("DUPLICATE") || error.code === "INVALID_TRANSITION"
          ? 409
          : 400;
      return reply.code(status).send({ code: error.code, requestId: request.id });
    }
    if (error instanceof CommerceError) {
      const status = error.code.endsWith("NOT_FOUND")
        ? 404
        : error.code === "DUPLICATE_CODE" || error.code === "INVALID_SUBSCRIPTION_TRANSITION"
          ? 409
          : 400;
      return reply.code(status).send({ code: error.code, requestId: request.id });
    }
    if (error instanceof SupportError) {
      const status = error.code.endsWith("NOT_FOUND")
        ? 404
        : error.code === "INVALID_TRANSITION" || error.code.startsWith("DUPLICATE") || error.code === "TICKET_CLOSED"
          ? 409
          : 400;
      return reply.code(status).send({ code: error.code, requestId: request.id });
    }
    if (error instanceof ProjectsError) {
      const status = error.code.endsWith("NOT_FOUND")
        ? 404
        : error.code === "PERMISSION_DENIED"
          ? 403
          : error.code === "FUTURE_DATE"
            ? 422
            : error.code.startsWith("DUPLICATE") ||
                error.code === "INVALID_TRANSITION" ||
                error.code === "PROJECT_CLOSED" ||
                error.code === "PROJECT_CUSTOMER_MISMATCH"
              ? 409
              : 400;
      return reply.code(status).send({ code: error.code, requestId: request.id });
    }
    if (error instanceof CompanySubscriptionError) {
      const status = error.code.endsWith("NOT_FOUND") ? 404 : error.code === "DUPLICATE_SUBSCRIPTION" ? 409 : 400;
      return reply.code(status).send({ code: error.code, requestId: request.id });
    }
    request.log.error({ err: error }, "request failed");
    return reply.code(500).send({ code: "INTERNAL_ERROR", requestId: request.id });
  });

  /**
   * Routes are declared inside `after` so that every plugin above has finished loading first.
   *
   * `app.register` defers a plugin until boot, but `app.get` fires the `onRoute` hook the
   * moment it is called. @fastify/rate-limit attaches itself to routes through exactly that
   * hook, so declaring routes directly in this function registered them before the limiter
   * existed and it silently governed nothing at all. Hooks like helmet's are unaffected,
   * which is why the omission was invisible: security headers arrived, budgets did not.
   */
  app.after(() => {
    if (options.auth) {
      const context = { app, database, auth: options.auth };
      registerAuthProxyRoutes({ ...context, appOrigin: options.appOrigin });
      registerIdentityRoutes(context);
      registerCommerceRoutes({ ...context, commerce });
      registerCompanySubscriptionRoutes({ ...context, companySubscriptions });
      registerInvitationRoutes({ ...context, appOrigin: options.appOrigin, sendMail: options.sendMail });
      registerCrmRoutes({ ...context, crm });
      registerSupportRoutes({ ...context, support });
      // Behind a flag so the schema can be deployed before the module is opened. Off, the
      // routes are never declared and the API answers 404, which is the truth: there is
      // nothing there. A flag decides what is deployed, never who may use it.
      if (isFeatureEnabled(featureFlags, "projects_and_time")) registerProjectRoutes({ ...context, projects });
    }

    registerPublicRoutes({ app, database, invitationAuth: options.invitationAuth });
    registerObservabilityRoutes();
    registerHealthRoutes();
  });

  const metrics = createMetrics("control-hub-api");
  app.addHook("onResponse", (request, reply, done) => {
    // The route pattern, not request.url: labelling by resolved path would create a new time
    // series for every customer identifier that has ever been fetched.
    const route = request.routeOptions.url ?? "unmatched";
    const labels = { method: request.method, route, status: String(reply.statusCode) };
    metrics.httpRequests.inc(labels);
    metrics.httpDuration.observe(labels, reply.elapsedTime / 1000);
    done();
  });

  /**
   * Not proxied by the web tier, which only forwards /api/* and /health/*, so this stays on
   * the internal network where Prometheus reaches it and the internet does not. It is left
   * off the OpenAPI document for the same reason.
   */
  function registerObservabilityRoutes() {
    app.get("/metrics", { schema: { hide: true } }, async (_request, reply) =>
      reply.type(metrics.registry.contentType).send(await metrics.registry.metrics())
    );
  }

  function registerHealthRoutes() {
    app.get<{ Reply: LiveHealth }>("/health/live", { schema: { tags: ["health"] } }, () => ({
      status: "ok",
      service: "api",
      version: options.version ?? "0.1.0"
    }));
    app.get<{ Reply: ReadyHealth }>("/health/ready", { schema: { tags: ["health"] } }, async (_request, reply) => {
      const dependencies: ReadyHealth["dependencies"] = {};
      let ready = true;
      try {
        dependencies.postgres = { status: "up", latencyMs: await checkDatabase(database) };
      } catch {
        dependencies.postgres = { status: "down", latencyMs: 0 };
        ready = false;
      }
      try {
        const startedAt = performance.now();
        if (redis.status === "wait") await redis.connect();
        await redis.ping();
        dependencies.queue = { status: "up", latencyMs: Math.round(performance.now() - startedAt) };
      } catch {
        dependencies.queue = { status: "down", latencyMs: 0 };
        ready = false;
      }
      if (!ready) reply.code(503);
      return { status: ready ? "ready" : "not_ready", service: "api", dependencies };
    });
  }

  app.addHook("onClose", async () => {
    for (const connection of [redis, rateLimitStore]) {
      if (connection.status === "ready") await connection.quit();
      else connection.disconnect();
    }
    await database.end({ timeout: 5 });
    if (options.auth) await options.auth.close();
    if (options.invitationAuth) await options.invitationAuth.close();
  });
  return app;
}

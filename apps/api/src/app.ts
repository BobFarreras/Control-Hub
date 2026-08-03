import {
  CommerceError,
  CommerceService,
  CompanySubscriptionError,
  CompanySubscriptionService,
  CrmError,
  CrmService
} from "@control-hub/application";
import type { LiveHealth, ReadyHealth } from "@control-hub/contracts";
import { checkDatabase, createDatabaseClient } from "@control-hub/database";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import Redis from "ioredis";
import type { ControlHubAuth } from "./auth.js";
import { PostgresCommerceRepository } from "./commerce-repository.js";
import { PostgresCompanySubscriptionRepository } from "./company-subscription-repository.js";
import { PostgresCrmRepository } from "./crm-repository.js";
import type { MailSender } from "./email.js";
import { IdentityInvariantError } from "./identity-repository.js";
import { InvitationError } from "./invitation-repository.js";
import { rateLimitKey } from "./rate-limit.js";
import { registerAuthProxyRoutes } from "./routes/auth-proxy.js";
import { registerCommerceRoutes } from "./routes/commerce.js";
import { registerCompanySubscriptionRoutes } from "./routes/company-subscriptions.js";
import { registerCrmRoutes } from "./routes/crm.js";
import { registerIdentityRoutes } from "./routes/identity.js";
import { registerInvitationRoutes } from "./routes/invitations.js";
import { registerPublicRoutes } from "./routes/public.js";
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
  const redis = new Redis(options.redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1, enableOfflineQueue: false });
  redis.on("error", (error) => app.log.warn({ err: error }, "queue connection unavailable"));

  void app.register(cors, {
    origin: options.appOrigin ?? false,
    credentials: Boolean(options.appOrigin),
    allowedHeaders: ["content-type", "x-control-hub-tenant", "x-request-id"]
  });
  void app.register(helmet, { contentSecurityPolicy: false });
  // No global `ban`: a ban on ordinary read traffic locks a user out of the whole product,
  // which is the failure this budget exists to prevent. Bans stay on the credential routes.
  void app.register(rateLimit, { max: 300, timeWindow: "1 minute", keyGenerator: rateLimitKey });
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
    if (error instanceof CompanySubscriptionError) {
      const status = error.code.endsWith("NOT_FOUND") ? 404 : error.code === "DUPLICATE_SUBSCRIPTION" ? 409 : 400;
      return reply.code(status).send({ code: error.code, requestId: request.id });
    }
    request.log.error({ err: error }, "request failed");
    return reply.code(500).send({ code: "INTERNAL_ERROR", requestId: request.id });
  });

  if (options.auth) {
    const context = { app, database, auth: options.auth };
    registerAuthProxyRoutes({ ...context, appOrigin: options.appOrigin });
    registerIdentityRoutes(context);
    registerCommerceRoutes({ ...context, commerce });
    registerCompanySubscriptionRoutes({ ...context, companySubscriptions });
    registerInvitationRoutes({ ...context, appOrigin: options.appOrigin, sendMail: options.sendMail });
    registerCrmRoutes({ ...context, crm });
  }

  registerPublicRoutes({ app, database, invitationAuth: options.invitationAuth });

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
  app.addHook("onClose", async () => {
    if (redis.status === "ready") await redis.quit();
    else redis.disconnect();
    await database.end({ timeout: 5 });
    if (options.auth) await options.auth.close();
    if (options.invitationAuth) await options.invitationAuth.close();
  });
  return app;
}

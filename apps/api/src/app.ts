import {
  AttendanceError,
  AttendanceService,
  CommerceError,
  CommerceService,
  CompanySubscriptionError,
  CompanySubscriptionService,
  ConnectorCredentialService,
  ConnectorIngressService,
  ConnectorService,
  CustomerServicesError,
  CustomerServicesService,
  CrmError,
  CrmService,
  InfrastructureService,
  ProjectsError,
  ProjectsService,
  SupportError,
  SupportService
} from "@control-hub/application";
import { isFeatureEnabled, parseFeatureFlags, type FeatureFlagSet, type KeyRing } from "@control-hub/config";
import { connectorRegistry } from "@control-hub/connectors";
import type { LiveHealth, ReadyHealth } from "@control-hub/contracts";
import { connectorQueueName } from "@control-hub/contracts/jobs";
import { checkDatabase, createDatabaseClient } from "@control-hub/database";
import { createMetrics } from "@control-hub/observability";
import {
  CredentialVault,
  PostgresAttendanceRepository,
  PostgresCommerceRepository,
  PostgresCompanySubscriptionRepository,
  PostgresConnectorRepository,
  PostgresCustomerServicesRepository,
  PostgresCrmRepository,
  IdentityInvariantError,
  nodeIngressCrypto,
  InvitationError,
  PostgresInfrastructureRepository,
  PostgresProjectsRepository,
  PostgresSupportRepository
} from "@control-hub/persistence";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { Queue } from "bullmq";
import Redis from "ioredis";
import type { ControlHubAuth } from "./auth.js";
import { createConnectorHealthCheckQueue } from "./connector-health-queue.js";
import type { MailSender } from "./email.js";
import { describeConnectorError, problemContentType, problemDetails, usesProblemDetails } from "./problem.js";
import { rateLimitKey } from "./rate-limit.js";
import { registerAttendanceRoutes } from "./routes/attendance.js";
import { registerAuthProxyRoutes } from "./routes/auth-proxy.js";
import { registerCommerceRoutes } from "./routes/commerce.js";
import { registerCompanySubscriptionRoutes } from "./routes/company-subscriptions.js";
import type { RouteContext } from "./routes/context.js";
import { registerCrmRoutes } from "./routes/crm.js";
import { registerIdentityRoutes } from "./routes/identity.js";
import { registerInfrastructureRoutes } from "./routes/infrastructure.js";
import { registerIntegrationRoutes } from "./routes/integrations.js";
import { registerInvitationRoutes } from "./routes/invitations.js";
import { registerProjectRoutes } from "./routes/projects.js";
import { registerPublicRoutes } from "./routes/public.js";
import { registerSupportRoutes } from "./routes/support.js";
import { registerWebhookRoutes } from "./routes/webhooks.js";
import { ApiSecurityError } from "./security.js";
import { createServer } from "./server-instance.js";

/**
 * BullMQ wants host, port and password rather than a URL, and it opens its own connection: the
 * clients above are busy with readiness and with rate limit counters.
 */
function queueConnection(redisUrl: string) {
  const url = new URL(redisUrl);
  return { host: url.hostname, port: Number(url.port || 6379), password: url.password || undefined };
}

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
  /**
   * The connector key ring, when this installation has one.
   *
   * Absent or null means the credential routes are not declared: there is nothing to seal a
   * secret with, and accepting one would be worse than refusing it. See ADR-0008.
   */
  connectorKeyRing?: KeyRing | null;
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
  const customerServices = new CustomerServicesService(new PostgresCustomerServicesRepository(database));
  const companySubscriptions = new CompanySubscriptionService(new PostgresCompanySubscriptionRepository(database));
  const support = new SupportService(new PostgresSupportRepository(database));
  const projects = new ProjectsService(new PostgresProjectsRepository(database));
  const attendance = new AttendanceService(new PostgresAttendanceRepository(database));
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
  /** Created only when the connector surface is declared; see registerConnectorRoutes. */
  let connectorQueue: Queue | null = null;

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
  /**
   * The document, described but never serialised from.
   *
   * No route here declares a `response` schema, and that is a decision rather than an omission:
   * in Fastify a response schema is also the serialiser, so a field missing from it disappears
   * from the answer. A document that silently edits what the API returns is worse than one that
   * describes it in prose — especially on the one route whose answer carries a secret exactly
   * once. The shapes are written out in `docs/specifications/connectors.md`.
   */
  void app.register(swagger, {
    openapi: {
      info: {
        title: "Control Hub API",
        version: options.version ?? "0.1.0",
        description: [
          "The connector surface answers errors as RFC 9457 problem details",
          "(`application/problem+json`) with a stable UPPER_SNAKE `code`; the rest of the API",
          "still answers `{ code, requestId }`. The `code` is the part both shapes share and the",
          "part a client may branch on. No response anywhere returns a credential value, and the",
          "signing secret of a webhook endpoint is returned once, by the call that mints it."
        ].join(" ")
      },
      tags: [
        { name: "connectors", description: "What this release can connect to at all." },
        { name: "integrations", description: "Instances of a connector, their state and their health." },
        { name: "credentials", description: "Sealed values. Metadata comes back; the value never does." },
        { name: "endpoints", description: "Inbound addresses. The address and its secret are shown once." },
        { name: "webhooks", description: "The public ingress. Signed by the provider, never by a session." }
      ]
    }
  });
  if (options.exposeApiDocs) void app.register(swaggerUi, { routePrefix: "/api/docs" });

  app.addHook("onRequest", async (request, reply) => {
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(request.method) || !request.url.startsWith("/api/")) return;
    // Inbound webhooks are exempt, and lose nothing by it. This check defends routes that carry
    // ambient authority — a session cookie a browser attaches on its own — and that route has
    // none: it reads no cookie and resolves no session, and a signature is the only thing that
    // gets a delivery accepted. A provider that happens to send an `Origin` would otherwise have
    // every delivery refused with a code nobody could explain.
    if (request.url.startsWith("/api/v1/webhooks/")) return;
    const origin = request.headers.origin;
    if (origin && options.appOrigin && origin !== options.appOrigin)
      return reply.code(403).send({ code: "ORIGIN_DENIED" });
    if (request.headers.cookie && !origin) return reply.code(403).send({ code: "ORIGIN_REQUIRED" });
  });

  app.setErrorHandler((error, request, reply) => {
    /**
     * The connector surface answers in RFC 9457, as `docs/specifications/errors-and-api.md`
     * requires. The routes that predate that specification keep their own envelope until somebody
     * migrates them deliberately, which is a change to every screen that reads an error and not
     * this increment's business. `code` is the same in both, which is what the UI localises.
     */
    if (usesProblemDetails(request.url)) {
      const described = describeConnectorError(error) ?? { status: 500, code: "INTERNAL_ERROR" };
      if (described.status >= 500) request.log.error({ err: error }, "request failed");
      return reply
        .code(described.status)
        .type(problemContentType)
        .send(
          problemDetails({
            ...described,
            // Without the query string: an instance identifier belongs in the path, and a
            // problem document travels into logs and support tickets.
            instance: request.url.split("?")[0] ?? request.url,
            requestId: request.id
          })
        );
    }
    if (typeof error === "object" && error !== null && "validation" in error)
      return reply.code(400).send({ code: "INVALID_INPUT", requestId: request.id });
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
        : error.code.startsWith("DUPLICATE") ||
            error.code === "INVALID_TRANSITION" ||
            error.code === "SOURCE_LEAD_NOT_AVAILABLE" ||
            error.code === "CUSTOMER_ALREADY_HAS_CONTACTS" ||
            error.code === "CUSTOMER_VERSION_CONFLICT"
          ? 409
          : 400;
      return reply.code(status).send({ code: error.code, requestId: request.id });
    }
    if (error instanceof CommerceError) {
      const status = error.code.endsWith("NOT_FOUND")
        ? 404
        : error.code === "DUPLICATE_CODE" ||
            error.code === "INVALID_SUBSCRIPTION_TRANSITION" ||
            error.code === "CONCURRENT_MODIFICATION"
          ? 409
          : 400;
      return reply.code(status).send({ code: error.code, requestId: request.id });
    }
    if (error instanceof CustomerServicesError) {
      const status = error.code.endsWith("NOT_FOUND")
        ? 404
        : error.code.endsWith("REFERENCE_INVALID") ||
            error.code.endsWith("INVALID_TRANSITION") ||
            error.code.endsWith("CONFLICT")
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
                error.code === "PROJECT_CUSTOMER_MISMATCH" ||
                error.code === "RATE_IMMUTABLE" ||
                error.code === "SERVICE_TYPE_HAS_RATES"
              ? 409
              : 400;
      return reply.code(status).send({ code: error.code, requestId: request.id });
    }
    if (error instanceof AttendanceError) {
      /**
       * `PUNCH_NOT_ALLOWED` is a conflict and not a bad request: nothing about the request is
       * malformed, it is the record that is not in a state where it can follow. A person who
       * clocked in on another device gets an answer they can act on rather than a validation
       * error about a field they never filled in.
       */
      const status = error.code.endsWith("NOT_FOUND")
        ? 404
        : error.code === "PERMISSION_DENIED"
          ? 403
          : error.code === "PUNCH_NOT_ALLOWED" ||
              error.code === "ALREADY_CORRECTED" ||
              error.code === "RECORD_IMMUTABLE" ||
              error.code.startsWith("DUPLICATE")
            ? 409
            : 400;
      return reply.code(status).send({ code: error.code, requestId: request.id });
    }
    if (error instanceof CompanySubscriptionError) {
      const status = error.code.endsWith("NOT_FOUND")
        ? 404
        : error.code.endsWith("REFERENCE_INVALID") ||
            error.code.endsWith("INVALID_TRANSITION") ||
            error.code.endsWith("CONFLICT")
          ? 409
          : 400;
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
      registerCommerceRoutes({ ...context, commerce, customerServices });
      registerCompanySubscriptionRoutes({ ...context, companySubscriptions });
      registerInvitationRoutes({ ...context, appOrigin: options.appOrigin, sendMail: options.sendMail });
      registerCrmRoutes({ ...context, crm });
      registerSupportRoutes({ ...context, support });
      // Behind a flag so the schema can be deployed before the module is opened. Off, the
      // routes are never declared and the API answers 404, which is the truth: there is
      // nothing there. A flag decides what is deployed, never who may use it.
      if (isFeatureEnabled(featureFlags, "projects_and_time")) registerProjectRoutes({ ...context, projects });
      // Off until the accountancy confirms the shape of the record is acceptable, which is a
      // conversation and not a deployment. See `docs/specifications/attendance.md`.
      if (isFeatureEnabled(featureFlags, "attendance")) registerAttendanceRoutes({ ...context, attendance });
      if (isFeatureEnabled(featureFlags, "connectors")) registerConnectorRoutes(context);
      // Reads what the connectors stored, and nothing more: the module has its own flag
      // because the schema and the code ship before anybody has an n8n to point it at.
      if (isFeatureEnabled(featureFlags, "infrastructure"))
        registerInfrastructureRoutes({
          ...context,
          infrastructure: new InfrastructureService(new PostgresInfrastructureRepository(database))
        });
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
   * The connector surface, and the one queue connection the API has.
   *
   * The queue is created here rather than beside the other clients so that an installation with
   * the flag off opens no connection for a feature it does not serve — and so the test suite,
   * which builds apps against an unreachable Valkey, never constructs one.
   *
   * A key ring is what decides whether the credential routes exist at all: with none, sealing is
   * impossible and the routes are not declared, which is what the boot warning announces.
   */
  function registerConnectorRoutes(context: RouteContext) {
    const repository = new PostgresConnectorRepository(database);
    connectorQueue = new Queue(connectorQueueName, { connection: queueConnection(options.redisUrl) });
    const keyRing = options.connectorKeyRing ?? null;
    const vault = keyRing ? new CredentialVault(keyRing) : null;
    const ingress = vault ? new ConnectorIngressService(repository, connectorRegistry, vault, nodeIngressCrypto) : null;
    registerIntegrationRoutes({
      ...context,
      connectors: new ConnectorService(repository, connectorRegistry, createConnectorHealthCheckQueue(connectorQueue)),
      credentials: vault ? new ConnectorCredentialService(repository, vault) : null,
      ingress
    });
    // The public route exists only where a signature can be verified. Without a ring there is
    // nothing to compare against, and a route that accepted deliveries it cannot authenticate
    // would be worse than no route at all.
    if (ingress) registerWebhookRoutes({ app, ingress });
  }

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
    app.get<{ Reply: ReadyHealth }>(
      "/health/ready",
      { config: { rateLimit: { max: 60, timeWindow: "1 minute" } }, schema: { tags: ["health"] } },
      async (_request, reply) => {
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
      }
    );
  }

  async function closeDependencies() {
    if (connectorQueue) await connectorQueue.close();
    for (const connection of [redis, rateLimitStore]) {
      if (connection.status === "ready") await connection.quit();
      else connection.disconnect();
    }
    await database.end({ timeout: 5 });
    if (options.auth) await options.auth.close();
    if (options.invitationAuth) await options.invitationAuth.close();
  }

  // Fastify invokes this lifecycle hook only while shutting the process down. It is not an HTTP
  // handler and therefore has no request stream to rate-limit; CodeQL otherwise models the
  // second argument of addHook as if every hook were an externally reachable route.
  // codeql[js/missing-rate-limiting]
  app.addHook("onClose", closeDependencies);
  return app;
}

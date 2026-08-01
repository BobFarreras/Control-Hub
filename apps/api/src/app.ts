import cors from "@fastify/cors";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import Fastify, { LogController } from "fastify";
import Redis from "ioredis";
import { checkDatabase, createDatabaseClient } from "@control-hub/database";
import { createLogger } from "@control-hub/observability";
import type { LiveHealth, ReadyHealth } from "@control-hub/contracts";

type BuildAppOptions = { databaseUrl: string; redisUrl: string; logLevel?: string; version?: string };

export function buildApp(options: BuildAppOptions) {
  const logger = createLogger("control-hub-api", options.logLevel);
  const app = Fastify({ loggerInstance: logger, trustProxy: true, requestIdHeader: "x-request-id", logController: new LogController({ disableRequestLogging: true }) });
  const database = createDatabaseClient(options.databaseUrl);
  const redis = new Redis(options.redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1, enableOfflineQueue: false });
  redis.on("error", (error) => logger.warn({ err: error }, "queue connection unavailable"));

  void app.register(cors, { origin: false });
  void app.register(swagger, { openapi: { info: { title: "Control Hub API", version: options.version ?? "0.1.0" } } });
  void app.register(swaggerUi, { routePrefix: "/api/docs" });

  app.get<{ Reply: LiveHealth }>("/health/live", { schema: { tags: ["health"] } }, async () => ({ status: "ok", service: "api", version: options.version ?? "0.1.0" }));

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
  });
  return app;
}

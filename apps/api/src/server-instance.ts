import { createLogger } from "@control-hub/observability";
import Fastify, { LogController } from "fastify";

/**
 * Creating the instance lives here so its exact type can be shared.
 *
 * Passing our own pino logger makes the instance type diverge from the default
 * `FastifyInstance`, so routers that accept an app need this type rather than the generic
 * one. Keeping it in its own module also avoids a cycle between app.ts and ./routes.
 */
export function createServer(options: { logLevel?: string }) {
  return Fastify({
    loggerInstance: createLogger("control-hub-api", options.logLevel),
    trustProxy: true,
    requestIdHeader: "x-request-id",
    logController: new LogController({ disableRequestLogging: true })
  });
}

export type ControlHubApp = ReturnType<typeof createServer>;

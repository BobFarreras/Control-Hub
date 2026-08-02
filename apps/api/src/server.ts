import { parseApiEnvironment } from "@control-hub/config";
import { buildApp } from "./app.js";
import { createAuth } from "./auth.js";

const environment = parseApiEnvironment(process.env);
const app = buildApp({ databaseUrl: environment.DATABASE_URL, redisUrl: environment.REDIS_URL, appOrigin: environment.APP_ORIGIN, auth: createAuth(environment), logLevel: environment.LOG_LEVEL });

const shutdown = async (signal: string) => {
  app.log.info({ signal }, "shutdown requested");
  await app.close();
  process.exit(0);
};
process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

await app.listen({ host: environment.API_HOST, port: environment.API_PORT });

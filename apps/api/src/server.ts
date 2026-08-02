import { parseApiEnvironment } from "@control-hub/config";
import { buildApp } from "./app.js";
import { createAuth } from "./auth.js";
import { createMailSender } from "./email.js";

const environment = parseApiEnvironment(process.env);
const sendMail = createMailSender({ host: environment.SMTP_HOST, port: environment.SMTP_PORT, secure: environment.SMTP_SECURE, from: environment.SMTP_FROM });
const app = buildApp({ databaseUrl: environment.DATABASE_URL, redisUrl: environment.REDIS_URL, appOrigin: environment.APP_ORIGIN, auth: createAuth(environment), invitationAuth: createAuth(environment, { allowSignUp: true }), sendMail, logLevel: environment.LOG_LEVEL });

const shutdown = async (signal: string) => {
  app.log.info({ signal }, "shutdown requested");
  await app.close();
  process.exit(0);
};
process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

await app.listen({ host: environment.API_HOST, port: environment.API_PORT });

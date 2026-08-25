import {
  connectorKeyRingWarning,
  mcpIssuerWarning,
  parseApiEnvironment,
  parseFeatureFlags,
  unknownFeatureFlags
} from "@control-hub/config";
import { buildApp } from "./app.js";
import { createAuth } from "./auth.js";
import { createMailSender } from "./email.js";

const environment = parseApiEnvironment(process.env);
const sendMail = createMailSender({
  host: environment.SMTP_HOST,
  port: environment.SMTP_PORT,
  secure: environment.SMTP_SECURE,
  from: environment.SMTP_FROM
});
const app = buildApp({
  databaseUrl: environment.DATABASE_URL,
  redisUrl: environment.REDIS_URL,
  appOrigin: environment.APP_ORIGIN,
  auth: createAuth(environment),
  invitationAuth: createAuth(environment, { allowSignUp: true }),
  sendMail,
  logLevel: environment.LOG_LEVEL,
  exposeApiDocs: environment.NODE_ENV !== "production",
  featureFlags: parseFeatureFlags(environment.CONTROL_HUB_FLAGS),
  connectorKeyRing: environment.connectorKeyRing,
  connectorEgressAllowlist: environment.connectorEgressAllowlist,
  oauthClientIds: environment.oauthClientIds,
  mcpIssuer: environment.MCP_ISSUER
});

// A flag name nobody declared is a typo that would otherwise be indistinguishable from a
// capability that is simply off, and somebody would spend an afternoon on it.
const unknown = unknownFeatureFlags(environment.CONTROL_HUB_FLAGS);
if (unknown.length > 0) app.log.warn({ unknown }, "ignoring feature flags that are not declared");

// Connectors without a key ring: the API serves everything else, and says once why the
// credential routes are not there, rather than failing when somebody first tries to save one.
const keyRingWarning = connectorKeyRingWarning(environment);
if (keyRingWarning) app.log.warn(keyRingWarning);

// Same shape, same reason: MCP on with nothing to call this server means the routes are not
// declared, and that is worth one line at boot rather than a 404 nobody can explain later.
const issuerWarning = mcpIssuerWarning(environment);
if (issuerWarning) app.log.warn(issuerWarning);

const shutdown = async (signal: string) => {
  app.log.info({ signal }, "shutdown requested");
  await app.close();
  process.exit(0);
};
process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

await app.listen({ host: environment.API_HOST, port: environment.API_PORT });

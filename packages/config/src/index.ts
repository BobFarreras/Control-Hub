import { z } from "zod";

const baseSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  DATABASE_URL: z.url().startsWith("postgres"),
  REDIS_URL: z.url().startsWith("redis"),
  APP_ORIGIN: z.url().default("http://localhost:3001"),
  BETTER_AUTH_SECRET: z.string().min(32),
  SMTP_HOST: z.string().min(1).default("127.0.0.1"),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(1025),
  SMTP_SECURE: z.stringbool().default(false),
  SMTP_FROM: z.email().default("control-hub@localhost.test"),
  WEBAUTHN_RP_ID: z.string().min(1).default("localhost"),
  WEBAUTHN_ORIGIN: z.url().default("http://localhost:3001")
});

export const apiEnvironmentSchema = baseSchema.extend({
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  API_HOST: z.string().min(1).default("127.0.0.1")
});

export const workerEnvironmentSchema = baseSchema;
export type ApiEnvironment = z.infer<typeof apiEnvironmentSchema>;
export type WorkerEnvironment = z.infer<typeof workerEnvironmentSchema>;

export function parseApiEnvironment(source: NodeJS.ProcessEnv): ApiEnvironment {
  return apiEnvironmentSchema.parse(source);
}

export function parseWorkerEnvironment(source: NodeJS.ProcessEnv): WorkerEnvironment {
  return workerEnvironmentSchema.parse(source);
}

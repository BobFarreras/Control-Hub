import pino, { type LoggerOptions } from "pino";

const redact: NonNullable<LoggerOptions["redact"]> = {
  paths: [
    "req.headers.authorization",
    "req.headers.cookie",
    "password",
    "token",
    "secret",
    "credential",
    "*.password",
    "*.token",
    "*.secret"
  ],
  censor: "[REDACTED]"
};

export function createLogger(service: string, level = "info") {
  return pino({ name: service, level, redact, base: { service } });
}

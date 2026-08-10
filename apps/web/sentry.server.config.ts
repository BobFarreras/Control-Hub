import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.SENTRY_DSN,

  /**
   * Enabled in all environments for testing.
   * TODO: Change to `process.env.NODE_ENV === "production"` before deploying to VPS.
   */
  enabled: true,

  /**
   * Percentage of transactions to trace.
   * Server-side traces are more valuable; consider raising if needed.
   */
  tracesSampleRate: 0.1,

  /**
   * Don't send PII by default.
   */
  sendDefaultPii: false
});

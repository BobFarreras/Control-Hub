import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.SENTRY_DSN,

  /**
   * Only enable in production. Development errors stay in the console.
   */
  enabled: process.env.NODE_ENV === "production",

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

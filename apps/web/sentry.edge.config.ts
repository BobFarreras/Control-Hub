import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.SENTRY_DSN,

  /**
   * Enabled in all environments for testing.
   * TODO: Change to `process.env.NODE_ENV === "production"` before deploying to VPS.
   */
  enabled: true,

  /**
   * Edge runtime is lightweight; trace only critical paths.
   */
  tracesSampleRate: 0.1,

  sendDefaultPii: false
});

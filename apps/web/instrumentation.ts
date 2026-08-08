import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      /**
       * Enabled in all environments for testing.
       * TODO: Change to `process.env.NODE_ENV === "production"` before deploying to VPS.
       */
      enabled: true,
      tracesSampleRate: 0.1
    });
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      /**
       * Enabled in all environments for testing.
       * TODO: Change to `process.env.NODE_ENV === "production"` before deploying to VPS.
       */
      enabled: true,
      tracesSampleRate: 0.1
    });
  }
}

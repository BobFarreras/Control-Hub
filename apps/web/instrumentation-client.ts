import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  /**
   * Enabled in all environments for testing.
   * TODO: Change to `process.env.NODE_ENV === "production"` before deploying to VPS.
   */
  enabled: true,

  tracesSampleRate: 0.1,

  /**
   * Set this to the Vercel or production URL if deploying outside Vercel.
   * For local development, this is not used.
   */
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 1.0
});

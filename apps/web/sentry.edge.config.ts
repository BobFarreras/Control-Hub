import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.SENTRY_DSN,

  /**
   * Only enable in production.
   */
  enabled: process.env.NODE_ENV === "production",

  /**
   * Edge runtime is lightweight; trace only critical paths.
   */
  tracesSampleRate: 0.1,

  sendDefaultPii: false
});

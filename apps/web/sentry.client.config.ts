import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  /**
   * Adjust this value in production, or use `beforeSendSampled` to control sample rate.
   *
   * Sentry recommends disabling in development to avoid noise and cost.
   * The `enabled` flag checks NODE_ENV so local dev never sends events.
   */
  enabled: process.env.NODE_ENV === "production",

  /**
   * Percentage of transactions to trace.
   * 0.0 = no performance monitoring, 1.0 = trace everything.
   * Start low in production; raise if needed.
   */
  tracesSampleRate: 0.1,

  /**
   * Set `tracePropagationTargets` to control for which URLs distributed tracing
   * should be enabled. This is typically the API origin.
   */
  tracePropagationTargets: ["localhost", /^\//],

  /**
   * Automatically instrument Next.js routing and React component rendering.
   */
  autoSessionTracking: true,

  /**
   * Don't send PII (personally identifiable information) by default.
   * User ID is set via `setUser` when the session is established.
   */
  sendDefaultPii: false
});

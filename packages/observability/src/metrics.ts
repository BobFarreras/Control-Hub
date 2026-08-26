import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from "prom-client";

/**
 * Numbers a scrape can read, alongside the logs.
 *
 * Logs answer "what happened in this request". They cannot answer "is latency drifting" or
 * "how close is the event loop to saturation", which is what an operator needs before a
 * service falls over rather than after. Phase 7 scrapes the VPS and its services with
 * Prometheus, so Control Hub exposes itself in the same shape as everything it will watch.
 *
 * Labels stay deliberately low in cardinality: the HTTP metrics carry the route pattern, never
 * the resolved path, because one label per customer identifier would multiply every series by
 * the size of the database.
 */
export type ServiceMetrics = {
  registry: Registry;
  httpRequests: Counter<"method" | "route" | "status">;
  httpDuration: Histogram<"method" | "route" | "status">;
  secretConfigured: Gauge<"secret" | "source" | "health">;
  secretLoadedTimestamp: Gauge<"secret">;
  secretRotatedTimestamp: Gauge<"secret">;
};

export function createMetrics(service: string): ServiceMetrics {
  const registry = new Registry();
  registry.setDefaultLabels({ service });
  collectDefaultMetrics({ register: registry });

  const httpRequests = new Counter({
    name: "http_requests_total",
    help: "Requests served, by method, route pattern and response status.",
    labelNames: ["method", "route", "status"] as const,
    registers: [registry]
  });

  const httpDuration = new Histogram({
    name: "http_request_duration_seconds",
    help: "Time to serve a request, by method, route pattern and response status.",
    labelNames: ["method", "route", "status"] as const,
    // Bucketed around what this product actually does: most reads are tens of milliseconds,
    // and anything past a couple of seconds is already a complaint.
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [registry]
  });

  const secretConfigured = new Gauge({
    name: "platform_secret_configured",
    help: "Whether a fixed platform-secret class was observed as configured at API boot.",
    labelNames: ["secret", "source", "health"] as const,
    registers: [registry]
  });
  const secretLoadedTimestamp = new Gauge({
    name: "platform_secret_last_loaded_timestamp_seconds",
    help: "Unix timestamp when a fixed platform-secret class was last loaded by the API.",
    labelNames: ["secret"] as const,
    registers: [registry]
  });
  const secretRotatedTimestamp = new Gauge({
    name: "platform_secret_last_rotated_timestamp_seconds",
    help: "Unix timestamp of the last evidenced rotation; absent when no safe evidence is available.",
    labelNames: ["secret"] as const,
    registers: [registry]
  });

  return {
    registry,
    httpRequests,
    httpDuration,
    secretConfigured,
    secretLoadedTimestamp,
    secretRotatedTimestamp
  };
}

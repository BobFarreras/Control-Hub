import { collectDefaultMetrics, Counter, Histogram, Registry } from "prom-client";

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

  return { registry, httpRequests, httpDuration };
}

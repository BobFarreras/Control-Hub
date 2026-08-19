import { genericWebhook } from "./built-in/generic-webhook.js";
import { n8n } from "./built-in/n8n.js";
import { prometheus } from "./built-in/prometheus.js";
import { createConnectorRegistry } from "./registry.js";

export * from "./contract.js";
export * from "./registry.js";
export { genericWebhook, type GenericWebhookConfig } from "./built-in/generic-webhook.js";
export { n8n, n8nApiVersion, type N8nConfig } from "./built-in/n8n.js";
export { prometheus, prometheusApiVersion, type PrometheusConfig } from "./built-in/prometheus.js";

/**
 * What this installation ships. Adding a provider means adding it here and cutting a release,
 * which ADR-0004 prefers to loading plugins nobody reviewed.
 */
export const connectorRegistry = createConnectorRegistry([genericWebhook, n8n, prometheus]);

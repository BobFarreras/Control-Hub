import { anthropic } from "./built-in/anthropic.js";
import { genericWebhook } from "./built-in/generic-webhook.js";
import { n8n } from "./built-in/n8n.js";
import { openAi } from "./built-in/openai.js";
import { prometheus } from "./built-in/prometheus.js";
import { vercel } from "./built-in/vercel.js";
import { createConnectorRegistry } from "./registry.js";

export * from "./contract.js";
export * from "./registry.js";
export { anthropic, anthropicUsageApiVersion, type AnthropicConfig } from "./built-in/anthropic.js";
export { genericWebhook, type GenericWebhookConfig } from "./built-in/generic-webhook.js";
export { n8n, n8nApiVersion, type N8nConfig } from "./built-in/n8n.js";
export { openAi, openAiUsageApiVersion, type OpenAiConfig } from "./built-in/openai.js";
export { prometheus, prometheusApiVersion, type PrometheusConfig } from "./built-in/prometheus.js";
export { vercel, vercelApiVersion, type VercelConfig } from "./built-in/vercel.js";

/**
 * What this installation ships. Adding a provider means adding it here and cutting a release,
 * which ADR-0004 prefers to loading plugins nobody reviewed.
 */
export const connectorRegistry = createConnectorRegistry([anthropic, genericWebhook, n8n, openAi, prometheus, vercel]);

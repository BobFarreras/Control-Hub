import { genericWebhook } from "./built-in/generic-webhook.js";
import { createConnectorRegistry } from "./registry.js";

export * from "./contract.js";
export * from "./registry.js";
export { genericWebhook, type GenericWebhookConfig } from "./built-in/generic-webhook.js";

/**
 * What this installation ships. Adding a provider means adding it here and cutting a release,
 * which ADR-0004 prefers to loading plugins nobody reviewed.
 */
export const connectorRegistry = createConnectorRegistry([genericWebhook]);

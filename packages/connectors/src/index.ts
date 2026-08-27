import { anthropic } from "./built-in/anthropic.js";
import { genericWebhook } from "./built-in/generic-webhook.js";
import { gmail } from "./built-in/gmail.js";
import { imap } from "./built-in/imap.js";
import { microsoftGraphMail } from "./built-in/microsoft-graph-mail.js";
import { n8n } from "./built-in/n8n.js";
import { openAi } from "./built-in/openai.js";
import { openCode } from "./built-in/opencode.js";
import { prometheus } from "./built-in/prometheus.js";
import { supabase } from "./built-in/supabase.js";
import { vercel } from "./built-in/vercel.js";
import { createConnectorRegistry } from "./registry.js";

export * from "./contract.js";
export * from "./registry.js";
export { anthropic, anthropicUsageApiVersion, type AnthropicConfig } from "./built-in/anthropic.js";
export { genericWebhook, type GenericWebhookConfig } from "./built-in/generic-webhook.js";
export { imap, type ImapConfig } from "./built-in/imap.js";
export { gmail } from "./built-in/gmail.js";
export { microsoftGraphMail } from "./built-in/microsoft-graph-mail.js";
export { n8n, n8nApiVersion, type N8nConfig } from "./built-in/n8n.js";
export { openAi, openAiUsageApiVersion, type OpenAiConfig } from "./built-in/openai.js";
export { openCode, type OpenCodeCollectorPayload, type OpenCodeConfig } from "./built-in/opencode.js";
export { prometheus, prometheusApiVersion, type PrometheusConfig } from "./built-in/prometheus.js";
export { supabase, supabaseApiVersion, type SupabaseConfig } from "./built-in/supabase.js";
export { vercel, vercelApiVersion, type VercelConfig } from "./built-in/vercel.js";

/**
 * What this installation ships. Adding a provider means adding it here and cutting a release,
 * which ADR-0004 prefers to loading plugins nobody reviewed.
 */
export const connectorRegistry = createConnectorRegistry([
  anthropic,
  genericWebhook,
  gmail,
  imap,
  microsoftGraphMail,
  n8n,
  openAi,
  openCode,
  prometheus,
  supabase,
  vercel
]);

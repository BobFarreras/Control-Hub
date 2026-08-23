import { createHash } from "node:crypto";
import { z } from "zod";
import {
  ConnectorError,
  connectorContractVersion,
  defineConnector,
  failureForStatus,
  type ConnectorContext,
  type ConnectorRecord,
  type HttpResponse,
  type OperationResult
} from "../contract.js";

export const anthropicUsageApiVersion = "admin usage API 2023-06-01";
const configSchema = z.strictObject({
  baseUrl: z.literal("https://api.anthropic.com").default("https://api.anthropic.com"),
  lookbackDays: z.number().int().min(1).max(31).default(2),
  workspaceIds: z.array(z.string().min(1).max(160)).max(100).default([])
});
export type AnthropicConfig = z.infer<typeof configSchema>;
const rowSchema = z.object({
  uncached_input_tokens: z.number().int().nonnegative().default(0),
  cache_creation: z
    .object({
      ephemeral_1h_input_tokens: z.number().int().nonnegative().default(0),
      ephemeral_5m_input_tokens: z.number().int().nonnegative().default(0)
    })
    .default({ ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: 0 }),
  cache_read_input_tokens: z.number().int().nonnegative().default(0),
  output_tokens: z.number().int().nonnegative().default(0),
  server_tool_use: z
    .object({ web_search_requests: z.number().int().nonnegative().default(0) })
    .default({ web_search_requests: 0 }),
  workspace_id: z.string().max(160).nullish(),
  model: z.string().min(1).max(160).nullish(),
  service_tier: z.string().max(80).nullish(),
  context_window: z.string().max(40).nullish()
});
const pageSchema = z.object({
  data: z
    .array(
      z.object({
        starting_at: z.iso.datetime({ offset: true }),
        ending_at: z.iso.datetime({ offset: true }),
        results: z.array(rowSchema).max(500)
      })
    )
    .max(31),
  has_more: z.boolean(),
  next_page: z.string().min(1).max(2048).nullish()
});
function parse(response: HttpResponse): z.infer<typeof pageSchema> {
  let body: unknown;
  try {
    body = JSON.parse(response.body);
  } catch {
    throw new ConnectorError("INVALID_RESPONSE");
  }
  const parsed = pageSchema.safeParse(body);
  if (!parsed.success) throw new ConnectorError("INVALID_RESPONSE");
  return parsed.data;
}
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 32);
function records(startingAt: string, row: z.infer<typeof rowSchema>): ConnectorRecord[] {
  const model = row.model ?? "unknown";
  const dimension = {
    workspace: row.workspace_id ?? null,
    model,
    tier: row.service_tier ?? null,
    context: row.context_window ?? null
  };
  const values = [
    ["input", "input_token", "uncached", row.uncached_input_tokens],
    ["cache_write_5m", "input_token", "cached", row.cache_creation.ephemeral_5m_input_tokens],
    ["cache_write_1h", "input_token", "cached", row.cache_creation.ephemeral_1h_input_tokens],
    ["cache_read", "cached_input_token", "cached", row.cache_read_input_tokens],
    ["output", "output_token", "output", row.output_tokens],
    ["web_search", "request", "total", row.server_tool_use.web_search_requests]
  ] as const;
  return values
    .filter(([, , , quantity]) => quantity > 0)
    .map(([kind, unit, qualifier, quantity]) => ({
      externalId: `anthropic:message:${Date.parse(startingAt)}:${hash({ ...dimension, kind })}`,
      data: {
        provider: "anthropic",
        apiVersion: anthropicUsageApiVersion,
        workspaceId: dimension.workspace,
        serviceTier: dimension.tier,
        contextWindow: dimension.context,
        usage: {
          occurredAt: startingAt,
          sku: `${model}:${kind}`,
          status: "observed",
          quantities: [{ unit, qualifier, quantity: String(quantity) }]
        }
      }
    }));
}
async function request(context: ConnectorContext<AnthropicConfig>, page: string | null, startingAt: string) {
  const url = new URL("/v1/organizations/usage_report/messages", context.config.baseUrl);
  url.searchParams.set("starting_at", startingAt);
  url.searchParams.set("bucket_width", "1d");
  url.searchParams.set("limit", "31");
  for (const group of ["workspace_id", "model", "service_tier", "context_window"])
    url.searchParams.append("group_by[]", group);
  for (const id of context.config.workspaceIds) url.searchParams.append("workspace_ids[]", id);
  if (page) url.searchParams.set("page", page);
  const key = await context.secrets.open("admin_api_key");
  const response = await context.http.send({
    method: "GET",
    url: url.toString(),
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", accept: "application/json" }
  });
  const failure = failureForStatus(response.status);
  if (failure) throw new ConnectorError(failure.toUpperCase());
  return parse(response);
}
async function pullUsage(context: ConnectorContext<AnthropicConfig>): Promise<OperationResult> {
  const startingAt = new Date(context.clock.now().getTime() - context.config.lookbackDays * 86_400_000).toISOString();
  const output: ConnectorRecord[] = [];
  let page: string | null = null;
  for (let count = 0; count < 20; count += 1) {
    const response = await request(context, page, startingAt);
    for (const bucket of response.data)
      for (const row of bucket.results) output.push(...records(bucket.starting_at, row));
    if (!response.has_more) return { records: output, cursor: null };
    if (!response.next_page || response.next_page === page) throw new ConnectorError("INVALID_RESPONSE");
    page = response.next_page;
  }
  throw new ConnectorError("PAGE_LIMIT_EXCEEDED");
}
export const anthropic = defineConnector({
  type: "anthropic",
  contractVersion: connectorContractVersion,
  configSchema,
  configFields: [
    { name: "baseUrl", kind: "url", group: "connection" },
    { name: "lookbackDays", kind: "number", group: "behaviour" },
    { name: "workspaceIds", kind: "list", group: "behaviour" }
  ],
  credentialKinds: ["admin_api_key"],
  capabilities: {
    egress: { schemes: ["https"], destination: "configured_base_url" },
    operations: { pull_usage: { shape: "event", everySeconds: 3_600 } },
    ingress: false
  },
  health: async (context) => {
    try {
      await request(context, null, new Date(context.clock.now().getTime() - 86_400_000).toISOString());
      return { status: "ok" };
    } catch (error) {
      const code = error instanceof ConnectorError ? error.code.toLowerCase() : "invalid_response";
      return {
        status: "failed",
        failure:
          code === "unauthorized" ? "unauthorized" : code === "rate_limited" ? "rate_limited" : "invalid_response"
      };
    }
  },
  operations: { pull_usage: pullUsage }
});

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

export const openAiUsageApiVersion = "organization usage API 2020-10-01";

const configSchema = z.strictObject({
  baseUrl: z.literal("https://api.openai.com").default("https://api.openai.com"),
  lookbackDays: z.number().int().min(1).max(31).default(2),
  projectIds: z.array(z.string().min(1).max(160)).max(100).default([])
});
export type OpenAiConfig = z.infer<typeof configSchema>;

const resultSchema = z.object({
  input_tokens: z.number().int().nonnegative().default(0),
  output_tokens: z.number().int().nonnegative().default(0),
  input_cached_tokens: z.number().int().nonnegative().default(0),
  num_model_requests: z.number().int().nonnegative().default(0),
  project_id: z.string().max(160).nullish(),
  model: z.string().min(1).max(160).nullish(),
  batch: z.boolean().nullish(),
  service_tier: z.string().max(80).nullish()
});
const pageSchema = z.object({
  data: z
    .array(
      z.object({
        start_time: z.number().int().nonnegative(),
        end_time: z.number().int().positive(),
        results: z.array(resultSchema).max(500)
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

const stableId = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 32);

function record(bucket: { start_time: number; end_time: number }, row: z.infer<typeof resultSchema>): ConnectorRecord {
  const dimensions = {
    projectId: row.project_id ?? null,
    model: row.model ?? "unknown",
    batch: row.batch ?? null,
    serviceTier: row.service_tier ?? null
  };
  return {
    externalId: `openai:completion:${bucket.start_time}:${stableId(dimensions)}`,
    data: {
      provider: "openai",
      apiVersion: openAiUsageApiVersion,
      projectId: dimensions.projectId,
      batch: dimensions.batch,
      serviceTier: dimensions.serviceTier,
      usage: {
        occurredAt: new Date(bucket.start_time * 1000).toISOString(),
        sku: dimensions.model,
        status: "observed",
        quantities: [
          { unit: "input_token", qualifier: "uncached", quantity: String(row.input_tokens) },
          { unit: "cached_input_token", qualifier: "cached", quantity: String(row.input_cached_tokens) },
          { unit: "output_token", qualifier: "output", quantity: String(row.output_tokens) },
          { unit: "request", qualifier: "total", quantity: String(row.num_model_requests) }
        ]
      }
    }
  };
}

async function request(context: ConnectorContext<OpenAiConfig>, page: string | null, startTime: number) {
  const url = new URL("/v1/organization/usage/completions", context.config.baseUrl);
  url.searchParams.set("start_time", String(startTime));
  url.searchParams.set("bucket_width", "1d");
  url.searchParams.set("limit", "31");
  for (const group of ["project_id", "model", "batch", "service_tier"]) url.searchParams.append("group_by[]", group);
  for (const projectId of context.config.projectIds) url.searchParams.append("project_ids[]", projectId);
  if (page) url.searchParams.set("page", page);
  const token = await context.secrets.open("admin_api_key");
  const response = await context.http.send({
    method: "GET",
    url: url.toString(),
    headers: { authorization: `Bearer ${token}`, accept: "application/json" }
  });
  const failure = failureForStatus(response.status);
  if (failure) throw new ConnectorError(failure.toUpperCase());
  return parse(response);
}

async function pullUsage(context: ConnectorContext<OpenAiConfig>): Promise<OperationResult> {
  const startTime = Math.floor(context.clock.now().getTime() / 1000) - context.config.lookbackDays * 86_400;
  const records: ConnectorRecord[] = [];
  let page: string | null = null;
  for (let count = 0; count < 20; count += 1) {
    const response = await request(context, page, startTime);
    for (const bucket of response.data) for (const row of bucket.results) records.push(record(bucket, row));
    if (!response.has_more) return { records, cursor: null };
    if (!response.next_page || response.next_page === page) throw new ConnectorError("INVALID_RESPONSE");
    page = response.next_page;
  }
  throw new ConnectorError("PAGE_LIMIT_EXCEEDED");
}

export const openAi = defineConnector({
  type: "openai",
  contractVersion: connectorContractVersion,
  configSchema,
  configFields: [
    { name: "baseUrl", kind: "url", group: "connection" },
    { name: "lookbackDays", kind: "number", group: "behaviour" },
    { name: "projectIds", kind: "list", group: "behaviour" }
  ],
  credentialKinds: ["admin_api_key"],
  capabilities: {
    egress: { schemes: ["https"], destination: "configured_base_url" },
    operations: { pull_usage: { shape: "event", everySeconds: 3_600 } },
    ingress: false
  },
  health: async (context) => {
    try {
      await request(context, null, Math.floor(context.clock.now().getTime() / 1000) - 86_400);
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

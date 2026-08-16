import { z } from "zod";
import {
  ConnectorError,
  connectorContractVersion,
  defineConnector,
  failureForStatus,
  type ConnectorContext,
  type ConnectorRecord,
  type HttpResponse,
  type IngressRequest,
  type IngressResult,
  type OperationResult,
  type RecordValue
} from "../contract.js";

/**
 * n8n: the workflows an installation has, and the executions that failed.
 *
 * This connector is the only place in the system that knows anything about n8n. The queue, the
 * schedule, the record store, the credential vault and the guarded fetch are all agnostic; what
 * lives here is the provider-specific part -- the endpoint names, the header the token goes in,
 * and the shape of what comes back.
 *
 * Two rules shape the code more than anything else:
 *
 * **We take a projection, never the payload.** An n8n workflow carries its nodes, and node
 * parameters routinely hold API keys, connection strings and customer data that somebody typed
 * into the editor. An execution carries the items that flowed through it. Storing either would
 * turn Control Hub into a copy of every secret in every workflow of every client. So each schema
 * below names the handful of fields we keep, and the parser drops the rest before the record is
 * built -- refusing by construction rather than by remembering to strip.
 *
 * **The token is a header and nothing else.** It is opened inside the call that needs it and
 * never reaches a URL, a record, a log or an error. Acceptance criterion 2 of the phase 7.1
 * specification, and the tests walk every request to prove it.
 *
 * Specification: `docs/specifications/infrastructure.md`, section "Els connectors".
 */

/**
 * The API these shapes were written against.
 *
 * The public API is versioned as `v1` in the path, but its payloads have gained fields across
 * n8n releases -- `isArchived` is recent, and older instances do not send it. The parsers below
 * tolerate that in the only direction that is safe: a missing optional field takes a default, an
 * unexpected field is dropped. When the VPS moves to a version that renames something, the
 * contract test is what will say so.
 */
export const n8nApiVersion = "public API v1";

/** n8n identifies workflows with a string and executions with a number. Both arrive as ids. */
const identifier = z.union([z.string().min(1).max(200), z.number().int()]).transform(String);

const configSchema = z.strictObject({
  /**
   * The instance root, for example `https://n8n.example.com`. Plain `http` is allowed because a
   * self-hosted n8n on the operator's own host often has no TLS of its own -- but it is only
   * reachable at all if the operator named it in `CONNECTOR_INTERNAL_ALLOWLIST`, and the guard
   * confines the instance to this base on top of that. A tenant cannot widen either.
   */
  baseUrl: z
    .url()
    .max(2048)
    .refine((value) => {
      const url = new URL(value);
      // Credentials embedded in the base would be a second, unsealed way to authenticate, and
      // they would travel in every log line that ever prints a URL.
      return (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password;
    }, "unsupported_base_url"),
  /** Archived workflows are still returned by the API; most installations do not want them. */
  includeArchived: z.boolean().default(false),
  /**
   * How far back a first pass looks. It bounds the very first read of an instance that has years
   * of history: after that the watermark takes over and the window never applies again.
   */
  executionsWindowHours: z.number().int().min(1).max(168).default(24)
});

export type N8nConfig = z.infer<typeof configSchema>;

/** Kept deliberately small: a page we cannot hold is a worker slot we cannot give back. */
const pageSize = 100;
const maxPagesPerRun = 20;

const workflowSchema = z.object({
  id: identifier,
  name: z.string().max(300).default(""),
  active: z.boolean().default(false),
  // `isArchived` is what current n8n sends; `archived` is what older builds sent. Neither is
  // required, because an instance that predates the flag simply has no archived workflows.
  isArchived: z.boolean().optional(),
  archived: z.boolean().optional(),
  createdAt: z.string().max(64).optional(),
  updatedAt: z.string().max(64).optional(),
  tags: z
    .array(z.object({ name: z.string().max(120) }))
    .max(50)
    .default([])
});

const executionSchema = z.object({
  id: identifier,
  workflowId: identifier,
  status: z.string().max(40).default("unknown"),
  mode: z.string().max(40).optional(),
  startedAt: z.string().max(64).optional(),
  stoppedAt: z.string().max(64).nullish(),
  retryOf: identifier.nullish()
});

const pageOf = <Item extends z.ZodType>(item: Item) =>
  z.object({ data: z.array(item).max(pageSize * 2), nextCursor: z.string().max(2048).nullish() });

/**
 * Where the executions read got to, as an opaque string the platform stores and hands back.
 *
 * A watermark and not a page cursor. An n8n page cursor points further into the past, so keeping
 * one between runs would walk backwards forever and never see anything new. The highest id
 * already seen is the only thing worth remembering, and it makes a repeated run return nothing
 * rather than the same failures a second time.
 */
type Watermark = { lastExecutionId: string };

function readWatermark(cursor: string | null): number | null {
  if (!cursor) return null;
  try {
    const parsed: unknown = JSON.parse(cursor);
    const id = (parsed as Watermark | null)?.lastExecutionId;
    const numeric = Number(id);
    return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : null;
  } catch {
    // A cursor we cannot read is a cursor from an older release. Falling back to the window is
    // the safe direction: it re-reads a little, and the record key makes that a no-op.
    return null;
  }
}

function parsed<Schema extends z.ZodType>(schema: Schema, response: HttpResponse): z.infer<Schema> {
  let body: unknown;
  try {
    body = JSON.parse(response.body);
  } catch {
    throw new ConnectorError("INVALID_RESPONSE");
  }
  const result = schema.safeParse(body);
  // No issue detail: the value that failed to parse is a provider payload, and it is exactly the
  // kind of thing that carries a customer's data into an error message.
  if (!result.success) throw new ConnectorError("INVALID_RESPONSE");
  return result.data;
}

/**
 * One call to the instance, with the token opened for the length of that call.
 *
 * The query is built here rather than by the caller so that no operation can accidentally put a
 * secret in it: everything that goes in the URL is a literal or a number from configuration.
 */
async function get<Schema extends z.ZodType>(
  context: ConnectorContext<N8nConfig>,
  path: string,
  query: Readonly<Record<string, string>>,
  schema: Schema
): Promise<z.infer<Schema>> {
  const url = new URL(`${context.config.baseUrl.replace(/\/+$/, "")}${path}`);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);

  const token = await context.secrets.open("api_token");
  const response = await context.http.send({
    method: "GET",
    url: url.toString(),
    headers: { "X-N8N-API-KEY": token, accept: "application/json" }
  });

  const failure = failureForStatus(response.status);
  if (failure) throw new ConnectorError(failure.toUpperCase());
  return parsed(schema, response);
}

/** Only the fields we chose. Everything else the provider sent stops here. */
function workflowRecord(workflow: z.infer<typeof workflowSchema>): ConnectorRecord {
  const data: Record<string, RecordValue> = {
    name: workflow.name,
    active: workflow.active,
    archived: isArchived(workflow),
    tags: workflow.tags.map((tag) => tag.name)
  };
  if (workflow.createdAt) data.createdAt = workflow.createdAt;
  if (workflow.updatedAt) data.updatedAt = workflow.updatedAt;
  return { externalId: `workflow:${workflow.id}`, data };
}

const isArchived = (workflow: z.infer<typeof workflowSchema>) => workflow.isArchived ?? workflow.archived ?? false;

function executionRecord(execution: z.infer<typeof executionSchema>): ConnectorRecord {
  const data: Record<string, RecordValue> = {
    workflowId: execution.workflowId,
    status: execution.status
  };
  if (execution.mode) data.mode = execution.mode;
  if (execution.startedAt) data.startedAt = execution.startedAt;
  if (execution.stoppedAt) data.stoppedAt = execution.stoppedAt;
  if (execution.retryOf) data.retryOf = execution.retryOf;
  return { externalId: `execution:${execution.id}`, data };
}

/**
 * The whole inventory, every pass.
 *
 * A `state` operation has to be complete or the purge would expire whatever this pass failed to
 * mention. So it pages to the end and returns no cursor: the next pass starts again from the
 * top, which is what makes a workflow deleted in n8n eventually disappear from here too.
 */
async function pullWorkflows(context: ConnectorContext<N8nConfig>): Promise<OperationResult> {
  const records: ConnectorRecord[] = [];
  let cursor: string | null = null;

  for (let page = 0; page < maxPagesPerRun; page += 1) {
    const query: Record<string, string> = { limit: String(pageSize) };
    if (cursor) query.cursor = cursor;

    const result = await get(context, "/api/v1/workflows", query, pageOf(workflowSchema));
    for (const workflow of result.data) {
      if (!context.config.includeArchived && isArchived(workflow)) continue;
      records.push(workflowRecord(workflow));
    }

    cursor = result.nextCursor ?? null;
    if (!cursor) return { records, cursor: null };
  }

  // More pages than we agreed to read in one pass. Reporting what we have is wrong for a `state`
  // operation -- a partial inventory expires the rest -- so this is a failure, not a truncation.
  throw new ConnectorError("TOO_MANY_PAGES");
}

/**
 * The failed executions we have not seen yet, newest first, stopping as soon as we recognise one.
 *
 * Only failures: a successful execution is not something anybody here acts on, and an installation
 * that runs thousands a day would fill the table with rows nobody reads.
 */
async function pullExecutions(
  context: ConnectorContext<N8nConfig>,
  input: { cursor: string | null }
): Promise<OperationResult> {
  const watermark = readWatermark(input.cursor);
  const since = new Date(context.clock.now().getTime() - context.config.executionsWindowHours * 60 * 60 * 1000);

  const records: ConnectorRecord[] = [];
  let highest = watermark ?? 0;
  let cursor: string | null = null;

  for (let page = 0; page < maxPagesPerRun; page += 1) {
    const query: Record<string, string> = { limit: String(pageSize), status: "error", includeData: "false" };
    if (cursor) query.cursor = cursor;

    const result = await get(context, "/api/v1/executions", query, pageOf(executionSchema));

    for (const execution of result.data) {
      const numericId = Number(execution.id);
      // Everything from here down is older than what we already have. n8n returns newest first,
      // so the first familiar id ends the walk rather than merely skipping one row.
      if (watermark !== null && Number.isSafeInteger(numericId) && numericId <= watermark) {
        return { records, cursor: cursorFor(highest, input.cursor) };
      }
      if (watermark === null && execution.startedAt && new Date(execution.startedAt) < since) {
        return { records, cursor: cursorFor(highest, input.cursor) };
      }

      records.push(executionRecord(execution));
      if (Number.isSafeInteger(numericId) && numericId > highest) highest = numericId;
    }

    cursor = result.nextCursor ?? null;
    if (!cursor) return { records, cursor: cursorFor(highest, input.cursor) };
  }

  // An `event` operation may stop early: what it did not read this time it will read next time,
  // because the watermark only advances over rows actually returned.
  context.logger.warn({ instanceId: context.instanceId, pages: maxPagesPerRun }, "n8n executions page limit reached");
  return { records, cursor: cursorFor(highest, input.cursor) };
}

const cursorFor = (highest: number, previous: string | null): string | null =>
  highest > 0 ? JSON.stringify({ lastExecutionId: String(highest) } satisfies Watermark) : previous;

/**
 * What an error workflow sends us.
 *
 * n8n's error trigger hands the workflow a rich object that includes the error itself, and the
 * error message frequently quotes the request that failed -- headers, URLs, tokens. We read the
 * two ids and the node name and let the rest go: what the webhook buys is speed, and the details
 * are already in the poll, projected safely.
 */
const errorPayloadSchema = z.object({
  execution: z.object({
    id: identifier,
    mode: z.string().max(40).optional(),
    lastNodeExecuted: z.string().max(200).optional(),
    retryOf: identifier.nullish()
  }),
  workflow: z.object({ id: identifier, name: z.string().max(300).optional() })
});

function readErrorEvent(request: IngressRequest): IngressResult {
  let payload: unknown;
  try {
    payload = JSON.parse(request.body);
  } catch {
    throw new ConnectorError("INVALID_PAYLOAD");
  }

  const result = errorPayloadSchema.safeParse(payload);
  if (!result.success) throw new ConnectorError("INVALID_PAYLOAD");
  const { execution, workflow } = result.data;

  const summary: Record<string, string> = { workflowId: workflow.id, executionId: execution.id };
  if (execution.lastNodeExecuted) summary.lastNodeExecuted = execution.lastNodeExecuted;
  if (execution.mode) summary.mode = execution.mode;

  // The provider's own execution id, so the same failure arriving by webhook and by poll is one
  // thing rather than two, and a replayed webhook is one thing rather than two as well.
  return { eventId: `execution:${execution.id}`, accepted: true, summary };
}

export const n8n = defineConnector<N8nConfig>({
  type: "n8n",
  contractVersion: connectorContractVersion,
  configSchema,
  /** The order an operator is asked: the address first, because nothing works without it. */
  configFields: [
    { name: "baseUrl", kind: "url", group: "connection" },
    { name: "includeArchived", kind: "toggle", group: "behaviour" },
    { name: "executionsWindowHours", kind: "number", group: "behaviour" }
  ],
  /** The token is n8n's; the signing secret is ours, minted once when the endpoint is coined. */
  credentialKinds: ["api_token", "ingress_signing"],
  capabilities: {
    egress: { schemes: ["http", "https"], destination: "operator_allowlist" },
    operations: {
      pull_workflows: { shape: "state", everySeconds: 15 * 60 },
      pull_executions: { shape: "event", everySeconds: 5 * 60 }
    },
    ingress: true
  },
  async health(context) {
    // The cheapest authenticated call there is. `/healthz` would answer without a token, which
    // would report a healthy instance we cannot actually read -- evidence of the wrong thing.
    const response = await context.http.send({
      method: "GET",
      url: `${context.config.baseUrl.replace(/\/+$/, "")}/api/v1/workflows?limit=1`,
      headers: { "X-N8N-API-KEY": await context.secrets.open("api_token"), accept: "application/json" },
      timeoutMs: 10_000
    });

    const failure = failureForStatus(response.status);
    return failure ? { status: "failed", failure } : { status: "ok" };
  },
  operations: {
    pull_workflows: (context) => pullWorkflows(context),
    pull_executions: (context, input) => pullExecutions(context, input)
  },
  ingress: {
    signature: {
      algorithm: "hmac-sha256",
      signatureHeader: "x-control-hub-signature",
      timestampHeader: "x-control-hub-timestamp",
      /**
       * n8n signs nothing on its own: a Crypto node in the error workflow computes this over the
       * secret we minted. The timestamp is inside the signed bytes so that a captured request
       * cannot be replayed with a fresh header.
       */
      payload: (timestamp, rawBody) => `${timestamp}.${rawBody}`
    },
    handle: (_context, request) => readErrorEvent(request)
  }
});

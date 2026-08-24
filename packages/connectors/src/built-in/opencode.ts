import { z } from "zod";
import { ConnectorError, connectorContractVersion, defineConnector, type ConnectorRecord } from "../contract.js";

const integer = z.union([z.int().nonnegative().safe(), z.string().regex(/^\d+$/)]).transform(String);
const tokenSchema = z.strictObject({
  input: integer,
  output: integer,
  reasoning: integer,
  cacheRead: integer,
  cacheWrite: integer
});
const eventSchema = z.strictObject({
  id: z.string().min(1).max(200),
  occurredAt: z.iso.datetime({ offset: true }),
  provider: z.string().min(1).max(80),
  model: z.string().min(1).max(160),
  projectRef: z.string().regex(/^[a-f0-9]{64}$/),
  tokens: tokenSchema
});
const payloadSchema = z.strictObject({
  schemaVersion: z.literal(1),
  batchId: z.string().min(1).max(200),
  deviceId: z.uuid(),
  events: z.array(eventSchema).min(1).max(500)
});
const configSchema = z.strictObject({});

export type OpenCodeConfig = z.infer<typeof configSchema>;
export type OpenCodeCollectorPayload = z.input<typeof payloadSchema>;

function positive(quantity: string, unit: string, qualifier: string) {
  return BigInt(quantity) > 0n ? [{ unit, quantity, qualifier }] : [];
}

export function readOpenCodePayload(body: string): { batchId: string; records: ConnectorRecord[] } {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    throw new ConnectorError("INVALID_PAYLOAD");
  }
  const parsed = payloadSchema.safeParse(json);
  if (!parsed.success) throw new ConnectorError("INVALID_PAYLOAD");
  return {
    batchId: parsed.data.batchId,
    records: parsed.data.events.map((event) => ({
      externalId: `${parsed.data.deviceId}:${event.id}`,
      data: {
        source: { deviceId: parsed.data.deviceId, projectRef: event.projectRef },
        usage: {
          occurredAt: event.occurredAt,
          sku: `${event.provider}:${event.model}`,
          status: "observed",
          quantities: [
            ...positive(event.tokens.input, "input_token", "input"),
            ...positive(event.tokens.output, "output_token", "output"),
            ...positive(event.tokens.reasoning, "output_token", "reasoning"),
            ...positive(event.tokens.cacheRead, "cached_input_token", "cache_read"),
            ...positive(event.tokens.cacheWrite, "cached_input_token", "cache_write"),
            { unit: "request", quantity: "1", qualifier: "total" }
          ]
        }
      }
    }))
  };
}

export const openCode = defineConnector<OpenCodeConfig>({
  type: "opencode",
  contractVersion: connectorContractVersion,
  configSchema,
  configFields: [],
  credentialKinds: ["ingress_signing"],
  capabilities: { egress: null, operations: {}, ingress: true },
  health: () => Promise.resolve({ status: "unverifiable" }),
  operations: {},
  ingress: {
    signature: {
      algorithm: "hmac-sha256",
      signatureHeader: "x-control-hub-signature",
      timestampHeader: "x-control-hub-timestamp",
      payload: (timestamp, rawBody) => `${timestamp}.${rawBody}`
    },
    handle: (_context, request) => {
      const result = readOpenCodePayload(request.body);
      return {
        eventId: result.batchId,
        accepted: true,
        summary: { eventCount: String(result.records.length) },
        records: result.records
      };
    }
  }
});

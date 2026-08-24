import type { UsageEventInput } from "@control-hub/application";
import type { TenantContext, UsageUnit } from "@control-hub/domain";
import { z } from "zod";

const units = [
  "input_token",
  "output_token",
  "cached_input_token",
  "request",
  "image",
  "audio_second",
  "compute_millisecond",
  "byte",
  "provider_unit"
] as const satisfies readonly UsageUnit[];
const qualifiers = [
  "total",
  "input",
  "output",
  "cached",
  "uncached",
  "reasoning",
  "cache_read",
  "cache_write"
] as const;
const integer = z.union([z.int().nonnegative(), z.string().regex(/^\d+$/)]).transform((value) => BigInt(value));
const usageSchema = z.strictObject({
  occurredAt: z.iso.datetime({ offset: true }),
  sku: z.string().min(1).max(160),
  status: z.enum(["observed", "estimated", "void"]).default("observed"),
  quantities: z
    .array(
      z.strictObject({
        unit: z.enum(units),
        quantity: integer,
        qualifier: z.enum(qualifiers).optional()
      })
    )
    .min(1)
    .max(32),
  reportedCost: z.strictObject({ amountMinor: integer, currency: z.string().regex(/^[A-Z]{3}$/) }).optional(),
  customerId: z.uuid().optional(),
  productId: z.uuid().optional(),
  customerServiceId: z.uuid().optional(),
  projectId: z.uuid().optional()
});

export type ConnectorUsageRecord = { externalId: string; data: Readonly<Record<string, unknown>> };
export type UsageIngestionInput = {
  instanceId: string;
  operation: string;
  completedAt: Date;
  records: readonly ConnectorUsageRecord[];
};
type UsageIngestionService = {
  ensureConnectorSource(
    context: TenantContext,
    input: { instanceId: string; operation: string }
  ): Promise<{ id: string }>;
  ingestEvent(context: TenantContext, input: UsageEventInput): Promise<{ inserted: boolean }>;
  completeSource(context: TenantContext, sourceId: string, completedAt: Date): Promise<void>;
};

export class UsageIngestionError extends Error {
  constructor(public readonly code: "USAGE_EXTERNAL_ID_INVALID" | "USAGE_RECORD_INVALID") {
    super(code);
    this.name = "UsageIngestionError";
  }
}

export function normalizeUsageRecord(
  record: ConnectorUsageRecord,
  sourceId: string,
  operation: string
): UsageEventInput | null {
  if (!("usage" in record.data)) return null;
  if (record.externalId.length < 1 || record.externalId.length > 240)
    throw new UsageIngestionError("USAGE_EXTERNAL_ID_INVALID");
  const parsed = usageSchema.safeParse(record.data.usage);
  if (!parsed.success) throw new UsageIngestionError("USAGE_RECORD_INVALID");
  const attributionCount = [
    parsed.data.customerId,
    parsed.data.productId,
    parsed.data.customerServiceId,
    parsed.data.projectId
  ].filter(Boolean).length;
  if (attributionCount > 1) throw new UsageIngestionError("USAGE_RECORD_INVALID");
  return {
    sourceId,
    externalId: record.externalId,
    occurredAt: new Date(parsed.data.occurredAt),
    operation,
    sku: parsed.data.sku,
    status: parsed.data.status,
    quantities: parsed.data.quantities.map((quantity) => ({
      unit: quantity.unit,
      quantity: quantity.quantity,
      ...(quantity.qualifier ? { qualifier: quantity.qualifier } : {})
    })),
    ...(parsed.data.reportedCost ? { reportedCost: parsed.data.reportedCost } : {}),
    ...(parsed.data.customerId ? { customerId: parsed.data.customerId } : {}),
    ...(parsed.data.productId ? { productId: parsed.data.productId } : {}),
    ...(parsed.data.customerServiceId ? { customerServiceId: parsed.data.customerServiceId } : {}),
    ...(parsed.data.projectId ? { projectId: parsed.data.projectId } : {})
  };
}

export class UsageRecordIngestor {
  constructor(private readonly service: UsageIngestionService) {}

  async ingest(context: TenantContext, input: UsageIngestionInput) {
    const source = await this.service.ensureConnectorSource(context, {
      instanceId: input.instanceId,
      operation: input.operation
    });
    let inserted = 0;
    let duplicates = 0;
    let ignored = 0;
    for (const record of input.records) {
      const normalized = normalizeUsageRecord(record, source.id, input.operation);
      if (!normalized) {
        ignored += 1;
        continue;
      }
      const result = await this.service.ingestEvent(context, normalized);
      if (result.inserted) inserted += 1;
      else duplicates += 1;
    }
    await this.service.completeSource(context, source.id, input.completedAt);
    return { accepted: inserted + duplicates, inserted, duplicates, ignored };
  }
}

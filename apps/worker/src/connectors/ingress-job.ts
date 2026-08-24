import type { ConnectorRepository } from "@control-hub/application";
import { ConnectorError, type RegisteredConnector } from "@control-hub/connectors";
import { connectorIngressJobName, type ConnectorIngressJobPayload } from "@control-hub/contracts/jobs";
import { z } from "zod";
import { jobContext } from "./job.js";

export { connectorIngressJobName };

export const connectorIngressJobSchema = z.strictObject({
  tenantId: z.uuid(),
  eventId: z.uuid()
});

type UsageProjector = {
  ingest(
    context: ReturnType<typeof jobContext>,
    input: {
      instanceId: string;
      operation: string;
      completedAt: Date;
      records: readonly { externalId: string; data: Readonly<Record<string, unknown>> }[];
    }
  ): Promise<unknown>;
};

type Registry = { find(type: string): RegisteredConnector | null };
type IngressRepository = Pick<
  ConnectorRepository,
  "getPendingInbox" | "finishInboxEvent" | "recordInboxAttempt" | "upsertRecords"
>;

export type IngressJob = { data: unknown };

export class ConnectorIngressJobError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}

const operation = "ingress_usage";

export async function runConnectorIngressJob(
  repository: IngressRepository,
  registry: Registry,
  usage: UsageProjector | undefined,
  job: IngressJob,
  now: () => Date = () => new Date()
) {
  const parsed = connectorIngressJobSchema.safeParse(job.data);
  if (!parsed.success) throw new ConnectorIngressJobError("CONNECTOR_INGRESS_JOB_PAYLOAD_INVALID");
  const payload: ConnectorIngressJobPayload = parsed.data;
  const context = jobContext(payload.tenantId, Boolean(usage));
  const inbox = await repository.getPendingInbox(context, payload.eventId);
  if (!inbox) return { status: "skipped" as const, reason: "not_pending" as const };

  if (inbox.instanceStatus !== "enabled") {
    await repository.finishInboxEvent(context, inbox.id, { status: "discarded", processedAt: now() });
    return { status: "discarded" as const, reason: "instance_disabled" as const };
  }

  const connector = registry.find(inbox.connectorType);
  if (!connector?.capabilities.ingress) throw new ConnectorIngressJobError("INGRESS_NOT_SUPPORTED");

  try {
    const result = await connector.ingest(
      {
        instanceId: inbox.instanceId,
        config: inbox.config,
        http: { send: () => Promise.reject(new ConnectorError("EGRESS_NOT_AVAILABLE")) },
        secrets: { open: () => Promise.reject(new ConnectorError("SECRETS_NOT_AVAILABLE")) },
        logger: { info: () => {}, warn: () => {}, error: () => {} },
        clock: { now }
      },
      { body: inbox.payload, headers: {}, receivedAt: inbox.receivedAt }
    );

    if (!result.accepted) {
      await repository.finishInboxEvent(context, inbox.id, { status: "discarded", processedAt: now() });
      return { status: "discarded" as const, reason: "filtered" as const };
    }

    const records = result.records ?? [];
    if (records.length > 0) {
      if (!usage) throw new ConnectorIngressJobError("USAGE_DISABLED");
      await repository.upsertRecords(context, {
        instanceId: inbox.instanceId,
        operation,
        shape: "event",
        records,
        seenAt: now()
      });
      await usage.ingest(context, {
        instanceId: inbox.instanceId,
        operation,
        completedAt: now(),
        records
      });
    }
    await repository.finishInboxEvent(context, inbox.id, { status: "processed", processedAt: now() });
    return { status: "processed" as const, records: records.length };
  } catch (error) {
    await repository.recordInboxAttempt(context, inbox.id);
    throw error;
  }
}

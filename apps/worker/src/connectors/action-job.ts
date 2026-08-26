import { ConnectorError } from "@control-hub/connectors";
import type { PostgresConnectorActionRepository } from "@control-hub/persistence";
import { EgressError } from "./guarded-fetch.js";
import { jobContext } from "./job.js";
import { ConnectorRunError } from "./runtime.js";
import type { ConnectorRuntime } from "./runtime.js";

export const connectorActionJobName = "connector-action";

export async function runConnectorActionJob(
  repository: PostgresConnectorActionRepository,
  runtime: ConnectorRuntime,
  data: unknown
) {
  if (!isPayload(data)) throw new Error("ACTION_JOB_PAYLOAD_INVALID");
  const context = jobContext(data.tenantId);
  const work = await repository.acquire(context, data.requestId);
  if (!work) return { status: "skipped" };
  try {
    const result = await runtime.act(context, {
      instanceId: work.instanceId,
      action: "send_mail",
      input: { to: work.recipient, subject: work.subject, text: work.body }
    });
    await repository.complete(context, work.requestId, {
      status: "succeeded",
      ...(result.externalId ? { externalId: result.externalId } : {})
    });
    return { status: "succeeded" };
  } catch (error) {
    // Once the HTTP adapter was invoked, a network failure cannot prove the provider did not
    // accept the message. Do not retry a before-delivery-only action blindly.
    const status = indeterminateDelivery(error) ? "unknown" : "failed";
    await repository.complete(context, work.requestId, { status, errorCode: errorCode(error) });
    return { status };
  }
}

function indeterminateDelivery(error: unknown): boolean {
  // A transport failure can happen after bytes left the process, so the provider may have
  // accepted the message. Provider responses and local validation failures are definitive.
  if (error instanceof EgressError) return error.failure === "timeout" || error.failure === "connection_reset";
  if (error instanceof ConnectorError || error instanceof ConnectorRunError) return false;
  return true;
}

function isPayload(value: unknown): value is { tenantId: string; requestId: string } {
  return Boolean(
    value &&
    typeof value === "object" &&
    typeof (value as { tenantId?: unknown }).tenantId === "string" &&
    typeof (value as { requestId?: unknown }).requestId === "string"
  );
}

function errorCode(error: unknown) {
  const code = error instanceof Error && "code" in error ? String(error.code) : "ACTION_RESULT_UNKNOWN";
  return code.slice(0, 120);
}

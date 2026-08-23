import { connectorJobName } from "@control-hub/contracts/jobs";
import type { TenantContext } from "@control-hub/domain";
import { DelayedError } from "bullmq";
import { z } from "zod";
import type { ConnectorRuntime, RunVerdict } from "./runtime.js";

/**
 * The queue's side of a connector run.
 *
 * The payload carries an instance and an operation and nothing else that matters: no credential,
 * no configuration, no base URL. Everything the run needs is read from the database inside the
 * tenant, which is what keeps a job that sat in Valkey for an hour from executing against a
 * configuration somebody has since changed — or against a credential they have since revoked.
 *
 * Specification: `docs/specifications/connectors.md`.
 */

export { connectorJobName };

export const connectorJobSchema = z.strictObject({
  tenantId: z.uuid(),
  instanceId: z.uuid(),
  operation: z.string().min(1).max(64),
  cursor: z.string().max(4096).nullable().default(null)
});

export type ConnectorJobPayload = z.infer<typeof connectorJobSchema>;

/**
 * The context a queued job runs under.
 *
 * There is no person behind a job, so the permissions are the ones the work needs and no more.
 * `mfaEnabled` is true because a second factor is a property of a session and there is no session
 * here; the credential service refuses a write without one, and the worker never writes a
 * credential — it only opens what somebody with a second factor already stored.
 */
export function jobContext(tenantId: string, usageEnabled = false): TenantContext {
  return {
    tenantId,
    membershipId: "system",
    userId: "system",
    roles: [],
    // Explicit service-account scopes. Human Technical memberships never inherit usage:manage,
    // and a worker with the feature closed does not carry its write scope either.
    permissions: usageEnabled ? ["integrations:read", "usage:manage"] : ["integrations:read"],
    mfaEnabled: true
  };
}

export type QueuedJob = {
  id?: string | undefined;
  data: unknown;
  attemptsMade: number;
  moveToDelayed(timestamp: number, token?: string): Promise<void>;
  token?: string | undefined;
};

export class ConnectorJobError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}

/**
 * Runs one job and decides what the queue does next.
 *
 * A transient failure is delayed by the amount the domain computed rather than left to BullMQ's
 * own backoff: two policies that disagree would mean the one that wins is the one nobody wrote a
 * test for. `DelayedError` after `moveToDelayed` is how BullMQ is told the job is not finished —
 * without it the job would be marked complete and the retry would never happen.
 *
 * A permanent failure returns normally. The run row already says it failed; making the job fail
 * as well would retry it under the queue's rules, which is exactly what "permanent" rules out.
 */
export async function runConnectorJob(
  runtime: ConnectorRuntime,
  job: QueuedJob,
  usageEnabled = false
): Promise<RunVerdict> {
  const parsed = connectorJobSchema.safeParse(job.data);
  if (!parsed.success) throw new ConnectorJobError("CONNECTOR_JOB_PAYLOAD_INVALID");

  const payload = parsed.data;
  const verdict = await runtime.run(jobContext(payload.tenantId, usageEnabled), {
    instanceId: payload.instanceId,
    operation: payload.operation,
    // The job id and the attempt together are what make a redelivery find its own row instead of
    // opening a second one. BullMQ counts attempts from zero; a run reads better from one.
    jobId: job.id ?? `${payload.instanceId}:${payload.operation}`,
    attempt: job.attemptsMade + 1,
    cursor: payload.cursor
  });

  if (verdict.status === "retry") {
    await job.moveToDelayed(Date.now() + verdict.delayMs, job.token);
    throw new DelayedError();
  }
  return verdict;
}

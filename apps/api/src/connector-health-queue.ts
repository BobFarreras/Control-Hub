import type { ConnectorHealthCheckQueue } from "@control-hub/application";
import { connectorHealthOperation, connectorJobName, type ConnectorJobPayload } from "@control-hub/contracts";
import type { Queue } from "bullmq";

/**
 * The API's only way of making the worker do something.
 *
 * It enqueues and returns; it never waits for the result. A health check talks to somebody else's
 * server, and a request that waited for that would hand a provider's timeout to the person
 * looking at the screen.
 *
 * The payload carries an instance and an operation. No configuration and no credential travel
 * through Valkey: the worker reads both inside the tenant, at the moment it runs.
 */
export function createConnectorHealthCheckQueue(queue: Queue): ConnectorHealthCheckQueue {
  return {
    async requestHealthCheck({ tenantId, instanceId, idempotencyKey }) {
      const payload: ConnectorJobPayload = {
        tenantId,
        instanceId,
        operation: connectorHealthOperation,
        cursor: null
      };
      /**
       * With an `Idempotency-Key` the job identifier is derived from it, and BullMQ refuses a
       * second job with an identifier it already holds. That is the whole of idempotency for this
       * route: a client that retries a timed-out request queues one check, not two.
       *
       * Without a key each request is its own check, which is what somebody pressing the button
       * twice on purpose means.
       */
      const job = await queue.add(connectorJobName, payload, {
        ...(idempotencyKey ? { jobId: `health:${instanceId}:${idempotencyKey}` } : {}),
        removeOnComplete: 100,
        removeOnFail: 100
      });
      return job.id ?? `health:${instanceId}`;
    }
  };
}

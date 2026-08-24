import { connectorIngressJobName, type ConnectorIngressJobPayload } from "@control-hub/contracts/jobs";
import type { Queue } from "bullmq";

export type ConnectorIngressQueue = {
  enqueue(payload: ConnectorIngressJobPayload): Promise<void>;
};

export function createConnectorIngressQueue(queue: Pick<Queue, "add">): ConnectorIngressQueue {
  return {
    async enqueue(payload) {
      await queue.add(connectorIngressJobName, payload, {
        jobId: `ingress-${payload.eventId}`,
        attempts: 5,
        backoff: { type: "exponential", delay: 1_000 },
        removeOnComplete: 1_000,
        removeOnFail: true
      });
    }
  };
}

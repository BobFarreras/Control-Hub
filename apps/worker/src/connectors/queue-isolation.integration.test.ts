import { connectorQueueName, systemQueueName } from "@control-hub/contracts/jobs";
import { Queue, QueueEvents, Worker } from "bullmq";
import { afterEach, describe, expect, it } from "vitest";

/**
 * That connector work cannot hold up the system queue, proved against a destination that never
 * answers rather than against a mock that pretends to be slow.
 *
 * Criterion 8 of the phase 7.1 specification. The failure this guards against is not theoretical:
 * a connector call waits on somebody else's server, and on a shared queue four instances hanging
 * on a thirty-second budget would hold every slot. The support escalation sweep has a service
 * level attached to it, and it would be waiting behind a provider nobody here controls.
 */

const connection = { host: "127.0.0.1", port: 6379 };
const resources: Array<{ close(): Promise<void> }> = [];
afterEach(async () => {
  for (const resource of resources.splice(0)) await resource.close();
});

const connectorConcurrency = 4;

describe("connector work and system work do not share a queue", () => {
  it("answers a system job while every connector slot is stuck on a provider that never replies", async () => {
    const suffix = `integration-${process.pid}-${Date.now()}`;
    // Named from the real constants so that a rename which put both back on one queue would leave
    // this test passing for the wrong reason: it would then be scheduling against a single name.
    const connectorName = `${connectorQueueName}-${suffix}`;
    const systemName = `${systemQueueName}-${suffix}`;
    expect(connectorName).not.toBe(systemName);

    const connectorQueue = new Queue(connectorName, { connection });
    const systemQueue = new Queue(systemName, { connection });
    const systemEvents = new QueueEvents(systemName, { connection });

    let started = 0;
    let release = () => {};
    // The provider that never answers: no timer, no timeout, nothing that could finish on its own.
    // Whatever the slot budget is, this holds it until the test lets go.
    const stuck = new Promise<void>((resolve) => {
      release = resolve;
    });

    const connectorWorker = new Worker(
      connectorName,
      async () => {
        started += 1;
        await stuck;
        return { status: "ok" };
      },
      { connection, concurrency: connectorConcurrency }
    );
    // Stands in for the escalation sweep: whatever it does, it does not wait on a provider.
    const systemWorker = new Worker(systemName, () => Promise.resolve({ sweptAt: new Date().toISOString() }), {
      connection,
      concurrency: 4
    });

    // Workers first: a queue obliterated under a running worker leaves the worker retrying keys
    // that are no longer there, and the noise lands in the next test.
    resources.push(connectorWorker, systemWorker, systemEvents);
    for (const queue of [connectorQueue, systemQueue]) {
      resources.push({
        close: async () => {
          await queue.obliterate({ force: true });
          await queue.close();
        }
      });
    }

    await Promise.all([
      connectorQueue.waitUntilReady(),
      systemQueue.waitUntilReady(),
      systemEvents.waitUntilReady(),
      connectorWorker.waitUntilReady(),
      systemWorker.waitUntilReady()
    ]);

    // Twice the concurrency, so there is a queue behind the jam as well as a full set of slots.
    await connectorQueue.addBulk(
      Array.from({ length: connectorConcurrency * 2 }, (_unused, index) => ({
        name: "connector-run",
        data: { tenantId: "t", instanceId: `i-${index}`, operation: "pull_workflows", cursor: null },
        opts: { attempts: 1, removeOnComplete: true }
      }))
    );

    await waitFor(() => started === connectorConcurrency, "every connector slot to be occupied");
    expect(await connectorQueue.getJobCounts("completed")).toEqual({ completed: 0 });

    const escalation = await systemQueue.add("support-escalation", {}, { attempts: 1, removeOnComplete: false });
    // Two seconds is generous for a job whose worker is idle, and far under the thirty-second
    // budget a connector call is allowed. If the queues were shared this could not finish at all.
    const result = await escalation.waitUntilFinished(systemEvents, 2_000);
    expect(result).toHaveProperty("sweptAt");

    // The jam is still a jam: the system job did not get through because the connectors drained.
    expect(started).toBe(connectorConcurrency);
    expect(await connectorQueue.getJobCounts("completed")).toEqual({ completed: 0 });

    // Let go before teardown, or closing the worker would wait on jobs that never end.
    release();
    await waitFor(() => started === connectorConcurrency * 2, "the connector backlog to drain");
  });
});

async function waitFor(condition: () => boolean, what: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

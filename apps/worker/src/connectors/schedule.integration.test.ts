import type { RegisteredConnector } from "@control-hub/connectors";
import { Queue } from "bullmq";
import { afterEach, describe, expect, it } from "vitest";
import {
  reconcileConnectorSchedules,
  schedulerIdOf,
  type SchedulableInstance,
  type ScheduleSweepOptions
} from "./schedule.js";

/**
 * The reconciler against a real Valkey, because the guarantee is about what survives in Valkey
 * and a double would only prove that the plan was computed. Criterion 8 of the phase 7.1
 * specification: disabling an instance takes its schedule away, a closed flag leaves none at all,
 * and an open circuit stretches the cadence rather than removing it.
 */

const connection = { host: "127.0.0.1", port: 6379 };
const resources: Array<{ close(): Promise<void> }> = [];
afterEach(async () => {
  for (const resource of resources.splice(0)) await resource.close();
});

const tenantId = "11111111-1111-4111-8111-111111111111";
const instanceId = "22222222-2222-4222-8222-222222222222";
const other = "33333333-3333-4333-8333-333333333333";

const registry = {
  find: (type: string) =>
    type === "n8n"
      ? ({
          capabilities: {
            egress: null,
            ingress: false,
            operations: {
              pull_workflows: { shape: "state", everySeconds: 900 },
              pull_executions: { shape: "event", everySeconds: 300 }
            }
          }
        } as unknown as RegisteredConnector)
      : null
};

const enabled: SchedulableInstance[] = [{ tenantId, id: instanceId, connectorType: "n8n" }];

async function freshQueue() {
  const queue = new Queue(`control-hub-connectors-integration-${process.pid}-${Date.now()}`, { connection });
  resources.push({ close: async () => (await queue.obliterate({ force: true }), await queue.close()) });
  await queue.waitUntilReady();
  return queue;
}

const sweepWith = (queue: Queue, overrides: Partial<ScheduleSweepOptions> = {}) =>
  reconcileConnectorSchedules({
    queue,
    jobName: "connector-run",
    instances: enabled,
    registry,
    circuitOpen: () => Promise.resolve(false),
    enabled: true,
    ...overrides
  });

const liveSchedules = async (queue: Queue) =>
  (await queue.getJobSchedulers()).map((scheduler) => ({ key: scheduler.key, every: scheduler.every }));

describe("reconciling connector schedules against Valkey", () => {
  it("writes one schedule per declared cadence, and is quiet when asked again", async () => {
    const queue = await freshQueue();

    expect(await sweepWith(queue)).toEqual({ upserted: 2, removed: 0 });
    expect(await liveSchedules(queue)).toEqual(
      expect.arrayContaining([
        { key: schedulerIdOf({ tenantId, instanceId, operation: "pull_workflows" }), every: 900_000 },
        { key: schedulerIdOf({ tenantId, instanceId, operation: "pull_executions" }), every: 300_000 }
      ])
    );

    // The second pass must be a no-op. A reconciler that rewrote everything every two minutes
    // would reset the next-run time each pass, and a fifteen-minute operation would never run.
    expect(await sweepWith(queue)).toEqual({ upserted: 0, removed: 0 });
  });

  it("takes the schedule away from an instance somebody disabled", async () => {
    const queue = await freshQueue();
    await sweepWith(queue);

    // Disabled means it is simply not in what the pass is told about: the reconciler compares
    // against reality rather than being notified of a change.
    expect(await sweepWith(queue, { instances: [] })).toEqual({ upserted: 0, removed: 2 });
    expect(await liveSchedules(queue)).toEqual([]);
  });

  it("leaves nothing scheduled when the flag is closed", async () => {
    const queue = await freshQueue();
    await sweepWith(queue);

    expect(await sweepWith(queue, { enabled: false })).toMatchObject({ upserted: 0, removed: 2 });
    expect(await liveSchedules(queue)).toEqual([]);
  });

  it("stretches the cadence of the operation whose circuit is open, and restores it after", async () => {
    const queue = await freshQueue();
    await sweepWith(queue);

    const open = (key: { operation: string }) => Promise.resolve(key.operation === "pull_executions");
    expect(await sweepWith(queue, { circuitOpen: open })).toEqual({ upserted: 1, removed: 0 });

    const stretched = await liveSchedules(queue);
    expect(stretched).toContainEqual({
      key: schedulerIdOf({ tenantId, instanceId, operation: "pull_executions" }),
      every: 3_000_000
    });
    // The healthy operation of the same instance kept its own pace.
    expect(stretched).toContainEqual({
      key: schedulerIdOf({ tenantId, instanceId, operation: "pull_workflows" }),
      every: 900_000
    });

    expect(await sweepWith(queue)).toEqual({ upserted: 1, removed: 0 });
    expect(await liveSchedules(queue)).toContainEqual({
      key: schedulerIdOf({ tenantId, instanceId, operation: "pull_executions" }),
      every: 300_000
    });
  });

  it("removes an orphan and keeps the instance that is still there, in one pass", async () => {
    const queue = await freshQueue();
    await sweepWith(queue, { instances: [...enabled, { tenantId, id: other, connectorType: "n8n" }] });
    expect(await liveSchedules(queue)).toHaveLength(4);

    expect(await sweepWith(queue)).toEqual({ upserted: 0, removed: 2 });
    const remaining = (await liveSchedules(queue)).map((schedule) => schedule.key);
    expect(remaining.every((key) => key.includes(instanceId))).toBe(true);
  });
});

import type { RegisteredConnector } from "@control-hub/connectors";
import { describe, expect, it } from "vitest";
import {
  cadenceMs,
  desiredSchedules,
  openCircuitCadenceCapMs,
  reconcileSchedules,
  schedulerIdOf,
  type DesiredSchedule,
  type LiveSchedule
} from "./schedule.js";

const tenantId = "11111111-1111-4111-8111-111111111111";
const instanceId = "22222222-2222-4222-8222-222222222222";

const connector = (operations: Record<string, { shape: "state" | "event"; everySeconds?: number }>) =>
  ({ capabilities: { egress: null, operations, ingress: false } }) as unknown as RegisteredConnector;

const registryOf = (entries: Record<string, RegisteredConnector>) => ({
  find: (type: string) => entries[type] ?? null
});

const desired = (operation: string, everyMs: number): DesiredSchedule => ({
  tenantId,
  instanceId,
  operation,
  schedulerId: schedulerIdOf({ tenantId, instanceId, operation }),
  everyMs
});

describe("what the cadence becomes", () => {
  it("is what the manifest declared, while the circuit is closed", () => {
    expect(cadenceMs(300, false)).toBe(300_000);
  });

  /**
   * A provider that is down does not stop being down faster because we ask more often. Backing
   * off keeps the worker slots for instances that can answer, and the breaker still lets one
   * probe through, so recovery is noticed -- later, not never.
   */
  it("stretches tenfold while the circuit is open", () => {
    expect(cadenceMs(300, true)).toBe(3_000_000);
  });

  it("stops stretching at an hour, so a recovery is never invisible for a day", () => {
    expect(cadenceMs(3_600, true)).toBe(openCircuitCadenceCapMs);
    expect(cadenceMs(86_400, true)).toBe(openCircuitCadenceCapMs);
  });
});

describe("which schedules should exist", () => {
  const instances = [{ tenantId, id: instanceId, connectorType: "n8n" }];
  const closed = () => Promise.resolve(false);

  it("takes one per declared cadence, and nothing for an operation without one", async () => {
    const registry = registryOf({
      n8n: connector({
        pull_workflows: { shape: "state", everySeconds: 900 },
        pull_executions: { shape: "event", everySeconds: 300 },
        // Declared, runnable, and nothing schedules it.
        replay: { shape: "event" }
      })
    });

    const result = await desiredSchedules({ instances, registry, circuitOpen: closed });
    expect(result).toEqual([desired("pull_workflows", 900_000), desired("pull_executions", 300_000)]);
  });

  /**
   * A connector that left the registry between releases has instances still sitting in the
   * database. They must not be scheduled: there is nothing to run, and a schedule with no
   * handler is a job that fails every fifteen minutes forever.
   */
  it("skips an instance whose connector is no longer in the registry", async () => {
    const result = await desiredSchedules({ instances, registry: registryOf({}), circuitOpen: closed });
    expect(result).toEqual([]);
  });

  it("stretches only the operation whose circuit is open, not the whole instance", async () => {
    const registry = registryOf({
      n8n: connector({
        pull_workflows: { shape: "state", everySeconds: 900 },
        pull_executions: { shape: "event", everySeconds: 300 }
      })
    });

    const result = await desiredSchedules({
      instances,
      registry,
      circuitOpen: (key) => Promise.resolve(key.operation === "pull_executions")
    });
    expect(result).toEqual([desired("pull_workflows", 900_000), desired("pull_executions", 3_000_000)]);
  });
});

describe("reconciling what is there against what should be", () => {
  const live = (schedulerId: string, everyMs: number | null): LiveSchedule => ({ schedulerId, everyMs });

  it("adds what is missing and leaves alone what already matches", () => {
    const wanted = desired("pull_workflows", 900_000);
    expect(reconcileSchedules([wanted], [])).toEqual({ upsert: [wanted], remove: [] });
    expect(reconcileSchedules([wanted], [live(wanted.schedulerId, 900_000)])).toEqual({ upsert: [], remove: [] });
  });

  it("rewrites one whose cadence has changed, which is how a circuit opening takes effect", () => {
    const stretched = desired("pull_executions", 3_000_000);
    const plan = reconcileSchedules([stretched], [live(stretched.schedulerId, 300_000)]);
    expect(plan).toEqual({ upsert: [stretched], remove: [] });
  });

  /**
   * The orphan case, and the reason this is reconciliation rather than a call at the moment
   * somebody disables an instance: a removal that depends on a request arriving leaves a ghost
   * the day that request fails. This pass remembers nothing -- it looks at what is there.
   */
  it("removes a schedule that answers to no instance any more", () => {
    const orphan = schedulerIdOf({ tenantId, instanceId, operation: "pull_workflows" });
    expect(reconcileSchedules([], [live(orphan, 900_000)])).toEqual({ upsert: [], remove: [orphan] });
  });

  it("removes every connector schedule when nothing is wanted, which is the flag being off", () => {
    const ids = ["pull_workflows", "pull_executions"].map((operation) =>
      schedulerIdOf({ tenantId, instanceId, operation })
    );
    const plan = reconcileSchedules(
      [],
      ids.map((id) => live(id, 900_000))
    );
    expect(plan.remove).toEqual(ids);
  });

  /**
   * Defensive, and cheap: the connectors queue holds only our schedules today, but a reconciler
   * that deletes whatever it does not recognise is one shared queue away from removing somebody
   * else's repeatable job.
   */
  it("does not touch a schedule that is not one of ours", () => {
    const plan = reconcileSchedules([], [live("support-escalation", 300_000)]);
    expect(plan).toEqual({ upsert: [], remove: [] });
  });
});

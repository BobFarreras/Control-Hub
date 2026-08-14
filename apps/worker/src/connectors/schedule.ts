import type { RegisteredConnector } from "@control-hub/connectors";

/**
 * Which connector operations should be on a schedule right now, and what to do about the
 * difference between that and what Valkey actually holds.
 *
 * This is gap G2 of phase 6: the only operation anything could schedule was the health check, so
 * a connector that pulls had no way to be polled at all. The answer is deliberately a
 * reconciliation rather than a call made at the moment somebody enables or disables an instance.
 * A removal that depends on a request arriving leaves an orphan the day that request fails, and
 * an orphaned schedule is a call to a provider that nobody can explain and nobody can stop. This
 * pass remembers nothing: it reads what is there and makes it match.
 *
 * The decisions here are pure and take no queue, no database and no clock, so the awkward cases
 * -- a connector removed from the registry, a circuit that opened, a flag that closed -- are
 * tested as data rather than by arranging Valkey into the right state.
 *
 * Specification: `docs/specifications/infrastructure.md`, "Programacio i repartiment de cua".
 */

export type ScheduleKey = { tenantId: string; instanceId: string; operation: string };

export type DesiredSchedule = ScheduleKey & { schedulerId: string; everyMs: number };

/** One repeatable job as the queue reports it. `everyMs` is null for schedules set by cron. */
export type LiveSchedule = { schedulerId: string; everyMs: number | null };

export type ReconcilePlan = { upsert: readonly DesiredSchedule[]; remove: readonly string[] };

/**
 * Marks a scheduler as ours.
 *
 * The connectors queue holds nothing else today, but a reconciler that deletes everything it
 * does not recognise is one shared queue away from removing somebody else's repeatable job, and
 * that failure would look like the feature simply stopping.
 */
export const schedulePrefix = "connector";

export function schedulerIdOf(key: ScheduleKey): string {
  return `${schedulePrefix}:${key.tenantId}:${key.instanceId}:${key.operation}`;
}

/**
 * How much an open circuit slows a poll down, and how far that can go.
 *
 * A provider that is down does not recover faster because we ask more often, and every question
 * we put to it is a worker slot taken from an instance that could have answered. The cap exists
 * so that recovery is noticed late rather than never: without it, a daily operation whose circuit
 * opened would next be tried in ten days.
 */
export const openCircuitCadenceFactor = 10;
export const openCircuitCadenceCapMs = 60 * 60 * 1000;

export function cadenceMs(everySeconds: number, circuitOpen: boolean): number {
  const declared = everySeconds * 1000;
  return circuitOpen ? Math.min(declared * openCircuitCadenceFactor, openCircuitCadenceCapMs) : declared;
}

/** An enabled instance, as little of it as the schedule needs to know. */
export type SchedulableInstance = { tenantId: string; id: string; connectorType: string };

export type DesiredSchedulesOptions = {
  instances: readonly SchedulableInstance[];
  registry: { find(type: string): RegisteredConnector | null };
  circuitOpen: (key: ScheduleKey) => Promise<boolean>;
};

/**
 * The schedules that ought to exist, from the manifests and the state of each breaker.
 *
 * An instance whose connector is no longer in the registry contributes nothing. Those rows stay
 * in the database across a release that drops a provider, and scheduling them would produce a job
 * that fails every fifteen minutes with nothing to run.
 */
export async function desiredSchedules(options: DesiredSchedulesOptions): Promise<DesiredSchedule[]> {
  const schedules: DesiredSchedule[] = [];

  for (const instance of options.instances) {
    const connector = options.registry.find(instance.connectorType);
    if (!connector) continue;

    for (const [operation, declaration] of Object.entries(connector.capabilities.operations)) {
      if (declaration.everySeconds === undefined) continue;

      const key = { tenantId: instance.tenantId, instanceId: instance.id, operation };
      // Asked per operation and not per instance: one broken endpoint of a provider must not slow
      // down the reading of the parts that still answer.
      const open = await options.circuitOpen(key);
      schedules.push({ ...key, schedulerId: schedulerIdOf(key), everyMs: cadenceMs(declaration.everySeconds, open) });
    }
  }
  return schedules;
}

/**
 * The difference between what should be scheduled and what is.
 *
 * Rewriting a schedule whose interval changed is how an opening circuit takes effect at all: the
 * breaker is consulted when a job runs, but the interval between jobs is a property of the
 * schedule, so nothing slows down until the schedule itself is replaced.
 */
export function reconcileSchedules(desired: readonly DesiredSchedule[], live: readonly LiveSchedule[]): ReconcilePlan {
  const liveById = new Map(live.map((schedule) => [schedule.schedulerId, schedule]));
  const wanted = new Set(desired.map((schedule) => schedule.schedulerId));

  const upsert = desired.filter((schedule) => liveById.get(schedule.schedulerId)?.everyMs !== schedule.everyMs);
  const remove = live
    .filter((schedule) => schedule.schedulerId.startsWith(`${schedulePrefix}:`) && !wanted.has(schedule.schedulerId))
    .map((schedule) => schedule.schedulerId);

  return { upsert, remove };
}

/**
 * The queue, as little of it as this sweep needs. Structural so the pass can be driven with a
 * double in a unit test and with a real `Queue` in an integration one.
 */
export type ScheduleQueue = {
  getJobSchedulers(): Promise<{ key: string; every?: number | undefined }[]>;
  upsertJobScheduler(
    schedulerId: string,
    repeat: { every: number },
    job: { name: string; data: unknown; opts?: Record<string, unknown> }
  ): Promise<unknown>;
  removeJobScheduler(schedulerId: string): Promise<boolean>;
};

export type ScheduleSweepOptions = {
  queue: ScheduleQueue;
  jobName: string;
  /** Enabled instances of every tenant. Injected so the walk itself can be tested separately. */
  instances: readonly SchedulableInstance[];
  registry: { find(type: string): RegisteredConnector | null };
  circuitOpen: (key: ScheduleKey) => Promise<boolean>;
  /**
   * The `infrastructure` flag. Closed means no schedule survives, not merely that no new one is
   * created: a flag that only stopped future work would leave a provider being polled every five
   * minutes with no way to stop it short of a deploy.
   */
  enabled: boolean;
};

export type ScheduleSweep = { upserted: number; removed: number };

export async function reconcileConnectorSchedules(options: ScheduleSweepOptions): Promise<ScheduleSweep> {
  const desired = options.enabled
    ? await desiredSchedules({
        instances: options.instances,
        registry: options.registry,
        circuitOpen: options.circuitOpen
      })
    : [];

  const live = (await options.queue.getJobSchedulers()).map((scheduler) => ({
    schedulerId: scheduler.key,
    everyMs: scheduler.every ?? null
  }));

  const plan = reconcileSchedules(desired, live);

  for (const schedule of plan.upsert) {
    await options.queue.upsertJobScheduler(
      schedule.schedulerId,
      { every: schedule.everyMs },
      {
        name: options.jobName,
        // No cursor: where the operation got to is the platform's to remember, and a payload
        // written once and repeated forever would pin every pass to the same starting point.
        data: {
          tenantId: schedule.tenantId,
          instanceId: schedule.instanceId,
          operation: schedule.operation,
          cursor: null
        },
        opts: { removeOnComplete: 20, removeOnFail: 20 }
      }
    );
  }
  for (const schedulerId of plan.remove) await options.queue.removeJobScheduler(schedulerId);

  return { upserted: plan.upsert.length, removed: plan.remove.length };
}

/**
 * Every enabled instance of every tenant, which is what the reconciler compares Valkey against.
 *
 * The worker has no session, so it walks the tenants and sets the scope for each one, exactly as
 * the support escalation sweep does. A cross-tenant read would have to bypass row level security,
 * and the only thing in this phase that earns that is the retention purge, which cannot be done
 * per tenant without turning one statement into hundreds.
 *
 * A tenant whose read fails does not stop the others: the schedules of the rest are still worth
 * reconciling, and the next pass in two minutes will try again.
 */
export async function schedulableInstances(options: {
  tenantIds: readonly string[];
  listEnabled: (tenantId: string) => Promise<readonly { id: string; connectorType: string; status: string }[]>;
  onTenantError: (tenantId: string, error: unknown) => void;
}): Promise<SchedulableInstance[]> {
  const instances: SchedulableInstance[] = [];

  for (const tenantId of options.tenantIds) {
    try {
      for (const instance of await options.listEnabled(tenantId)) {
        if (instance.status !== "enabled") continue;
        instances.push({ tenantId, id: instance.id, connectorType: instance.connectorType });
      }
    } catch (error) {
      options.onTenantError(tenantId, error);
    }
  }
  return instances;
}

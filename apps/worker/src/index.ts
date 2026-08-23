import { AlertEngine, UsageService } from "@control-hub/application";
import {
  connectorKeyRingWarning,
  isFeatureEnabled,
  parseFeatureFlags,
  parseWorkerEnvironment
} from "@control-hub/config";
import { connectorRegistry } from "@control-hub/connectors";
import { connectorQueueName, systemQueueName } from "@control-hub/contracts/jobs";
import { createDatabaseClient } from "@control-hub/database";
import { createLogger } from "@control-hub/observability";
import {
  PostgresConnectorRepository,
  PostgresInfrastructureRepository,
  PostgresUsageRepository
} from "@control-hub/persistence";
import { Queue, Worker } from "bullmq";
import Redis from "ioredis";
import { CircuitStore } from "./connectors/circuit-store.js";
import { connectorJobName, jobContext, runConnectorJob } from "./connectors/job.js";
import { purgeConnectorRecords } from "./connectors/purge.js";
import { reconcileConnectorSchedules, schedulableInstances } from "./connectors/schedule.js";
import { createConnectorRuntime } from "./connectors/wiring.js";
import { sweepAlertsAcrossTenants } from "./infrastructure/alert-sweep.js";
import { purgeResolvedAlerts } from "./infrastructure/purge.js";
import { sweepSupportEscalations } from "./support-escalation.js";
import { processSystemJob } from "./system-job.js";
import { UsageRecordIngestor } from "./usage/ingestion.js";

const environment = parseWorkerEnvironment(process.env);
const logger = createLogger("control-hub-worker", environment.LOG_LEVEL);
const connectionUrl = new URL(environment.REDIS_URL);
const connection = {
  host: connectionUrl.hostname,
  port: Number(connectionUrl.port || 6379),
  password: connectionUrl.password || undefined
};
const database = createDatabaseClient(environment.DATABASE_URL);

// Said once here too: the worker is the only process that opens a credential, so a missing ring
// means every connector job will find nothing to open and stop, and this is why.
const keyRingWarning = connectorKeyRingWarning(environment);
if (keyRingWarning) logger.warn(keyRingWarning);

const ESCALATION_JOB = "support-escalation";
const RECORD_PURGE_JOB = "connector-record-purge";
const SCHEDULE_RECONCILE_JOB = "connector-schedule-reconcile";
const ALERT_SWEEP_JOB = "infrastructure-alert-sweep";

// Read once at boot, like every other flag decision in a composition root. Turning the phase
// off is a restart, and a restart is what the reconciler needs anyway to stop scheduling.
const infrastructureEnabled = isFeatureEnabled(parseFeatureFlags(environment.CONTROL_HUB_FLAGS), "infrastructure");
const usageEnabled = isFeatureEnabled(parseFeatureFlags(environment.CONTROL_HUB_FLAGS), "usage_costs");

/**
 * One more connection to Valkey, for the circuit breaker.
 *
 * Not the one BullMQ uses: that client is busy blocking on the queue, and a breaker read waiting
 * behind a `BRPOPLPUSH` would add the queue's latency to every connector call.
 */
const circuitClient = new Redis(environment.REDIS_URL, { maxRetriesPerRequest: 1, connectTimeout: 500 });
circuitClient.on("error", (error) => logger.warn({ err: error }, "circuit breaker store unavailable"));

const connectorRepository = new PostgresConnectorRepository(database);
// The engine, not the service: a sweep has no session behind it, and the service is where the
// permission checks live. Keeping them apart is what stops a background job from satisfying
// one by accident.
const infrastructureRepository = new PostgresInfrastructureRepository(database);
const alertEngine = new AlertEngine(infrastructureRepository);
// One breaker store, shared: the runtime asks it whether to attempt a call and the reconciler
// asks it whether to slow the schedule down. Two stores would be two opinions.
const circuits = new CircuitStore({ client: circuitClient });
const usageIngestor = usageEnabled
  ? new UsageRecordIngestor(new UsageService(new PostgresUsageRepository(database)))
  : undefined;

const connectorRuntime = createConnectorRuntime({
  repository: connectorRepository,
  keyRing: environment.connectorKeyRing,
  allowlist: environment.connectorEgressAllowlist,
  circuits,
  logger,
  ...(usageIngestor ? { usage: usageIngestor } : {})
});

const worker = new Worker(
  systemQueueName,
  async (job) => {
    if (job.name === SCHEDULE_RECONCILE_JOB) return reconcileSchedules();
    if (job.name === RECORD_PURGE_JOB) {
      // The two retentions run together because they are the same hour of the same maintenance,
      // and both are unconditional on the flag: rows written while it was open still have to
      // expire after somebody closes it.
      const records = await purgeConnectorRecords(connectorRepository, logger);
      const alerts = await purgeResolvedAlerts(infrastructureRepository, logger);
      return { ...records, alerts };
    }
    if (job.name === ALERT_SWEEP_JOB) return sweepAlerts();
    if (job.name === ESCALATION_JOB) {
      const sweep = await sweepSupportEscalations(database);
      for (const failure of sweep.failed) {
        logger.error({ tenantId: failure.tenantId, err: failure.error }, "escalation sweep failed for tenant");
      }
      // Logged at info only when it found something: a quiet sweep every few minutes is noise.
      if (sweep.recorded > 0) logger.info(sweep, "recorded service level breaches");
      return sweep;
    }
    logger.info({ jobId: job.id, jobName: job.name }, "processing system job");
    return processSystemJob(job);
  },
  { connection, concurrency: 4 }
);

/**
 * Connector work runs on its own queue, with its own worker and its own concurrency.
 *
 * Every job here waits on somebody else's server. On the shared queue, four instances hanging on
 * a thirty-second budget would hold every slot and the support escalation sweep -- which has a
 * service level attached -- would wait behind a provider nobody here controls. The separation
 * makes that impossible by construction rather than by picking the right concurrency.
 */
const connectorQueue = new Queue(connectorQueueName, { connection });
const connectorWorker = new Worker(
  connectorQueueName,
  async (job) => {
    if (!connectorRuntime) {
      logger.warn({ jobId: job.id }, "connector job skipped: this installation has no key ring");
      return { status: "skipped", reason: "no_key_ring" };
    }
    return runConnectorJob(connectorRuntime, job, usageEnabled);
  },
  { connection, concurrency: 4 }
);

/**
 * Makes the schedules in Valkey match the instances that exist right now.
 *
 * Reconciliation rather than a call at the moment somebody disables an instance: a removal that
 * depends on a request arriving leaves an orphan the day that request fails, and an orphaned
 * schedule is a call to a provider that nobody can explain and nobody can stop.
 */
async function reconcileSchedules() {
  const tenants = await database<{ id: string }[]>`select id from tenants order by created_at asc`;
  const instances = await schedulableInstances({
    tenantIds: tenants.map((tenant) => tenant.id),
    listEnabled: (tenantId) => connectorRepository.listInstances(jobContext(tenantId)),
    onTenantError: (tenantId, error) =>
      logger.error({ tenantId, err: error }, "could not read connector instances for tenant")
  });

  const sweep = await reconcileConnectorSchedules({
    queue: connectorQueue,
    jobName: connectorJobName,
    instances,
    registry: connectorRegistry,
    circuitOpen: async (key) => (await circuits.state(key.tenantId, key.instanceId, key.operation)).state === "open",
    enabled: infrastructureEnabled
  });

  // Silent when it changed nothing, which is what every pass after the first should be.
  if (sweep.upserted > 0 || sweep.removed > 0) logger.info(sweep, "connector schedules reconciled");
  return sweep;
}

/**
 * One pass of the alert engine over every tenant.
 *
 * Recomputed rather than accumulated, exactly like the escalation sweep above it: missing a pass
 * loses nothing because the next one reaches the same conclusion, and running one twice changes
 * nothing because the partial unique index makes the second write an update of the first.
 */
async function sweepAlerts() {
  const sweep = await sweepAlertsAcrossTenants({
    tenantIds: async () =>
      (await database<{ id: string }[]>`select id from tenants order by created_at asc`).map((tenant) => tenant.id),
    sweep: (context, at) => alertEngine.sweep(context, at)
  });

  for (const failure of sweep.failed) {
    logger.error({ tenantId: failure.tenantId, err: failure.error }, "alert sweep failed for tenant");
  }
  // Quiet when nothing changed, which is what every pass over a healthy installation is.
  if (sweep.firing > 0 || sweep.resolved > 0 || sweep.incidentsOpened > 0) logger.info(sweep, "alerts evaluated");
  return sweep;
}

/**
 * The sweep is repeatable rather than driven by a timer in the process. BullMQ keeps one
 * schedule in Valkey, so two worker replicas do not each escalate the same ticket, and a
 * restart does not lose the schedule.
 *
 * Missing a run is harmless: the pass recomputes from the ticket's own history rather than
 * from what happened since last time, and a breach already recorded is skipped.
 */
const queue = new Queue(systemQueueName, { connection });
await queue.upsertJobScheduler(
  ESCALATION_JOB,
  { every: 5 * 60 * 1000 },
  { name: ESCALATION_JOB, opts: { removeOnComplete: 50, removeOnFail: 50 } }
);

/**
 * Hourly, and unconditional on the feature flag: rows written while the flag was open still have
 * to expire after somebody closes it. Retention that stops with the feature is how a table nobody
 * is watching any more becomes the one that fills the disk.
 */
await queue.upsertJobScheduler(
  RECORD_PURGE_JOB,
  { every: 60 * 60 * 1000 },
  { name: RECORD_PURGE_JOB, opts: { removeOnComplete: 24, removeOnFail: 24 } }
);

/**
 * Every two minutes, and unconditional on the flag: with the flag closed the pass still runs and
 * removes what it finds, because a flag that only stopped new schedules would leave the old ones
 * polling with no way to stop them short of a deploy.
 */
await queue.upsertJobScheduler(
  SCHEDULE_RECONCILE_JOB,
  { every: 2 * 60 * 1000 },
  { name: SCHEDULE_RECONCILE_JOB, opts: { removeOnComplete: 20, removeOnFail: 20 } }
);

/**
 * Every two minutes, and only with the flag open: unlike the reconciler, which has orphans to
 * remove whether or not the module is on, an evaluation with no module behind it would write
 * alerts nothing can show and no screen can acknowledge. The schedule the last release left
 * behind is removed on the next line rather than left running.
 */
if (infrastructureEnabled) {
  await queue.upsertJobScheduler(
    ALERT_SWEEP_JOB,
    { every: 2 * 60 * 1000 },
    { name: ALERT_SWEEP_JOB, opts: { removeOnComplete: 30, removeOnFail: 30 } }
  );
} else {
  await queue.removeJobScheduler(ALERT_SWEEP_JOB);
}

for (const [name, instance] of [
  ["system", worker],
  ["connectors", connectorWorker]
] as const) {
  instance.on("failed", (job, error) => logger.error({ queue: name, jobId: job?.id, err: error }, "job failed"));
  instance.on("error", (error) => logger.error({ queue: name, err: error }, "worker error"));
}

const shutdown = async (signal: string) => {
  logger.info({ signal }, "shutdown requested");
  await Promise.all([worker.close(), connectorWorker.close()]);
  await Promise.all([queue.close(), connectorQueue.close()]);
  circuitClient.disconnect();
  await database.end({ timeout: 5 });
  process.exit(0);
};
process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

logger.info(
  {
    queues: [systemQueueName, connectorQueueName],
    scheduled: [
      ESCALATION_JOB,
      RECORD_PURGE_JOB,
      SCHEDULE_RECONCILE_JOB,
      ...(infrastructureEnabled ? [ALERT_SWEEP_JOB] : [])
    ],
    infrastructure: infrastructureEnabled
  },
  "worker ready"
);

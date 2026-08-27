import { AlertEngine, ConnectorSecretReader, SupportMailboxIngestor, UsageService } from "@control-hub/application";
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
  CredentialVault,
  PostgresConnectorActionRepository,
  PostgresConnectorRepository,
  PostgresConnectorOAuthRepository,
  PostgresInfrastructureRepository,
  PostgresSupportMailboxRepository,
  PostgresUsageRepository
} from "@control-hub/persistence";
import { Queue, Worker } from "bullmq";
import Redis from "ioredis";
import { connectorActionJobName, runConnectorActionJob } from "./connectors/action-job.js";
import { CircuitStore } from "./connectors/circuit-store.js";
import { connectorIngressJobName, runConnectorIngressJob } from "./connectors/ingress-job.js";
import { connectorJobName, jobContext, runConnectorJob } from "./connectors/job.js";
import { connectorOAuthExchangeJobName, exchangeConnectorOAuthCode } from "./connectors/oauth-exchange.js";
import { OAuthTokenProvider } from "./connectors/oauth-token-provider.js";
import { purgeConnectorRecords } from "./connectors/purge.js";
import { reconcileConnectorSchedules, schedulableInstances } from "./connectors/schedule.js";
import { createConnectorRuntime } from "./connectors/wiring.js";
import { sweepAlertsAcrossTenants } from "./infrastructure/alert-sweep.js";
import { purgeResolvedAlerts } from "./infrastructure/purge.js";
import { sweepSupportEscalations } from "./support-escalation.js";
import { processSystemJob } from "./system-job.js";
import { runUpdateCheck, updateCheckJobName, valkeyUpdateStore } from "./update-check.js";
import { UsageRecordIngestor } from "./usage/ingestion.js";
import { workerVersion } from "./version.js";

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
const OAUTH_OUTBOX_JOB = "connector-oauth-outbox";
const ACTION_OUTBOX_JOB = "connector-action-outbox";
const UPDATE_CHECK_JOB = updateCheckJobName;

// Read once at boot, like every other flag decision in a composition root. Turning the phase
// off is a restart, and a restart is what the reconciler needs anyway to stop scheduling.
const infrastructureEnabled = isFeatureEnabled(parseFeatureFlags(environment.CONTROL_HUB_FLAGS), "infrastructure");
const usageEnabled = isFeatureEnabled(parseFeatureFlags(environment.CONTROL_HUB_FLAGS), "usage_costs");
const mailEnabled = isFeatureEnabled(parseFeatureFlags(environment.CONTROL_HUB_FLAGS), "mail");
const oauthEnabled = isFeatureEnabled(parseFeatureFlags(environment.CONTROL_HUB_FLAGS), "connector_oauth");
const actionsEnabled = isFeatureEnabled(parseFeatureFlags(environment.CONTROL_HUB_FLAGS), "connector_actions");
const mailConnectorTypes = new Set(["imap", "gmail", "microsoft_graph_mail"]);
// Not a feature flag: this is the one thing this process does that leaves the building, so it is
// its own variable and it is named after what it does. See `docs/runbooks/installation.md`.
const updateCheckEnabled = environment.CONTROL_HUB_UPDATE_CHECK;

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
const mailIngestor = mailEnabled
  ? new SupportMailboxIngestor(new PostgresSupportMailboxRepository(database))
  : undefined;
const oauthRepository = new PostgresConnectorOAuthRepository(database);
const actionRepository = new PostgresConnectorActionRepository(database);
const oauthVault = environment.connectorKeyRing ? new CredentialVault(environment.connectorKeyRing) : null;
const oauthTokens =
  oauthEnabled && oauthVault
    ? new OAuthTokenProvider(
        oauthRepository,
        oauthVault,
        environment.oauthClients,
        new ConnectorSecretReader(connectorRepository, oauthVault)
      )
    : undefined;

const connectorRuntime = createConnectorRuntime({
  repository: connectorRepository,
  keyRing: environment.connectorKeyRing,
  allowlist: environment.connectorEgressAllowlist,
  circuits,
  logger,
  ...(mailIngestor ? { mail: mailIngestor } : {}),
  ...(oauthTokens ? { oauthTokens } : {}),
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
    if (job.name === UPDATE_CHECK_JOB) return checkForUpdate();
    if (job.name === OAUTH_OUTBOX_JOB) return relayOAuthOutbox();
    if (job.name === ACTION_OUTBOX_JOB) return relayActionOutbox();
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
    if (job.name === connectorIngressJobName) {
      return runConnectorIngressJob(connectorRepository, connectorRegistry, usageIngestor, job);
    }
    if (job.name === connectorOAuthExchangeJobName) {
      if (!oauthEnabled || !oauthVault) return { status: "skipped", reason: "oauth_unavailable" };
      const data = job.data as { tenantId?: unknown; attemptId?: unknown; connectorType?: unknown };
      if (
        typeof data.tenantId !== "string" ||
        typeof data.attemptId !== "string" ||
        typeof data.connectorType !== "string"
      )
        throw new Error("OAUTH_JOB_PAYLOAD_INVALID");
      return exchangeConnectorOAuthCode({
        repository: oauthRepository,
        vault: oauthVault,
        clients: environment.oauthClients,
        appOrigin: environment.APP_ORIGIN,
        context: jobContext(data.tenantId),
        attemptId: data.attemptId,
        connectorType: data.connectorType
      });
    }
    if (job.name === connectorActionJobName) {
      if (!actionsEnabled || !connectorRuntime) return { status: "skipped", reason: "actions_unavailable" };
      return runConnectorActionJob(actionRepository, connectorRuntime, job.data);
    }
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
    instances: infrastructureEnabled
      ? instances
      : instances.filter((instance) => mailEnabled && mailConnectorTypes.has(instance.connectorType)),
    registry: connectorRegistry,
    circuitOpen: async (key) => (await circuits.state(key.tenantId, key.instanceId, key.operation)).state === "open",
    enabled: infrastructureEnabled || mailEnabled
  });

  // Silent when it changed nothing, which is what every pass after the first should be.
  if (sweep.upserted > 0 || sweep.removed > 0) logger.info(sweep, "connector schedules reconciled");
  return sweep;
}

async function relayOAuthOutbox() {
  if (!oauthEnabled) return { published: 0 };
  const tenants = await database<{ id: string }[]>`select id from tenants order by created_at asc`;
  let published = 0;
  for (const tenant of tenants) {
    const context = jobContext(tenant.id);
    for (const attemptId of await oauthRepository.pendingOutbox(context)) {
      const attempt = await oauthRepository.exchangeAttempt(context, attemptId);
      if (!attempt) continue;
      const instance = await connectorRepository.getInstance(context, attempt.instanceId);
      if (!instance) continue;
      await connectorQueue.add(
        connectorOAuthExchangeJobName,
        { tenantId: tenant.id, attemptId, connectorType: instance.connectorType },
        { jobId: `oauth-${attemptId}`, attempts: 3, removeOnComplete: 100, removeOnFail: 100 }
      );
      await oauthRepository.markPublished(context, attemptId);
      published += 1;
    }
  }
  return { published };
}

async function relayActionOutbox() {
  if (!actionsEnabled) return { published: 0 };
  const tenants = await database<{ id: string }[]>`select id from tenants order by created_at asc`;
  let published = 0;
  for (const tenant of tenants) {
    const context = jobContext(tenant.id);
    for (const requestId of await actionRepository.pendingOutbox(context)) {
      await connectorQueue.add(
        connectorActionJobName,
        { tenantId: tenant.id, requestId },
        { jobId: `action-${requestId}`, attempts: 1, removeOnComplete: 100, removeOnFail: 100 }
      );
      await actionRepository.markPublished(context, requestId);
      published += 1;
    }
  }
  return { published };
}

/**
 * The daily look at whether a newer version has been published.
 *
 * The store rides on the breaker's connection rather than opening a fifth one. One `GET` and one
 * `SET` a day do not need a client of their own, and this is the connection that is deliberately
 * not the one BullMQ blocks on.
 *
 * Nothing here throws. A check that cannot reach GitHub is not a failed job -- it is a question
 * that will be asked again tomorrow -- and a red job on somebody's queue for an unreachable
 * network is noise that teaches people to ignore red jobs.
 */
async function checkForUpdate() {
  const outcome = await runUpdateCheck({
    version: workerVersion(),
    store: valkeyUpdateStore(circuitClient),
    enabled: updateCheckEnabled
  });
  if (outcome.status === "unreachable") logger.warn(outcome, "could not read the published release manifest");
  if (outcome.status === "available") logger.info(outcome, "a newer version has been published");
  return outcome;
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
await queue.upsertJobScheduler(
  OAUTH_OUTBOX_JOB,
  { every: 60 * 1000 },
  { name: OAUTH_OUTBOX_JOB, opts: { removeOnComplete: 20, removeOnFail: 20 } }
);
await queue.upsertJobScheduler(
  ACTION_OUTBOX_JOB,
  { every: 30 * 1000 },
  { name: ACTION_OUTBOX_JOB, opts: { removeOnComplete: 20, removeOnFail: 20 } }
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

/**
 * Once a day, and removed outright when the variable says no.
 *
 * Removed rather than merely not created, for the same reason as the alert sweep above: a switch
 * that only stopped new schedules would leave the one the last release installed still making the
 * request, and this is the request somebody switched off. `CONTROL_HUB_UPDATE_CHECK=false` has to
 * mean nothing leaves this machine, not «nothing new leaves it».
 *
 * The interval is the schedule's part of «once a day». The other part is in `runUpdateCheck`,
 * which sends no request at all if it finds a recent answer -- so restarts, replicas and manual
 * triggers cannot add up to more than one look a day between them.
 */
if (updateCheckEnabled) {
  await queue.upsertJobScheduler(
    UPDATE_CHECK_JOB,
    { every: 24 * 60 * 60 * 1000 },
    { name: UPDATE_CHECK_JOB, opts: { removeOnComplete: 7, removeOnFail: 7 } }
  );
} else {
  await queue.removeJobScheduler(UPDATE_CHECK_JOB);
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
      OAUTH_OUTBOX_JOB,
      ACTION_OUTBOX_JOB,
      ...(infrastructureEnabled ? [ALERT_SWEEP_JOB] : []),
      ...(updateCheckEnabled ? [UPDATE_CHECK_JOB] : [])
    ],
    infrastructure: infrastructureEnabled,
    mail: mailEnabled,
    oauth: oauthEnabled,
    actions: actionsEnabled,
    // Logged at boot so that «is this installation talking to the internet» is answerable from
    // the first line of the log rather than by reading the configuration.
    updateCheck: updateCheckEnabled
  },
  "worker ready"
);

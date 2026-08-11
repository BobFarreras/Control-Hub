import { connectorKeyRingWarning, parseWorkerEnvironment } from "@control-hub/config";
import { systemQueueName } from "@control-hub/contracts";
import { createDatabaseClient } from "@control-hub/database";
import { createLogger } from "@control-hub/observability";
import { PostgresConnectorRepository } from "@control-hub/persistence";
import { Queue, Worker } from "bullmq";
import Redis from "ioredis";
import { connectorJobName, runConnectorJob } from "./connectors/job.js";
import { createConnectorRuntime } from "./connectors/wiring.js";
import { sweepSupportEscalations } from "./support-escalation.js";
import { processSystemJob } from "./system-job.js";

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

/**
 * One more connection to Valkey, for the circuit breaker.
 *
 * Not the one BullMQ uses: that client is busy blocking on the queue, and a breaker read waiting
 * behind a `BRPOPLPUSH` would add the queue's latency to every connector call.
 */
const circuitClient = new Redis(environment.REDIS_URL, { maxRetriesPerRequest: 1, connectTimeout: 500 });
circuitClient.on("error", (error) => logger.warn({ err: error }, "circuit breaker store unavailable"));

const connectorRuntime = createConnectorRuntime({
  repository: new PostgresConnectorRepository(database),
  keyRing: environment.connectorKeyRing,
  allowlist: environment.connectorEgressAllowlist,
  circuitClient,
  logger
});

const worker = new Worker(
  systemQueueName,
  async (job) => {
    if (job.name === connectorJobName) {
      if (!connectorRuntime) {
        logger.warn({ jobId: job.id }, "connector job skipped: this installation has no key ring");
        return { status: "skipped", reason: "no_key_ring" };
      }
      return runConnectorJob(connectorRuntime, job);
    }
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

worker.on("failed", (job, error) => logger.error({ jobId: job?.id, err: error }, "job failed"));
worker.on("error", (error) => logger.error({ err: error }, "worker error"));

const shutdown = async (signal: string) => {
  logger.info({ signal }, "shutdown requested");
  await worker.close();
  await queue.close();
  circuitClient.disconnect();
  await database.end({ timeout: 5 });
  process.exit(0);
};
process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

logger.info({ queue: systemQueueName, scheduled: ESCALATION_JOB }, "worker ready");

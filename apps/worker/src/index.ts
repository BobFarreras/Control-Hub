import { connectorKeyRingWarning, parseWorkerEnvironment } from "@control-hub/config";
import { createDatabaseClient } from "@control-hub/database";
import { createLogger } from "@control-hub/observability";
import { Queue, Worker } from "bullmq";
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

const worker = new Worker(
  "control-hub-system",
  async (job) => {
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
const queue = new Queue("control-hub-system", { connection });
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
  await database.end({ timeout: 5 });
  process.exit(0);
};
process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

logger.info({ queue: "control-hub-system", scheduled: ESCALATION_JOB }, "worker ready");

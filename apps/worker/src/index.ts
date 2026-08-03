import { parseWorkerEnvironment } from "@control-hub/config";
import { createLogger } from "@control-hub/observability";
import { Worker } from "bullmq";
import { processSystemJob } from "./system-job.js";

const environment = parseWorkerEnvironment(process.env);
const logger = createLogger("control-hub-worker", environment.LOG_LEVEL);
const connection = new URL(environment.REDIS_URL);
const worker = new Worker(
  "control-hub-system",
  async (job) => {
    logger.info({ jobId: job.id, jobName: job.name }, "processing system job");
    return processSystemJob(job);
  },
  {
    connection: {
      host: connection.hostname,
      port: Number(connection.port || 6379),
      password: connection.password || undefined
    },
    concurrency: 4
  }
);

worker.on("failed", (job, error) => logger.error({ jobId: job?.id, err: error }, "job failed"));
worker.on("error", (error) => logger.error({ err: error }, "worker error"));

const shutdown = async (signal: string) => {
  logger.info({ signal }, "shutdown requested");
  await worker.close();
  process.exit(0);
};
process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

logger.info({ queue: "control-hub-system" }, "worker ready");

import { Queue, QueueEvents, Worker } from "bullmq";
import { afterEach, describe, expect, it } from "vitest";
import { processSystemJob } from "./system-job.js";

const resources: Array<{ close(): Promise<void> }> = [];
afterEach(async () => Promise.all(resources.splice(0).map((resource) => resource.close())));

describe("system queue", () => {
  it("processes a uniquely identified job exactly once", async () => {
    const connection = { host: "127.0.0.1", port: 6379 };
    const queueName = `control-hub-system-integration-${process.pid}-${Date.now()}`;
    const queue = new Queue(queueName, { connection });
    const queueEvents = new QueueEvents(queueName, { connection });
    const worker = new Worker(queueName, processSystemJob, { connection });
    resources.push(worker, queueEvents, queue);

    await Promise.all([queue.waitUntilReady(), queueEvents.waitUntilReady(), worker.waitUntilReady()]);
    const job = await queue.add("health-probe", {}, { jobId: "phase-1-once", attempts: 1, removeOnComplete: false });
    const result = await job.waitUntilFinished(queueEvents, 10_000);
    const completedJob = await queue.getJob(job.id!);

    expect(result).toHaveProperty("processedAt");
    expect(await completedJob?.getState()).toBe("completed");
    expect(completedJob?.attemptsMade).toBe(1);
    await expect(queue.add("health-probe", {}, { jobId: "phase-1-once" })).resolves.toMatchObject({
      id: "phase-1-once"
    });
    await expect(queue.getJobCounts("completed")).resolves.toEqual({ completed: 1 });
  });
});

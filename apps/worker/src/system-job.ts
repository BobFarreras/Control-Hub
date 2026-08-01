import type { Job } from "bullmq";

export type SystemJobResult = { processedAt: string };

export async function processSystemJob(_job: Job): Promise<SystemJobResult> {
  return { processedAt: new Date().toISOString() };
}

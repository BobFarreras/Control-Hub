import type { Job } from "bullmq";

export type SystemJobResult = { processedAt: string };

export function processSystemJob(_job: Job): Promise<SystemJobResult> {
  return Promise.resolve({ processedAt: new Date().toISOString() });
}

import type { ConnectorRepository, PurgeRecordsResult } from "@control-hub/application";

/**
 * Retention for what connectors pulled.
 *
 * A table that grows with every poll and that nobody cleans is technical debt that only becomes
 * visible on the day it is too large to fix quietly, so the sweep ships in the same increment as
 * the store it cleans rather than in a later one somebody has to remember.
 *
 * The two shapes expire for different reasons and that is the whole design: a `state` row is the
 * provider's current answer about a thing, so it expires when the provider stops naming the
 * thing; an `event` row is a fact that never comes back, so it expires by age.
 *
 * Specification: docs/specifications/infrastructure.md, decision 4.
 */

/**
 * Chosen before anybody had a month of real traffic, which is exactly why they live here and not
 * in the schema: revising them costs a release, not a migration. If the ceiling turns out to be
 * low, what says so is `RECORDS_TRIMMED` in the logs rather than a table nobody looked at.
 */
export const recordRetention = {
  stateDays: 30,
  eventDays: 90,
  maxPerOperation: 20_000,
  /** One pass deletes at most this many rows of each kind, so it cannot hold a long lock. */
  batchLimit: 5_000
} as const;

export type PurgeLogger = {
  info(fields: Record<string, unknown>, message: string): void;
  warn(fields: Record<string, unknown>, message: string): void;
};

const dayMs = 24 * 60 * 60 * 1000;

export async function purgeConnectorRecords(
  repository: ConnectorRepository,
  logger: PurgeLogger,
  now = new Date()
): Promise<PurgeRecordsResult> {
  const result = await repository.purgeRecords({
    stateBefore: new Date(now.getTime() - recordRetention.stateDays * dayMs),
    eventBefore: new Date(now.getTime() - recordRetention.eventDays * dayMs),
    maxPerOperation: recordRetention.maxPerOperation,
    batchLimit: recordRetention.batchLimit
  });

  // Expiry is routine and says nothing; hitting the ceiling is a provider sending more than we
  // understood, and it has to be loud enough to notice before the data that matters is the part
  // being dropped.
  if (result.trimmed > 0) {
    logger.warn({ ...result, maxPerOperation: recordRetention.maxPerOperation }, "RECORDS_TRIMMED");
  } else if (result.purged > 0) {
    logger.info(result, "expired connector records removed");
  }
  return result;
}

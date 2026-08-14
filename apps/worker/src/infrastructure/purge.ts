import type { PurgeLogger } from "../connectors/purge.js";

/**
 * Retention for alerts that have been resolved.
 *
 * Only the resolved ones: a firing alert has no age at which it stops mattering, and one that
 * disappeared because it had been firing for six months would be the worst possible way to find
 * out the table had a retention policy.
 *
 * The window is here and not in the schema for the same reason as `recordRetention`: it was
 * chosen before anybody had a year of real alerts, and revising it should cost a release rather
 * than a migration.
 *
 * Specification: `docs/specifications/infrastructure.md`.
 */
export const alertRetention = {
  resolvedDays: 180,
  /** One pass deletes at most this many rows, so it cannot hold a long lock. */
  batchLimit: 5_000
} as const;

/** The one method of the port this needs. Narrow on purpose: the pass has no tenant and no read. */
export type AlertPurgeRepository = {
  purgeAlertEvents(input: { resolvedBefore: Date; batchLimit: number }): Promise<number>;
};

const dayMs = 24 * 60 * 60 * 1000;

export async function purgeResolvedAlerts(
  repository: AlertPurgeRepository,
  logger: PurgeLogger,
  now = new Date()
): Promise<number> {
  const purged = await repository.purgeAlertEvents({
    resolvedBefore: new Date(now.getTime() - alertRetention.resolvedDays * dayMs),
    batchLimit: alertRetention.batchLimit
  });

  // Silent when it found nothing, which is most hours. An hourly line saying zero is how a log
  // stops being read.
  if (purged > 0) logger.info({ purged }, "expired alert events removed");
  return purged;
}

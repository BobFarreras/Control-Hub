import type { AlertSweepResult } from "@control-hub/application";
import type { TenantContext } from "@control-hub/domain";

/**
 * One pass of the alert engine over every tenant.
 *
 * The worker has no session, so it cannot resolve a tenant from a request the way the API does:
 * it walks them itself and scopes each pass. The context it builds carries no membership and no
 * permissions, which is the guarantee that the pass can write nothing a person could not have.
 *
 * The dependencies are arguments rather than imports so that the awkward parts -- one tenant
 * throwing, a clock that must not move mid-run, an installation with no tenants at all -- are
 * tested as data instead of by arranging a database and a queue into the right state.
 *
 * Specification: `docs/specifications/infrastructure.md`, "Avaluacio de regles i alertes".
 */

export type AlertSweepDeps = {
  tenantIds: () => Promise<readonly string[]>;
  sweep: (context: TenantContext, at: Date) => Promise<AlertSweepResult>;
};

export type AlertSweep = AlertSweepResult & {
  tenants: number;
  /** Tenants whose pass threw, so the caller can log them without losing the rest of the run. */
  failed: { tenantId: string; error: unknown }[];
};

/** A tenant-scoped context for work nobody requested. There is no actor to attribute it to. */
function automatedContext(tenantId: string): TenantContext {
  return { tenantId, membershipId: "", userId: "", roles: [], permissions: [], mfaEnabled: true };
}

export async function sweepAlertsAcrossTenants(deps: AlertSweepDeps, now = new Date()): Promise<AlertSweep> {
  const tenantIds = await deps.tenantIds();
  const total: AlertSweep = {
    tenants: tenantIds.length,
    firing: 0,
    resolved: 0,
    starved: 0,
    incidentsOpened: 0,
    failed: []
  };

  for (const tenantId of tenantIds) {
    try {
      // The same instant for every tenant: a pass that took a minute would otherwise judge the
      // last tenant's freshness against a clock the first one never saw.
      const result = await deps.sweep(automatedContext(tenantId), now);
      total.firing += result.firing;
      total.resolved += result.resolved;
      total.starved += result.starved;
      total.incidentsOpened += result.incidentsOpened;
    } catch (error) {
      total.failed.push({ tenantId, error });
    }
  }

  return total;
}

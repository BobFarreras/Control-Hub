import { escalateBreachedTargets, type EscalationResult } from "@control-hub/application";
import type { DatabaseClient } from "@control-hub/database";
import type { TenantContext } from "@control-hub/domain";
import { PostgresSupportRepository } from "@control-hub/persistence";

/**
 * Sweeps every tenant for service level targets that have been missed.
 *
 * The worker has no session, so it cannot resolve a tenant from a request the way the API
 * does. It walks the tenants itself and sets the scope for each one, which is also why the
 * pass must never write anything a user could not have written: the context it builds carries
 * no membership and no permissions.
 */
export type EscalationSweep = {
  tenants: number;
  checked: number;
  recorded: number;
  /** Tenants whose pass threw, so the caller can log them without losing the rest of the run. */
  failed: { tenantId: string; error: unknown }[];
};

/** A tenant-scoped context for work nobody requested. There is no actor to attribute it to. */
function automatedContext(tenantId: string): TenantContext {
  return {
    tenantId,
    membershipId: "",
    userId: "",
    roles: [],
    permissions: [],
    mfaEnabled: true
  };
}

export async function sweepSupportEscalations(database: DatabaseClient, now = new Date()): Promise<EscalationSweep> {
  const repository = new PostgresSupportRepository(database);
  const tenants = await database<{ id: string }[]>`select id from tenants order by created_at asc`;

  let checked = 0;
  let recorded = 0;
  const failed: EscalationSweep["failed"] = [];

  for (const tenant of tenants) {
    // One tenant failing must not stop the rest. A fresh installation with no schedule yet is
    // an ordinary state, not a reason to leave every other tenant unswept.
    try {
      const result: EscalationResult = await escalateBreachedTargets(repository, automatedContext(tenant.id), now);
      checked += result.checked;
      recorded += result.recorded.length;
    } catch (error) {
      failed.push({ tenantId: tenant.id, error });
    }
  }
  return { tenants: tenants.length, checked, recorded, failed };
}

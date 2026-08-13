import type { AlertSweepResult } from "@control-hub/application";
import type { TenantContext } from "@control-hub/domain";
import { describe, expect, it } from "vitest";
import { sweepAlertsAcrossTenants, type AlertSweepDeps } from "./alert-sweep.js";

const quiet: AlertSweepResult = { firing: 0, resolved: 0, starved: 0, incidentsOpened: 0 };

function deps(overrides: Partial<AlertSweepDeps> = {}): AlertSweepDeps {
  return {
    tenantIds: () => Promise.resolve(["t-1", "t-2"]),
    sweep: () => Promise.resolve(quiet),
    ...overrides
  };
}

describe("sweeping every tenant for alerts", () => {
  it("adds up what the passes found, and says how many tenants it walked", async () => {
    const result = await sweepAlertsAcrossTenants(
      deps({
        sweep: () => Promise.resolve({ firing: 2, resolved: 1, starved: 3, incidentsOpened: 1 })
      }),
      new Date()
    );

    expect(result).toMatchObject({
      tenants: 2,
      firing: 4,
      resolved: 2,
      starved: 6,
      incidentsOpened: 2,
      failed: []
    });
  });

  /**
   * One tenant failing must not stop the rest. A provider outage, a rule pointing at an instance
   * somebody deleted, a lock held too long: none of them is a reason to leave every other tenant
   * unswept for two minutes.
   */
  it("keeps going when one tenant throws, and hands the failure back to be logged", async () => {
    const boom = new Error("connection reset");
    const result = await sweepAlertsAcrossTenants(
      deps({
        tenantIds: () => Promise.resolve(["t-1", "t-2", "t-3"]),
        sweep: (context: TenantContext) => {
          if (context.tenantId === "t-2") throw boom;
          return Promise.resolve({ firing: 1, resolved: 0, starved: 0, incidentsOpened: 0 });
        }
      }),
      new Date()
    );

    expect(result.firing).toBe(2);
    expect(result.failed).toEqual([{ tenantId: "t-2", error: boom }]);
  });

  /** The context carries no membership and no permissions: nobody asked for this work. */
  it("runs under a context that could not have written anything a person could not", async () => {
    const seen: TenantContext[] = [];
    await sweepAlertsAcrossTenants(
      deps({
        tenantIds: () => Promise.resolve(["t-1"]),
        sweep: (context: TenantContext) => {
          seen.push(context);
          return Promise.resolve(quiet);
        }
      }),
      new Date()
    );

    expect(seen).toEqual([
      { tenantId: "t-1", membershipId: "", userId: "", roles: [], permissions: [], mfaEnabled: true }
    ]);
  });

  it("passes one instant to every tenant, so a slow pass cannot move the window under it", async () => {
    const now = new Date("2026-08-13T12:00:00.000Z");
    const instants: Date[] = [];
    await sweepAlertsAcrossTenants(
      deps({
        sweep: (_context: TenantContext, at: Date) => {
          instants.push(at);
          return Promise.resolve(quiet);
        }
      }),
      now
    );

    expect(instants).toEqual([now, now]);
  });

  it("does nothing at all on an installation with no tenants", async () => {
    const result = await sweepAlertsAcrossTenants(deps({ tenantIds: () => Promise.resolve([]) }), new Date());
    expect(result).toEqual({ tenants: 0, firing: 0, resolved: 0, starved: 0, incidentsOpened: 0, failed: [] });
  });
});

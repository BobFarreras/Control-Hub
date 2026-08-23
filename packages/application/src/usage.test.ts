import type { TenantContext } from "@control-hub/domain";
import { describe, expect, it, vi } from "vitest";
import { UsageService, type UsageRepository } from "./usage.js";

const repository = (): UsageRepository => ({
  ensureConnectorSource: vi.fn(),
  completeSource: vi.fn(),
  ingestEvent: vi.fn(),
  listEvents: vi.fn().mockResolvedValue([]),
  listCosts: vi.fn().mockResolvedValue([]),
  createRate: vi.fn(),
  createBudget: vi.fn()
});

const context = (permissions: TenantContext["permissions"]): TenantContext => ({
  tenantId: "tenant-a",
  membershipId: "member-a",
  userId: "user-a",
  roles: ["technical"],
  permissions,
  mfaEnabled: true
});

describe("UsageService permissions", () => {
  it("lets Technical read quantities but denies costs even when an event id is known", async () => {
    const port = repository();
    const service = new UsageService(port);
    await expect(service.listEvents(context(["usage:read"]), { eventId: "known-event" })).resolves.toEqual([]);
    expect(() => service.listCosts(context(["usage:read"]), { eventId: "known-event" })).toThrow(
      expect.objectContaining({ code: "FORBIDDEN" })
    );
    expect(port.listCosts).not.toHaveBeenCalled();
  });

  it("keeps rate publication and budget management as separate authorities", () => {
    const service = new UsageService(repository());
    expect(() => service.createRate(context(["budgets:manage"]), {} as never)).toThrow(
      expect.objectContaining({ code: "FORBIDDEN" })
    );
    expect(() => service.createBudget(context(["usage:manage"]), {} as never)).toThrow(
      expect.objectContaining({ code: "FORBIDDEN" })
    );
  });
});

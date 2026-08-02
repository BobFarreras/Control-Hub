import { describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@control-hub/domain";
import { CommerceService, type CommerceRepository } from "./commerce.js";

const context = { tenantId: "tenant", membershipId: "member", userId: "user", roles: ["owner"], permissions: ["financials:read"], mfaEnabled: true } as TenantContext;

describe("CommerceService", () => {
  it("keeps currencies separate in financial summaries", async () => {
    const repository = { financialInputs: vi.fn().mockResolvedValue([
      { currency: "EUR", amountMinor: 1000, costMinor: 200, interval: "monthly", quantity: 2 },
      { currency: "USD", amountMinor: 12000, costMinor: 3000, interval: "annual", quantity: 1 }
    ]) } as unknown as CommerceRepository;
    await expect(new CommerceService(repository).financialSummary(context)).resolves.toEqual([
      { currency: "EUR", mrrMinor: 2000, arrMinor: 24000, annualCostMinor: 4800, annualMarginMinor: 19200, activeSubscriptions: 1 },
      { currency: "USD", mrrMinor: 1000, arrMinor: 12000, annualCostMinor: 3000, annualMarginMinor: 9000, activeSubscriptions: 1 }
    ]);
  });

  it("rejects free plans with a non-zero price", () => {
    const service = new CommerceService({} as CommerceRepository);
    expect(() => service.createPrice(context, "plan", { currency: "EUR", amountMinor: 1, costMinor: 0, taxBasisPoints: 0, interval: "free" })).toThrow("INVALID_INPUT");
  });

  it("rounds MRR after aggregating annual value per currency", async () => {
    const repository = { financialInputs: vi.fn().mockResolvedValue([{ currency: "EUR", amountMinor: 6, costMinor: 0, interval: "annual", quantity: 1 }, { currency: "EUR", amountMinor: 6, costMinor: 0, interval: "annual", quantity: 1 }]) } as unknown as CommerceRepository;
    expect((await new CommerceService(repository).financialSummary(context))[0]?.mrrMinor).toBe(1);
  });
});

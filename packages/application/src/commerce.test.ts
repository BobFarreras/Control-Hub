import type { TenantContext } from "@control-hub/domain";
import { describe, expect, it, vi } from "vitest";
import { CommerceService, type CommerceRepository } from "./commerce.js";

const context = {
  tenantId: "tenant",
  membershipId: "member",
  userId: "user",
  roles: ["owner"],
  permissions: ["financials:read"],
  mfaEnabled: true
} as TenantContext;

describe("CommerceService", () => {
  it("validates and normalizes a complete product offering before the atomic repository call", async () => {
    const createProductOffer = vi.fn().mockResolvedValue({});
    const service = new CommerceService({ createProductOffer } as unknown as CommerceRepository);
    await service.createProductOffer(context, {
      product: { code: " AGENT-WHATSAPP ", name: " Agent WhatsApp " },
      version: { version: " 1.0 " },
      plan: { code: " PRO-MONTHLY ", name: " Pro ", commercialModel: "subscription" },
      price: { currency: "eur", amountMinor: 4900, costMinor: 900, taxBasisPoints: 2100, interval: "monthly" }
    });

    expect(createProductOffer).toHaveBeenCalledWith(
      context,
      expect.objectContaining({
        product: { code: "agent-whatsapp", name: "Agent WhatsApp" },
        version: expect.objectContaining({ version: "1.0", releasedAt: expect.any(Date) }),
        plan: { code: "pro-monthly", name: "Pro", commercialModel: "subscription" },
        price: expect.objectContaining({ currency: "EUR", effectiveFrom: expect.any(Date) })
      })
    );
  });

  it("rejects an invalid price before creating any part of an offering", () => {
    const createProductOffer = vi.fn();
    const service = new CommerceService({ createProductOffer } as unknown as CommerceRepository);
    expect(() =>
      service.createProductOffer(context, {
        product: { code: "agent-whatsapp", name: "Agent WhatsApp" },
        version: { version: "1.0" },
        plan: { code: "pro-monthly", name: "Pro", commercialModel: "subscription" },
        price: { currency: "EUR", amountMinor: 1, costMinor: 0, taxBasisPoints: 0, interval: "free" }
      })
    ).toThrow("INVALID_INPUT");
    expect(createProductOffer).not.toHaveBeenCalled();
  });

  it("rejects recurring prices for one-time commercial models", () => {
    const createProductOffer = vi.fn();
    const service = new CommerceService({ createProductOffer } as unknown as CommerceRepository);
    expect(() =>
      service.createProductOffer(context, {
        product: { code: "custom-project", name: "Custom project" },
        version: { version: "1.0" },
        plan: { code: "project-base", name: "Base", commercialModel: "project_service" },
        price: { currency: "EUR", amountMinor: 10000, costMinor: 0, taxBasisPoints: 0, interval: "monthly" }
      })
    ).toThrow("INVALID_INPUT");
    expect(createProductOffer).not.toHaveBeenCalled();
  });

  it("keeps currencies separate in financial summaries", async () => {
    const repository = {
      financialInputs: vi.fn().mockResolvedValue([
        { currency: "EUR", amountMinor: 1000, costMinor: 200, interval: "monthly", quantity: 2 },
        { currency: "USD", amountMinor: 12000, costMinor: 3000, interval: "annual", quantity: 1 }
      ])
    } as unknown as CommerceRepository;
    await expect(new CommerceService(repository).financialSummary(context)).resolves.toEqual([
      {
        currency: "EUR",
        mrrMinor: 2000,
        arrMinor: 24000,
        annualCostMinor: 4800,
        annualMarginMinor: 19200,
        activeSubscriptions: 1
      },
      {
        currency: "USD",
        mrrMinor: 1000,
        arrMinor: 12000,
        annualCostMinor: 3000,
        annualMarginMinor: 9000,
        activeSubscriptions: 1
      }
    ]);
  });

  it("rejects free plans with a non-zero price", () => {
    const service = new CommerceService({} as CommerceRepository);
    expect(() =>
      service.createPrice(context, "plan", {
        currency: "EUR",
        amountMinor: 1,
        costMinor: 0,
        taxBasisPoints: 0,
        interval: "free"
      })
    ).toThrow("INVALID_INPUT");
  });

  it("rounds MRR after aggregating annual value per currency", async () => {
    const repository = {
      financialInputs: vi.fn().mockResolvedValue([
        { currency: "EUR", amountMinor: 6, costMinor: 0, interval: "annual", quantity: 1 },
        { currency: "EUR", amountMinor: 6, costMinor: 0, interval: "annual", quantity: 1 }
      ])
    } as unknown as CommerceRepository;
    expect((await new CommerceService(repository).financialSummary(context))[0]?.mrrMinor).toBe(1);
  });
});

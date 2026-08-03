import { describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@control-hub/domain";
import { CompanySubscriptionError, CompanySubscriptionService, type CompanySubscriptionRepository } from "./company-subscriptions.js";

const context: TenantContext = { tenantId: "tenant", membershipId: "member", userId: "user", roles: ["owner"], permissions: ["subscriptions:manage"], mfaEnabled: true };
const valid = { provider: "OpenAI", serviceName: "API", category: "api" as const, status: "active" as const, currency: "eur", amountMinor: 2500, interval: "monthly" as const, renewalAt: null, renewalAlertDays: 14, autoRenew: true, websiteUrl: "https://platform.openai.com", notes: null };

describe("CompanySubscriptionService", () => {
  it("normalizes provider and currency before persistence", async () => { const create = vi.fn().mockImplementation(async (_context, input) => ({ id: "id", ...input, createdAt: new Date(), updatedAt: new Date() })); const service = new CompanySubscriptionService({ create } as unknown as CompanySubscriptionRepository); await service.create(context, { ...valid, provider: " OpenAI " }); expect(create).toHaveBeenCalledWith(context, expect.objectContaining({ provider: "OpenAI", currency: "EUR" })); });
  it("rejects non-https management URLs to constrain external navigation", () => { const service = new CompanySubscriptionService({} as CompanySubscriptionRepository); expect(() => service.create(context, { ...valid, websiteUrl: "http://internal.local" })).toThrowError(expect.objectContaining({ code: "INVALID_INPUT" } satisfies Partial<CompanySubscriptionError>)); });
  it("rejects unsafe monetary values", () => { const service = new CompanySubscriptionService({} as CompanySubscriptionRepository); expect(() => service.create(context, { ...valid, amountMinor: Number.MAX_SAFE_INTEGER + 1 })).toThrow(CompanySubscriptionError); });
});

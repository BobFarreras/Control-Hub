import type { TenantContext } from "@control-hub/domain";
import { describe, expect, it, vi } from "vitest";
import {
  CompanySubscriptionError,
  CompanySubscriptionService,
  type CompanySubscriptionRepository
} from "./company-subscriptions.js";

const context: TenantContext = {
  tenantId: "tenant",
  membershipId: "member",
  userId: "user",
  roles: ["owner"],
  permissions: ["subscriptions:manage"],
  mfaEnabled: true
};
const valid = {
  provider: "OpenAI",
  serviceName: "API",
  category: "api" as const,
  status: "active" as const,
  currency: "eur",
  amountMinor: 2500,
  interval: "monthly" as const,
  renewalAt: null,
  renewalAlertDays: 14,
  autoRenew: true,
  websiteUrl: "https://platform.openai.com",
  notes: null
};

describe("CompanySubscriptionService", () => {
  it("normalizes provider and currency before persistence", async () => {
    const create = vi.fn<CompanySubscriptionRepository["create"]>().mockImplementation((_context, input) =>
      Promise.resolve({
        id: "id",
        ...input,
        accountEmail: input.accountEmail ?? null,
        ownerMembershipId: input.ownerMembershipId ?? null,
        ownerName: null,
        quantity: input.quantity ?? 1,
        startedAt: input.startedAt ?? null,
        trialEndsAt: input.trialEndsAt ?? null,
        cancelBeforeAt: input.cancelBeforeAt ?? null,
        canceledAt: null,
        costCenter: input.costCenter ?? null,
        paymentMethodLabel: input.paymentMethodLabel ?? null,
        secretManagerUrl: input.secretManagerUrl ?? null,
        createdAt: new Date(),
        updatedAt: new Date()
      })
    );
    const service = new CompanySubscriptionService({ create } as unknown as CompanySubscriptionRepository);
    await service.create(context, { ...valid, provider: " OpenAI " });
    expect(create).toHaveBeenCalledWith(context, expect.objectContaining({ provider: "OpenAI", currency: "EUR" }));
  });
  it("rejects non-https management URLs to constrain external navigation", () => {
    const service = new CompanySubscriptionService({} as CompanySubscriptionRepository);
    expect(() => service.create(context, { ...valid, websiteUrl: "http://internal.local" })).toThrowError(
      expect.objectContaining({ code: "INVALID_INPUT" } satisfies Partial<CompanySubscriptionError>)
    );
  });
  it("rejects unsafe monetary values", () => {
    const service = new CompanySubscriptionService({} as CompanySubscriptionRepository);
    expect(() => service.create(context, { ...valid, amountMinor: Number.MAX_SAFE_INTEGER + 1 })).toThrow(
      CompanySubscriptionError
    );
  });
  it("does not allow creating an already canceled or paused expense", () => {
    const service = new CompanySubscriptionService({} as CompanySubscriptionRepository);
    expect(() => service.create(context, { ...valid, status: "canceled" })).toThrowError(
      expect.objectContaining({ code: "INVALID_INPUT" } satisfies Partial<CompanySubscriptionError>)
    );
  });
  it("maps a pause action to a guarded repository transition", async () => {
    const subscription = {
      id: "subscription",
      ...valid,
      currency: "EUR",
      accountEmail: null,
      ownerMembershipId: null,
      ownerName: null,
      quantity: 1,
      startedAt: null,
      trialEndsAt: null,
      cancelBeforeAt: null,
      canceledAt: null,
      costCenter: null,
      paymentMethodLabel: null,
      secretManagerUrl: null,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    const transition = vi.fn<CompanySubscriptionRepository["transition"]>().mockResolvedValue({
      ...subscription,
      status: "paused"
    });
    const service = new CompanySubscriptionService({
      getById: vi.fn().mockResolvedValue(subscription),
      transition
    } as unknown as CompanySubscriptionRepository);
    const effectiveAt = new Date();
    await service.transition(context, { subscriptionId: subscription.id, action: "pause", effectiveAt });
    expect(transition).toHaveBeenCalledWith(context, {
      subscriptionId: subscription.id,
      action: "pause",
      effectiveAt,
      expectedStatus: "active",
      targetStatus: "paused",
      eventType: "paused"
    });
  });
  it("requires a reason to cancel and rejects terminal transitions", async () => {
    const service = new CompanySubscriptionService({} as CompanySubscriptionRepository);
    await expect(
      service.transition(context, {
        subscriptionId: "subscription",
        action: "cancel",
        effectiveAt: new Date()
      })
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
});

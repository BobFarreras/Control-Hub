import type { CompanySubscriptionRecord } from "@control-hub/application";
import { describe, expect, it } from "vitest";
import { companySubscriptionResponse } from "./company-subscriptions.js";

const subscription: CompanySubscriptionRecord = {
  id: "subscription",
  provider: "OpenAI",
  serviceName: "API",
  category: "api",
  status: "active",
  currency: "EUR",
  amountMinor: 2500,
  interval: "monthly",
  renewalAt: null,
  renewalAlertDays: 14,
  autoRenew: true,
  websiteUrl: "https://platform.openai.com",
  notes: null,
  accountEmail: "admin@example.test",
  ownerMembershipId: null,
  ownerName: null,
  quantity: 1,
  startedAt: null,
  trialEndsAt: null,
  cancelBeforeAt: null,
  canceledAt: null,
  costCenter: "OPS",
  paymentMethodLabel: "Visa ···· 4242",
  secretManagerUrl: "https://vault.example.test/items/openai",
  createdAt: new Date(),
  updatedAt: new Date()
};

describe("companySubscriptionResponse", () => {
  it("omits all financial fields without financial read permission", () => {
    const response = companySubscriptionResponse(subscription, false);
    expect(response).not.toHaveProperty("amountMinor");
    expect(response).not.toHaveProperty("currency");
    expect(response).not.toHaveProperty("interval");
    expect(response).not.toHaveProperty("financials");
    expect(response).toMatchObject({ id: subscription.id, accountEmail: "admin@example.test" });
  });

  it("groups financial values when permission is present", () => {
    expect(companySubscriptionResponse(subscription, true)).toMatchObject({
      financials: { amountMinor: 2500, currency: "EUR", interval: "monthly" }
    });
  });
});

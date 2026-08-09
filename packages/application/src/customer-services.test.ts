import type { TenantContext } from "@control-hub/domain";
import { describe, expect, it, vi } from "vitest";
import { CustomerServicesService, type CustomerServicesRepository } from "./customer-services.js";

const context = {
  tenantId: "tenant",
  membershipId: "member",
  userId: "user",
  roles: ["owner"],
  permissions: ["subscriptions:manage"],
  mfaEnabled: true
} as TenantContext;

const baseInput = {
  customerId: "customer",
  planId: "plan",
  priceId: "price",
  quantity: 1,
  contractedAt: new Date("2026-08-09T09:00:00.000Z"),
  startsAt: new Date("2026-08-10T09:00:00.000Z")
};

describe("CustomerServicesService", () => {
  it("adds recurrence defaults to subscriptions before the atomic repository call", async () => {
    const repository = {
      resolveOffering: vi.fn().mockResolvedValue({ commercialModel: "subscription", interval: "monthly" }),
      create: vi.fn().mockResolvedValue({ id: "service" })
    } as unknown as CustomerServicesRepository;
    await new CustomerServicesService(repository).create(context, baseInput);
    expect(repository.create).toHaveBeenCalledWith(context, {
      ...baseInput,
      currentPeriodStart: baseInput.startsAt,
      autoRenew: false,
      renewalAlertDays: 14
    });
  });

  it("rejects recurrence fields for a one-time purchase", async () => {
    const repository = {
      resolveOffering: vi.fn().mockResolvedValue({ commercialModel: "one_time", interval: "one_time" }),
      create: vi.fn()
    } as unknown as CustomerServicesRepository;
    await expect(
      new CustomerServicesService(repository).create(context, { ...baseInput, autoRenew: true })
    ).rejects.toThrow("INVALID_INPUT");
    expect(repository.create).not.toHaveBeenCalled();
  });

  it("rejects an end before the service starts", async () => {
    const repository = { resolveOffering: vi.fn(), create: vi.fn() } as unknown as CustomerServicesRepository;
    await expect(
      new CustomerServicesService(repository).create(context, {
        ...baseInput,
        endsAt: new Date("2026-08-09T08:00:00.000Z")
      })
    ).rejects.toThrow("INVALID_INPUT");
    expect(repository.resolveOffering).not.toHaveBeenCalled();
  });

  it("normalizes no financial data and passes validated list filters to persistence", async () => {
    const repository = { list: vi.fn().mockResolvedValue([]) } as unknown as CustomerServicesRepository;
    await new CustomerServicesService(repository).list(context, { currency: "EUR", status: "active" });
    expect(repository.list).toHaveBeenCalledWith(context, { currency: "EUR", status: "active" });
  });
});

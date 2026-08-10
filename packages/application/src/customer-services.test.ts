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
    await new CustomerServicesService(repository).list(context, {
      currency: "EUR",
      status: "active",
      renewalState: "due_soon"
    });
    expect(repository.list).toHaveBeenCalledWith(context, {
      currency: "EUR",
      status: "active",
      renewalState: "due_soon"
    });
  });

  it("pauses only an active recurring service", async () => {
    const current = { id: "service", status: "active", commercialModel: "subscription" };
    const repository = {
      getById: vi.fn().mockResolvedValue(current),
      transition: vi.fn().mockResolvedValue({ ...current, status: "paused" })
    } as unknown as CustomerServicesRepository;
    const effectiveAt = new Date("2026-08-10T10:00:00.000Z");
    await new CustomerServicesService(repository).transition(context, {
      serviceId: "service",
      action: "pause",
      effectiveAt
    });
    expect(repository.transition).toHaveBeenCalledWith(context, {
      serviceId: "service",
      action: "pause",
      effectiveAt,
      expectedStatus: "active",
      targetStatus: "paused",
      eventType: "paused"
    });
  });

  it("requires a reason to cancel and rejects terminal transitions", async () => {
    const repository = {
      getById: vi.fn().mockResolvedValue({ id: "service", status: "completed", commercialModel: "one_time" }),
      transition: vi.fn()
    } as unknown as CustomerServicesRepository;
    const service = new CustomerServicesService(repository);
    await expect(
      service.transition(context, { serviceId: "service", action: "cancel", effectiveAt: new Date() })
    ).rejects.toThrow("INVALID_INPUT");
    await expect(
      service.transition(context, {
        serviceId: "service",
        action: "cancel",
        effectiveAt: new Date(),
        reason: "Customer request"
      })
    ).rejects.toThrow("CUSTOMER_SERVICE_INVALID_TRANSITION");
    expect(repository.transition).not.toHaveBeenCalled();
  });
});

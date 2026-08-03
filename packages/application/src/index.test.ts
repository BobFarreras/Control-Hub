import { describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@control-hub/domain";
import { CrmError, CrmService, type CrmRepository, type LeadRecord } from "./index.js";

const context: TenantContext = {
  tenantId: "tenant-a",
  membershipId: "member-a",
  userId: "user-a",
  roles: ["owner"],
  permissions: ["leads:manage"],
  mfaEnabled: true
};
const lead: LeadRecord = {
  id: "lead-a",
  name: "Avant",
  companyName: null,
  email: null,
  phone: null,
  source: "manual",
  status: "new",
  priority: "normal",
  ownerMembershipId: null,
  convertedCustomerId: null,
  createdAt: new Date(),
  updatedAt: new Date()
};

function repository(overrides: Partial<CrmRepository> = {}): CrmRepository {
  return {
    listLeads: vi.fn().mockResolvedValue({ items: [lead], total: 1, page: 1, pageSize: 1 }),
    listCustomers: vi.fn(),
    createLead: vi.fn().mockResolvedValue(lead),
    transitionLead: vi.fn().mockResolvedValue({ ...lead, status: "contacted" }),
    convertLead: vi.fn(),
    getCustomer: vi.fn(),
    addContact: vi.fn(),
    addNote: vi.fn(),
    addTask: vi.fn(),
    completeTask: vi.fn(),
    commercialSummary: vi.fn(),
    ...overrides
  };
}

describe("CrmService", () => {
  it("normalizes duplicate keys before persistence", async () => {
    const adapter = repository();
    const service = new CrmService(adapter);
    await service.createLead(context, {
      name: " Àvant ",
      email: " SALES@EXAMPLE.COM ",
      phone: "+34 600 123 123",
      source: " manual ",
      priority: "normal"
    });
    expect(adapter.createLead).toHaveBeenCalledWith(
      context,
      expect.objectContaining({
        name: "Àvant",
        source: "manual",
        normalizedName: "avant",
        normalizedEmail: "sales@example.com",
        normalizedPhone: "+34600123123"
      })
    );
  });
  it("rejects invalid transitions before writing", async () => {
    const adapter = repository();
    const service = new CrmService(adapter);
    await expect(service.transitionLead(context, lead.id, "won")).rejects.toEqual(
      expect.objectContaining({ code: "INVALID_TRANSITION" } satisfies Partial<CrmError>)
    );
    expect(adapter.transitionLead).not.toHaveBeenCalled();
  });
  it("permits the approved next transition", async () => {
    const adapter = repository();
    const service = new CrmService(adapter);
    await service.transitionLead(context, lead.id, "contacted");
    expect(adapter.transitionLead).toHaveBeenCalledWith(context, lead.id, "contacted");
  });
  it("rejects empty notes and tasks", async () => {
    const service = new CrmService(repository());
    expect(() => service.addNote(context, "customer-a", "   ")).toThrow("INVALID_INPUT");
    expect(() => service.addTask(context, "customer-a", { title: " " })).toThrow("INVALID_INPUT");
  });
});

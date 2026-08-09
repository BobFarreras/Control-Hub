import type { TenantContext } from "@control-hub/domain";
import { describe, expect, it, vi } from "vitest";
import { type CrmError, CrmService, type CrmRepository, type LeadRecord } from "./index.js";

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
    importLead: vi.fn().mockResolvedValue("imported"),
    transitionLead: vi.fn().mockResolvedValue({ ...lead, status: "contacted" }),
    reopenLead: vi.fn().mockResolvedValue({ ...lead, status: "proposal" }),
    convertLead: vi.fn(),
    getCustomer: vi.fn(),
    addContact: vi.fn(),
    createContactFromSourceLead: vi.fn(),
    updateCustomer: vi.fn(),
    createCustomerInterest: vi.fn(),
    getCustomerInterest: vi.fn(),
    transitionCustomerInterest: vi.fn(),
    createCustomerAddress: vi.fn(),
    deleteCustomerAddress: vi.fn(),
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
  it("normalizes an imported lead and preserves its idempotency reference", async () => {
    const adapter = repository();
    const service = new CrmService(adapter);
    await service.importLead(
      context,
      { name: " Àvant ", email: " SALES@EXAMPLE.COM ", source: " web ", priority: "normal" },
      "batch-a:2"
    );
    expect(adapter.importLead).toHaveBeenCalledWith(
      context,
      expect.objectContaining({ name: "Àvant", normalizedEmail: "sales@example.com", source: "web" }),
      "batch-a:2"
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
  it("rejects empty notes and tasks", () => {
    const service = new CrmService(repository());
    expect(() => service.addNote(context, "customer-a", "   ")).toThrow("INVALID_INPUT");
    expect(() => service.addTask(context, "customer-a", { title: " " })).toThrow("INVALID_INPUT");
  });
  it("requires a meaningful reason before reopening a lead", async () => {
    const adapter = repository();
    const service = new CrmService(adapter);
    expect(() => service.reopenLead(context, lead.id, "  ")).toThrow("INVALID_INPUT");
    await service.reopenLead(context, lead.id, " Client has renewed interest ");
    expect(adapter.reopenLead).toHaveBeenCalledWith(context, lead.id, "Client has renewed interest");
  });
  it("normalizes editable customer fields and preserves the expected version", async () => {
    const adapter = repository({
      updateCustomer: vi.fn().mockResolvedValue({ id: "customer-a" })
    });
    const service = new CrmService(adapter);
    const expectedUpdatedAt = new Date("2026-08-09T10:00:00.000Z");

    await service.updateCustomer(context, "customer-a", {
      displayName: " Bosch Atelier ",
      legalName: " Bosch Atelier, SL ",
      billingEmail: " billing@example.com ",
      phone: " +34 600 123 123 ",
      website: " https://bosch.example ",
      status: "active",
      expectedUpdatedAt
    });

    expect(adapter.updateCustomer).toHaveBeenCalledWith(context, "customer-a", {
      displayName: "Bosch Atelier",
      legalName: "Bosch Atelier, SL",
      billingEmail: "billing@example.com",
      phone: "+34 600 123 123",
      website: "https://bosch.example/",
      status: "active",
      expectedUpdatedAt
    });
  });
  it("rejects unsafe customer websites before persistence", () => {
    const adapter = repository();
    const service = new CrmService(adapter);

    expect(() =>
      service.updateCustomer(context, "customer-a", {
        displayName: "Bosch Atelier",
        website: "javascript:alert(1)",
        status: "active",
        expectedUpdatedAt: new Date()
      })
    ).toThrow("INVALID_INPUT");
    expect(adapter.updateCustomer).not.toHaveBeenCalled();
  });
  it("accepts a website without protocol and normalizes it to HTTPS", async () => {
    const adapter = repository({ updateCustomer: vi.fn().mockResolvedValue({ id: "customer-a" }) });
    const service = new CrmService(adapter);

    await service.updateCustomer(context, "customer-a", {
      displayName: "Bosch Atelier",
      website: "www.bosch.example/contact",
      status: "active",
      expectedUpdatedAt: new Date()
    });

    expect(adapter.updateCustomer).toHaveBeenCalledWith(
      context,
      "customer-a",
      expect.objectContaining({ website: "https://www.bosch.example/contact" })
    );
  });
  it("allows only the approved customer opportunity progression", async () => {
    const interest = {
      id: "interest-a",
      productId: "product-a",
      productName: "Agent WhatsApp",
      stage: "detected" as const,
      probability: null,
      nextStep: null,
      ownerMembershipId: null,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    const adapter = repository({
      getCustomerInterest: vi.fn().mockResolvedValue(interest),
      transitionCustomerInterest: vi.fn().mockResolvedValue({ ...interest, stage: "qualified" })
    });
    const service = new CrmService(adapter);

    await service.transitionCustomerInterest(context, interest.id, "qualified");
    expect(adapter.transitionCustomerInterest).toHaveBeenCalledWith(context, interest.id, "qualified");
    await expect(service.transitionCustomerInterest(context, interest.id, "won")).rejects.toEqual(
      expect.objectContaining({ code: "INVALID_TRANSITION" } satisfies Partial<CrmError>)
    );
  });
  it("validates customer time zones and normalizes address country codes", async () => {
    const adapter = repository({ createCustomerAddress: vi.fn().mockResolvedValue({ id: "address-a" }) });
    const service = new CrmService(adapter);
    expect(() =>
      service.updateCustomer(context, "customer-a", {
        displayName: "Bosch Atelier",
        timezone: "Not/A_Timezone",
        status: "active",
        expectedUpdatedAt: new Date()
      })
    ).toThrow("INVALID_INPUT");
    await service.createCustomerAddress(context, "customer-a", {
      type: "billing",
      line1: " Carrer Major 1 ",
      city: " Barcelona ",
      countryCode: "es",
      isPrimary: true
    });
    expect(adapter.createCustomerAddress).toHaveBeenCalledWith(
      context,
      "customer-a",
      expect.objectContaining({ line1: "Carrer Major 1", city: "Barcelona", countryCode: "ES" })
    );
  });
});

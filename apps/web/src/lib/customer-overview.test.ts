import { describe, expect, it } from "vitest";
import type { CustomerDetail } from "./api-types";
import { customerOverview } from "./customer-overview";

const customer: CustomerDetail = {
  id: "customer-a",
  displayName: "Avant",
  legalName: "Avant Studio SL",
  billingEmail: "hello@example.test",
  phone: "+34 600 123 123",
  website: "https://example.test",
  taxId: null,
  preferredLocale: null,
  timezone: null,
  status: "active",
  ownerMembershipId: null,
  createdFromLeadId: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-02T00:00:00.000Z",
  contacts: [
    {
      id: "secondary",
      name: "Second",
      role: null,
      email: null,
      phone: null,
      isPrimary: false,
      sourceLeadId: null
    },
    { id: "primary", name: "Primary", role: null, email: null, phone: null, isPrimary: true, sourceLeadId: null }
  ],
  notes: [],
  tasks: [
    { id: "later", title: "Later", dueAt: "2026-04-01T00:00:00.000Z", completedAt: null },
    { id: "done", title: "Done", dueAt: "2026-01-01T00:00:00.000Z", completedAt: "2026-01-01T01:00:00.000Z" },
    { id: "next", title: "Next", dueAt: "2026-03-01T00:00:00.000Z", completedAt: null }
  ],
  activity: [{ id: "latest", type: "note.created", occurredAt: "2026-02-01T00:00:00.000Z" }],
  services: [],
  projects: [],
  tickets: [],
  interests: [],
  availableProducts: [],
  addresses: []
};

describe("customerOverview", () => {
  it("selects the primary contact, next open task and latest activity", () => {
    expect(customerOverview(customer)).toMatchObject({
      primaryContact: { id: "primary" },
      nextTask: { id: "next" },
      lastActivity: { id: "latest" },
      openTaskCount: 2,
      contactCount: 2
    });
  });
});

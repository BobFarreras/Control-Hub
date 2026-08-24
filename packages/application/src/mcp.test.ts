import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { mcpScopePermissions, type TenantContext } from "@control-hub/domain";
import { describe, expect, it } from "vitest";
import { McpToolInputError, mcpToolByName, mcpToolCatalogue, type McpToolServices } from "./mcp.js";

const context: TenantContext = {
  tenantId: "tenant-a",
  membershipId: "membership-a",
  userId: "user-a",
  roles: ["owner"],
  permissions: ["customers:read", "tickets:read"],
  mfaEnabled: true
};

const customer = {
  id: "11111111-1111-4111-8111-111111111111",
  displayName: "Arrel Estudi",
  legalName: "Arrel Estudi SL",
  billingEmail: "facturacio@arrel.test",
  phone: "+34600000000",
  website: "https://arrel.test",
  taxId: "B00000000",
  preferredLocale: "ca" as const,
  timezone: "Europe/Madrid",
  status: "active" as const,
  ownerMembershipId: "membership-a",
  createdFromLeadId: null,
  createdAt: new Date("2026-01-02T00:00:00.000Z"),
  updatedAt: new Date("2026-08-01T00:00:00.000Z")
};

const ticket = {
  id: "22222222-2222-4222-8222-222222222222",
  ticketNumber: 42,
  customerId: "11111111-1111-4111-8111-111111111111",
  projectId: null,
  subject: "El correu no arriba",
  description: "Descripcio llarga del problema",
  status: "open" as const,
  priority: "high" as const,
  category: "incident",
  assigneeMembershipId: "membership-a",
  openedAt: new Date("2026-08-20T08:00:00.000Z"),
  firstResponseAt: null,
  resolvedAt: null,
  closedAt: null,
  firstResponseTargetMinutes: 60,
  resolutionTargetMinutes: 480
};

/** Records what the catalogue asked for, so a test can assert the tenant context travelled. */
function fakeServices() {
  const calls: { method: string; context: TenantContext; input: unknown }[] = [];
  const services: McpToolServices = {
    crm: {
      listCustomers: (ctx, query) => {
        calls.push({ method: "listCustomers", context: ctx, input: query });
        return Promise.resolve({ items: [customer], total: 1, page: query.page, pageSize: query.pageSize });
      },
      getCustomer: (ctx, customerId) => {
        calls.push({ method: "getCustomer", context: ctx, input: customerId });
        return Promise.resolve({
          ...customer,
          contacts: [{ id: "contact-1" }],
          notes: [{ id: "note-1", body: "Nota interna que no ha de sortir" }],
          tasks: [],
          activity: [{ id: "activity-1", summary: "Trucada" }],
          services: [],
          projects: [],
          tickets: [{ id: "22222222-2222-4222-8222-222222222222" }],
          interests: [],
          availableProducts: [],
          addresses: []
        } as never);
      }
    },
    support: {
      listTickets: (ctx, query) => {
        calls.push({ method: "listTickets", context: ctx, input: query });
        return Promise.resolve({
          items: [{ ...ticket, customerName: "Arrel Estudi", assigneeName: null, updatedAt: ticket.openedAt }],
          total: 1,
          page: query.page,
          pageSize: query.pageSize
        } as never);
      },
      ticketDetail: (ctx, ticketId) => {
        calls.push({ method: "ticketDetail", context: ctx, input: ticketId });
        return Promise.resolve({
          ticket: { ...ticket, customerName: "Arrel Estudi", assigneeName: null, projectName: null },
          messages: [
            {
              id: "message-1",
              ticketId: "22222222-2222-4222-8222-222222222222",
              authorMembershipId: "membership-a",
              authorName: "Bob",
              body: "Ho mirem",
              visibility: "internal" as const,
              createdAt: new Date("2026-08-20T09:00:00.000Z")
            }
          ],
          sla: { firstResponse: { state: "pending" }, resolution: { state: "pending" } },
          inboxSla: { worst: "pending" },
          assignableMembers: [{ membershipId: "membership-b", name: "Algu altre" }]
        } as never);
      }
    }
  };
  return { services, calls };
}

describe("the published tool catalogue", () => {
  it("publishes nothing that writes", () => {
    for (const tool of mcpToolCatalogue) {
      expect(tool.authority.mutating, tool.authority.name).toBe(false);
    }
  });

  it("names every tool once, after the module it reads", () => {
    const names = mcpToolCatalogue.map((tool) => tool.authority.name);
    expect(new Set(names).size).toBe(names.length);
    for (const tool of mcpToolCatalogue) {
      expect(tool.authority.name.startsWith(`${tool.module}.`), tool.authority.name).toBe(true);
    }
  });

  it("guards each tool with a permission its own scope can back", () => {
    // The scope may not be a wider door than the permission behind it: if a scope could unlock a
    // tool whose permission it does not imply, consenting to the scope would grant authority
    // nobody checked.
    for (const tool of mcpToolCatalogue) {
      expect(mcpScopePermissions(tool.authority.scope), tool.authority.name).toContain(tool.authority.permission);
    }
  });

  it("declares a closed input schema for every tool", () => {
    for (const tool of mcpToolCatalogue) {
      expect(tool.inputSchema.type, tool.authority.name).toBe("object");
      expect(tool.inputSchema.additionalProperties, tool.authority.name).toBe(false);
    }
  });

  it("finds a tool by name and refuses one nobody published", () => {
    expect(mcpToolByName("support.tickets.list")?.module).toBe("support");
    expect(mcpToolByName("support.tickets.reply")).toBeUndefined();
    expect(mcpToolByName("../../etc/passwd")).toBeUndefined();
  });

  it("reaches the outside world through nothing but use cases", () => {
    // The architecture rule, asserted rather than trusted: this module may know the domain and
    // its own siblings, and must never learn a repository, a database client or a transport.
    const source = readFileSync(fileURLToPath(new URL("./mcp.ts", import.meta.url)), "utf8");
    const imports = [...source.matchAll(/from "([^"]+)"/g)].map((match) => match[1]!);
    for (const specifier of imports) {
      expect(specifier === "@control-hub/domain" || specifier.startsWith("./"), specifier).toBe(true);
    }
    // Comments are stripped first: the prose above explains what this module must not touch, and
    // matching on prose would fail the test for saying so.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/postgres|persistence|repository|fastify|withTenant/i);
  });
});

describe("listing customers through a tool", () => {
  const tool = mcpToolByName("crm.customers.list")!;

  it("passes the caller's own tenant context to the use case", async () => {
    const { services, calls } = fakeServices();
    await tool.execute(services, context, { page: 1, pageSize: 10 });
    expect(calls[0]?.method).toBe("listCustomers");
    expect(calls[0]?.context.tenantId).toBe("tenant-a");
  });

  it("returns identity and status, and keeps bulk contact details out of a listing", async () => {
    const { services } = fakeServices();
    const result = await tool.execute(services, context, {});
    const rows = result.data as Record<string, unknown>[];
    expect(Object.keys(rows[0]!).sort()).toEqual(
      ["createdAt", "displayName", "id", "legalName", "preferredLocale", "status", "updatedAt"].sort()
    );
    expect(result.items).toBe(1);
  });

  it("caps the page size instead of trusting the caller", async () => {
    const { services, calls } = fakeServices();
    await tool.execute(services, context, { pageSize: 5000 });
    expect((calls[0]?.input as { pageSize: number }).pageSize).toBe(50);
  });

  it("refuses an argument nobody declared", async () => {
    const { services } = fakeServices();
    await expect(tool.execute(services, context, { pageSize: "many" })).rejects.toBeInstanceOf(McpToolInputError);
    await expect(tool.execute(services, context, { sort: "; drop table" })).rejects.toBeInstanceOf(McpToolInputError);
  });
});

describe("reading one customer through a tool", () => {
  const tool = mcpToolByName("crm.customers.get")!;

  it("returns the record with counts, never the notes and the activity themselves", async () => {
    const { services } = fakeServices();
    const result = await tool.execute(services, context, { customerId: "11111111-1111-4111-8111-111111111111" });
    const data = result.data as Record<string, unknown>;
    expect(data.billingEmail).toBe("facturacio@arrel.test");
    expect(data.notes).toBeUndefined();
    expect(data.activity).toBeUndefined();
    expect(data.counts).toEqual({ contacts: 1, tasks: 0, services: 0, projects: 0, tickets: 1, interests: 0 });
    expect(JSON.stringify(data)).not.toContain("Nota interna");
  });

  it("requires the identifier it declares", async () => {
    const { services } = fakeServices();
    await expect(tool.execute(services, context, {})).rejects.toBeInstanceOf(McpToolInputError);
  });
});

describe("reading tickets through a tool", () => {
  it("keeps the long description out of the listing", async () => {
    const { services } = fakeServices();
    const result = await mcpToolByName("support.tickets.list")!.execute(services, context, {});
    const rows = result.data as Record<string, unknown>[];
    expect(rows[0]!.subject).toBe("El correu no arriba");
    expect(rows[0]!.description).toBeUndefined();
  });

  it("returns the conversation on the detail, and not the staff directory beside it", async () => {
    const { services } = fakeServices();
    const result = await mcpToolByName("support.tickets.get")!.execute(services, context, {
      ticketId: "22222222-2222-4222-8222-222222222222"
    });
    const data = result.data as { messages: unknown[]; assignableMembers?: unknown };
    expect(data.messages).toHaveLength(1);
    expect(data.assignableMembers).toBeUndefined();
    expect(JSON.stringify(data)).not.toContain("Algu altre");
  });

  it("counts what it returned, which is what the audit record keeps", async () => {
    const { services } = fakeServices();
    const result = await mcpToolByName("support.tickets.get")!.execute(services, context, {
      ticketId: "22222222-2222-4222-8222-222222222222"
    });
    expect(result.items).toBe(1);
  });
});

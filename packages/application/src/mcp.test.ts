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
  permissions: ["customers:read", "tickets:read", "infrastructure:read", "usage:read"],
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
    },
    infrastructure: {
      readInventory: (ctx, now) => {
        calls.push({ method: "readInventory", context: ctx, input: now });
        return Promise.resolve({
          hosts: [
            {
              id: "33333333-3333-4333-8333-333333333333",
              hostname: "vps-01.internal",
              baseUrl: "https://10.0.0.4:9100",
              reading: { state: "up" },
              services: [{ id: "service-1", matchKey: "n8n", reading: { state: "down" } }],
              labels: ["vps-01"],
              observed: []
            }
          ],
          summary: {
            hosts: { total: 1, up: 1, down: 0, unknown: 0 },
            services: { total: 2, up: 1, down: 1, unknown: 0 }
          },
          observedFrom: new Date("2026-08-24T07:00:00.000Z")
        } as never);
      },
      listAlerts: (ctx, input) => {
        calls.push({ method: "listAlerts", context: ctx, input });
        return Promise.resolve([
          {
            id: "alert-1",
            ruleName: "service_down",
            severity: "critical" as const,
            status: "firing" as const,
            dedupKey: "n8n@vps-01.internal",
            summary: { host: "vps-01.internal", url: "https://10.0.0.4:9100" },
            startedAt: new Date("2026-08-24T06:00:00.000Z")
          },
          {
            id: "alert-2",
            ruleName: "disk_low",
            severity: "normal" as const,
            status: "firing" as const,
            dedupKey: "disk@vps-01.internal",
            summary: {},
            startedAt: new Date("2026-08-24T06:30:00.000Z")
          }
        ] as never);
      }
    },
    usage: {
      listSources: (ctx) => {
        calls.push({ method: "listSources", context: ctx, input: undefined });
        return Promise.resolve([
          {
            id: "source-1",
            instanceId: "44444444-4444-4444-8444-444444444444",
            operation: "vercel.deployments",
            lastCompleteAt: new Date("2026-08-24T05:00:00.000Z")
          },
          {
            id: "source-2",
            instanceId: "44444444-4444-4444-8444-444444444444",
            operation: "vercel.deployments",
            lastCompleteAt: new Date("2026-08-24T06:00:00.000Z")
          },
          {
            id: "source-3",
            instanceId: "55555555-5555-4555-8555-555555555555",
            operation: "n8n.executions",
            lastCompleteAt: null
          }
        ] as never);
      }
    },
    clock: () => new Date("2026-08-24T08:00:00.000Z")
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

describe("summarising the fleet through a tool", () => {
  const tool = mcpToolByName("infrastructure.status.summary")!;

  it("reads the inventory at the catalogue's own clock, not at one the caller supplies", async () => {
    const { services, calls } = fakeServices();
    await tool.execute(services, context, {});
    expect(calls[0]?.method).toBe("readInventory");
    expect(calls[0]?.input).toEqual(new Date("2026-08-24T08:00:00.000Z"));
    await expect(tool.execute(services, context, { now: "2020-01-01" })).rejects.toBeInstanceOf(McpToolInputError);
  });

  it("counts what is up and down, and names no machine and no address", async () => {
    const { services } = fakeServices();
    const result = await tool.execute(services, context, {});
    const data = result.data as Record<string, unknown>;
    expect(data.hosts).toEqual({ total: 1, up: 1, down: 0, unknown: 0 });
    expect(data.services).toEqual({ total: 2, up: 1, down: 1, unknown: 0 });
    expect(data.observedFrom).toEqual(new Date("2026-08-24T07:00:00.000Z"));
    // A summary of the fleet is a count, and an internal hostname or a collector's address is
    // neither a count nor something an agent has any use for.
    const serialised = JSON.stringify(data);
    expect(serialised).not.toContain("vps-01");
    expect(serialised).not.toContain("10.0.0.4");
  });

  it("says how many alerts are firing and how bad they are, and nothing about where", async () => {
    const { services, calls } = fakeServices();
    const result = await tool.execute(services, context, {});
    expect(calls[1]?.input).toEqual({ status: "firing" });
    const data = result.data as { alerts: Record<string, unknown> };
    expect(data.alerts).toEqual({ firing: 2, critical: 1, high: 0, normal: 1, low: 0 });
    expect(JSON.stringify(data)).not.toContain("dedupKey");
  });
});

describe("summarising usage through a tool", () => {
  const tool = mcpToolByName("usage.summary")!;

  it("reports collection health, never money", async () => {
    const { services } = fakeServices();
    const result = await tool.execute(services, context, {});
    const data = result.data as Record<string, unknown>;
    expect(data.sources).toEqual({ total: 3, completed: 2, neverCompleted: 1 });
    expect(data.oldestCompletionAt).toEqual(new Date("2026-08-24T05:00:00.000Z"));
    expect(data.newestCompletionAt).toEqual(new Date("2026-08-24T06:00:00.000Z"));
    // Amounts, currency and margin are `financials:read`, which has no MCP scope in 10.1: the
    // tool must not be able to leak them by accident of projection.
    expect(JSON.stringify(data)).not.toMatch(/cost|currency|amount|minor|margin/i);
  });

  it("groups the collectors by operation so a stalled one is visible", async () => {
    const { services } = fakeServices();
    const result = await tool.execute(services, context, {});
    const data = result.data as { byOperation: Record<string, unknown>[] };
    expect(data.byOperation).toEqual([
      { operation: "n8n.executions", sources: 1, completed: 0 },
      { operation: "vercel.deployments", sources: 2, completed: 2 }
    ]);
    expect(result.items).toBe(3);
  });
});

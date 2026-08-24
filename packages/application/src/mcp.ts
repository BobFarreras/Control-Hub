/**
 * The tools MCP publishes, and the only way in.
 *
 * Every entry binds one tool to one use case that already exists, already guards a permission and
 * already scopes itself to a tenant. Nothing here reaches a repository, a database client or a
 * transport: the catalogue is a list of doors onto the same rooms the REST API opens, which is
 * what makes "same permission outcome for REST, UI and MCP" true by construction rather than by
 * discipline.
 *
 * Two rules shape every projection below:
 *
 * - **Return less than the screen does, never more.** A listing is where bulk personal data would
 *   leave in quantity, so contact details live on the single-record tool and not on the list.
 * - **Return data, not the plumbing around it.** The staff directory a ticket page needs to fill
 *   an assignee dropdown is not part of the ticket, and an agent has no business receiving it.
 *
 * Input schemas are JSON Schema literals, the same shape the REST routes hand to Fastify, because
 * `tools/list` has to publish exactly this to an MCP client. The handler validates again anyway:
 * a tool that trusts its caller to have validated is a tool with no validation.
 *
 * Specification: `docs/specifications/mcp-and-client-portal.md`.
 */

import type { McpToolAuthority, TenantContext } from "@control-hub/domain";
import type { TicketDetail, TicketListQuery, TicketPage } from "./support.js";
import type { CrmListQuery, CustomerDetail, CustomerRecord, Page } from "./index.js";

/** Which module a tool reads, so the transport can ask whether it is deployed here. */
export const mcpToolModules = ["crm", "support", "projects", "commerce", "infrastructure", "usage"] as const;
export type McpToolModule = (typeof mcpToolModules)[number];

/**
 * The use cases the catalogue is allowed to call, named one by one.
 *
 * Structural and deliberately narrow: the catalogue receives the four reads it needs, not the
 * services that own them. A tool cannot reach `createTicket` because `createTicket` is not in
 * scope, which is a stronger guarantee than remembering not to call it.
 */
export type McpToolServices = {
  readonly crm: {
    listCustomers(context: TenantContext, query: CrmListQuery): Promise<Page<CustomerRecord>>;
    getCustomer(context: TenantContext, customerId: string): Promise<CustomerDetail>;
  };
  readonly support: {
    listTickets(context: TenantContext, query: TicketListQuery): Promise<TicketPage>;
    ticketDetail(context: TenantContext, ticketId: string): Promise<TicketDetail>;
  };
};

export type McpJsonSchema = {
  readonly type: "object";
  readonly additionalProperties: false;
  readonly properties: Readonly<Record<string, unknown>>;
  readonly required?: readonly string[];
};

/** What a tool returns: the payload, and the count the audit record keeps instead of it. */
export type McpToolResult = { readonly data: unknown; readonly items: number };

export type McpToolDefinition = {
  readonly authority: McpToolAuthority;
  readonly module: McpToolModule;
  /** One line, in English, shown to an MCP client beside the name. */
  readonly summary: string;
  readonly inputSchema: McpJsonSchema;
  readonly limits: { readonly maxItems: number };
  execute(services: McpToolServices, context: TenantContext, input: unknown): Promise<McpToolResult>;
};

/**
 * A refused argument. It carries the field name and never the value: an input that reached a
 * problem detail or an audit row would put whatever the caller typed into long-lived storage.
 */
export class McpToolInputError extends Error {
  constructor(public readonly field: string) {
    super("TOOL_INPUT_INVALID");
    this.name = "McpToolInputError";
  }
}

const maxPageSize = 50;
const maxSearchLength = 160;
const maxMessages = 50;

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function readArguments(input: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (input === undefined || input === null) return {};
  if (typeof input !== "object" || Array.isArray(input)) throw new McpToolInputError("arguments");
  const record = input as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) throw new McpToolInputError(key);
  }
  return record;
}

function readSearch(record: Record<string, unknown>): string | undefined {
  const value = record.search;
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length > maxSearchLength) throw new McpToolInputError("search");
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

function readPaging(record: Record<string, unknown>): { page: number; pageSize: number } {
  const page = record.page ?? 1;
  const pageSize = record.pageSize ?? 25;
  if (!Number.isInteger(page) || (page as number) < 1) throw new McpToolInputError("page");
  if (!Number.isInteger(pageSize) || (pageSize as number) < 1) throw new McpToolInputError("pageSize");
  // The cap is applied, not refused: a caller asking for more than a page is asking for a page.
  return { page: page as number, pageSize: Math.min(pageSize as number, maxPageSize) };
}

function readEnum<T extends string>(
  record: Record<string, unknown>,
  field: string,
  values: readonly T[]
): T | undefined {
  const value = record[field];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !values.includes(value as T)) throw new McpToolInputError(field);
  return value as T;
}

function readIdentifier(record: Record<string, unknown>, field: string): string {
  const value = record[field];
  if (typeof value !== "string" || !uuid.test(value)) throw new McpToolInputError(field);
  return value;
}

const customerSorts = ["updated_desc", "created_asc", "created_desc", "name_asc", "name_desc"] as const;
const ticketSorts = ["opened_desc", "opened_asc", "priority_desc", "updated_desc"] as const;
const ticketStatusValues = ["open", "waiting_customer", "waiting_third_party", "resolved", "closed"] as const;
const ticketPriorityValues = ["low", "normal", "high", "urgent"] as const;

const pagingProperties = {
  page: { type: "integer", minimum: 1, default: 1 },
  pageSize: { type: "integer", minimum: 1, maximum: maxPageSize, default: 25 }
} as const;

const customersList: McpToolDefinition = {
  authority: {
    name: "crm.customers.list",
    version: "v1",
    scope: "crm.read",
    permission: "customers:read",
    mutating: false
  },
  module: "crm",
  summary: "List the customers of this tenant, most recently updated first.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      ...pagingProperties,
      search: { type: "string", maxLength: maxSearchLength },
      sort: { type: "string", enum: customerSorts, default: "updated_desc" }
    }
  },
  limits: { maxItems: maxPageSize },
  async execute(services, context, input) {
    const record = readArguments(input, ["page", "pageSize", "search", "sort"]);
    const search = readSearch(record);
    const page = await services.crm.listCustomers(context, {
      ...readPaging(record),
      sort: readEnum(record, "sort", customerSorts) ?? "updated_desc",
      ...(search ? { search } : {})
    });
    // Identity and state only. Billing address, phone, tax identifier and website are contact
    // data, and a listing is precisely where they would leave a hundred rows at a time.
    const items = page.items.map((customer) => ({
      id: customer.id,
      displayName: customer.displayName,
      legalName: customer.legalName,
      status: customer.status,
      preferredLocale: customer.preferredLocale,
      createdAt: customer.createdAt,
      updatedAt: customer.updatedAt
    }));
    return { data: items, items: items.length };
  }
};

const customersGet: McpToolDefinition = {
  authority: {
    name: "crm.customers.get",
    version: "v1",
    scope: "crm.read",
    permission: "customers:read",
    mutating: false
  },
  module: "crm",
  summary: "Read one customer: identity, contact details and how much hangs off it.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: { customerId: { type: "string", format: "uuid" } },
    required: ["customerId"]
  },
  limits: { maxItems: 1 },
  async execute(services, context, input) {
    const record = readArguments(input, ["customerId"]);
    const detail = await services.crm.getCustomer(context, readIdentifier(record, "customerId"));
    // Notes and activity are internal commentary written by colleagues about a client. They are
    // not summarised, not counted and not returned: an agent asking about a customer is asking
    // about the relationship, not about what somebody wrote down after a phone call.
    return {
      data: {
        id: detail.id,
        displayName: detail.displayName,
        legalName: detail.legalName,
        billingEmail: detail.billingEmail,
        phone: detail.phone,
        website: detail.website,
        taxId: detail.taxId,
        preferredLocale: detail.preferredLocale,
        timezone: detail.timezone,
        status: detail.status,
        createdAt: detail.createdAt,
        updatedAt: detail.updatedAt,
        counts: {
          contacts: detail.contacts.length,
          tasks: detail.tasks.length,
          services: detail.services.length,
          projects: detail.projects.length,
          tickets: detail.tickets.length,
          interests: detail.interests.length
        }
      },
      items: 1
    };
  }
};

const ticketsList: McpToolDefinition = {
  authority: {
    name: "support.tickets.list",
    version: "v1",
    scope: "support.read",
    permission: "tickets:read",
    mutating: false
  },
  module: "support",
  summary: "List support tickets with their state, priority and service level clock.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      ...pagingProperties,
      search: { type: "string", maxLength: maxSearchLength },
      status: { type: "string", enum: ticketStatusValues },
      priority: { type: "string", enum: ticketPriorityValues },
      customerId: { type: "string", format: "uuid" },
      sort: { type: "string", enum: ticketSorts, default: "opened_desc" }
    }
  },
  limits: { maxItems: maxPageSize },
  async execute(services, context, input) {
    const record = readArguments(input, ["page", "pageSize", "search", "status", "priority", "customerId", "sort"]);
    const search = readSearch(record);
    const status = readEnum(record, "status", ticketStatusValues);
    const priority = readEnum(record, "priority", ticketPriorityValues);
    const customerId = record.customerId === undefined ? undefined : readIdentifier(record, "customerId");
    const page = await services.support.listTickets(context, {
      ...readPaging(record),
      sort: readEnum(record, "sort", ticketSorts) ?? "opened_desc",
      ...(search ? { search } : {}),
      ...(status ? { status } : {}),
      ...(priority ? { priority } : {}),
      ...(customerId ? { customerId } : {})
    });
    // No description: it is free text of unbounded length, and a listing of a hundred of them is
    // an export dressed up as a query. It is on the detail, one ticket at a time.
    const items = page.items.map((row) => ({
      id: row.id,
      ticketNumber: row.ticketNumber,
      subject: row.subject,
      status: row.status,
      priority: row.priority,
      category: row.category,
      customerId: row.customerId,
      customerName: row.customerName,
      openedAt: row.openedAt,
      firstResponseAt: row.firstResponseAt,
      resolvedAt: row.resolvedAt
    }));
    return { data: items, items: items.length };
  }
};

const ticketsGet: McpToolDefinition = {
  authority: {
    name: "support.tickets.get",
    version: "v1",
    scope: "support.read",
    permission: "tickets:read",
    mutating: false
  },
  module: "support",
  summary: "Read one ticket with its conversation and the state of both service level targets.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: { ticketId: { type: "string", format: "uuid" } },
    required: ["ticketId"]
  },
  limits: { maxItems: maxMessages },
  async execute(services, context, input) {
    const record = readArguments(input, ["ticketId"]);
    const detail = await services.support.ticketDetail(context, readIdentifier(record, "ticketId"));
    const { ticket, messages, sla } = detail;
    // `assignableMembers` and `inboxSla` are there so a screen can draw itself. The first is a
    // directory of colleagues, which is personal data an agent never asked for.
    return {
      data: {
        id: ticket.id,
        ticketNumber: ticket.ticketNumber,
        subject: ticket.subject,
        description: ticket.description,
        status: ticket.status,
        priority: ticket.priority,
        category: ticket.category,
        customerId: ticket.customerId,
        customerName: ticket.customerName,
        projectName: ticket.projectName,
        openedAt: ticket.openedAt,
        firstResponseAt: ticket.firstResponseAt,
        resolvedAt: ticket.resolvedAt,
        closedAt: ticket.closedAt,
        sla,
        messageCount: messages.length,
        messages: messages.slice(0, maxMessages).map((message) => ({
          id: message.id,
          authorName: message.authorName ?? null,
          visibility: message.visibility,
          body: message.body,
          createdAt: message.createdAt
        }))
      },
      items: 1
    };
  }
};

/**
 * The published catalogue.
 *
 * Static, in code, revisable in a diff: the owner approves a tool by reviewing this list, which
 * is impossible if tools can appear at runtime. Adding one is a change here and a change to the
 * specification, in the same commit.
 */
export const mcpToolCatalogue: readonly McpToolDefinition[] = [customersList, customersGet, ticketsList, ticketsGet];

const byName = new Map(mcpToolCatalogue.map((tool) => [tool.authority.name, tool] as const));

/** The tool with that exact name, or nothing. An unknown name is not an error here: it is a 404. */
export function mcpToolByName(name: string): McpToolDefinition | undefined {
  return byName.get(name);
}

/** What the authority rules in the domain need, without the handlers hanging off it. */
export const mcpToolAuthorities: readonly McpToolAuthority[] = mcpToolCatalogue.map((tool) => tool.authority);

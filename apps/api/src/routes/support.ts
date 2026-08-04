import type { TicketListQuery } from "@control-hub/application";
import { ticketPriorities, ticketStatuses, type TicketPriority, type TicketStatus } from "@control-hub/domain";
import { requirePermission, resolveTenantContext, writeAudit } from "../security.js";
import type { SupportContext } from "./context.js";

const listSchema = {
  querystring: {
    type: "object",
    additionalProperties: false,
    properties: {
      search: { type: "string", maxLength: 160 },
      status: { type: "string", enum: ticketStatuses },
      priority: { type: "string", enum: ticketPriorities },
      customerId: { type: "string", format: "uuid" },
      page: { type: "integer", minimum: 1, default: 1 },
      pageSize: { type: "integer", minimum: 1, maximum: 100, default: 25 },
      sort: {
        type: "string",
        enum: ["opened_desc", "opened_asc", "priority_desc", "updated_desc"],
        default: "opened_desc"
      }
    }
  }
} as const;

type ListQuery = Partial<TicketListQuery>;

const normalizeListQuery = (query: ListQuery): TicketListQuery => ({
  page: query.page ?? 1,
  pageSize: query.pageSize ?? 25,
  sort: query.sort ?? "opened_desc",
  ...(query.search ? { search: query.search } : {}),
  ...(query.status ? { status: query.status } : {}),
  ...(query.priority ? { priority: query.priority } : {}),
  ...(query.customerId ? { customerId: query.customerId } : {})
});

/** Tickets, their conversation and the state of their service level targets. */
export function registerSupportRoutes({ app, database, auth, support }: SupportContext) {
  app.get<{ Querystring: ListQuery }>("/api/v1/support/tickets", { schema: listSchema }, async (request) => {
    const context = await resolveTenantContext(auth, database, request);
    requirePermission(context, "tickets:read");
    return support.listTickets(context, normalizeListQuery(request.query));
  });

  app.post<{
    Body: {
      customerId: string;
      projectId?: string;
      subject: string;
      description: string;
      priority: TicketPriority;
      category?: string;
      assigneeMembershipId?: string;
    };
  }>(
    "/api/v1/support/tickets",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["customerId", "subject", "description", "priority"],
          properties: {
            customerId: { type: "string", format: "uuid" },
            projectId: { type: "string", format: "uuid" },
            subject: { type: "string", minLength: 3, maxLength: 200 },
            description: { type: "string", minLength: 1, maxLength: 20000 },
            priority: { type: "string", enum: ticketPriorities },
            category: { type: "string", minLength: 1, maxLength: 60 },
            assigneeMembershipId: { type: "string", format: "uuid" }
          }
        }
      }
    },
    async (request, reply) => {
      const context = await resolveTenantContext(auth, database, request);
      requirePermission(context, "tickets:manage");
      const ticket = await support.createTicket(context, request.body);
      await writeAudit(database, context, request, {
        action: "ticket.created",
        targetType: "ticket",
        targetId: ticket.id,
        outcome: "success",
        metadata: { ticketNumber: ticket.ticketNumber, priority: ticket.priority }
      });
      return reply.code(201).send({ ticket });
    }
  );

  app.get<{ Params: { ticketId: string } }>(
    "/api/v1/support/tickets/:ticketId",
    {
      schema: {
        params: { type: "object", required: ["ticketId"], properties: { ticketId: { type: "string", format: "uuid" } } }
      }
    },
    async (request) => {
      const context = await resolveTenantContext(auth, database, request);
      requirePermission(context, "tickets:read");
      return { ticket: await support.getTicket(context, request.params.ticketId) };
    }
  );

  app.patch<{ Params: { ticketId: string }; Body: { status: TicketStatus } }>(
    "/api/v1/support/tickets/:ticketId/status",
    {
      schema: {
        params: {
          type: "object",
          required: ["ticketId"],
          properties: { ticketId: { type: "string", format: "uuid" } }
        },
        body: {
          type: "object",
          additionalProperties: false,
          required: ["status"],
          properties: { status: { type: "string", enum: ticketStatuses } }
        }
      }
    },
    async (request) => {
      const context = await resolveTenantContext(auth, database, request);
      requirePermission(context, "tickets:manage");
      const ticket = await support.transition(context, request.params.ticketId, request.body.status);
      await writeAudit(database, context, request, {
        action: "ticket.status.changed",
        targetType: "ticket",
        targetId: ticket.id,
        outcome: "success",
        metadata: { status: ticket.status }
      });
      return { ticket };
    }
  );

  app.post<{
    Params: { ticketId: string };
    Body: { body: string; visibility: "internal" | "customer"; externalReference?: string };
  }>(
    "/api/v1/support/tickets/:ticketId/messages",
    {
      schema: {
        params: {
          type: "object",
          required: ["ticketId"],
          properties: { ticketId: { type: "string", format: "uuid" } }
        },
        body: {
          type: "object",
          additionalProperties: false,
          required: ["body", "visibility"],
          properties: {
            body: { type: "string", minLength: 1, maxLength: 20000 },
            visibility: { type: "string", enum: ["internal", "customer"] },
            externalReference: { type: "string", minLength: 1, maxLength: 200 }
          }
        }
      }
    },
    async (request, reply) => {
      const context = await resolveTenantContext(auth, database, request);
      requirePermission(context, "tickets:manage");
      const message = await support.addMessage(context, request.params.ticketId, request.body);
      // The body is deliberately absent from the audit metadata: customers paste credentials
      // into tickets, and an audit trail is not the place to copy them.
      await writeAudit(database, context, request, {
        action: "ticket.message.created",
        targetType: "ticket",
        targetId: request.params.ticketId,
        outcome: "success",
        metadata: { visibility: message.visibility }
      });
      return reply.code(201).send({ message });
    }
  );

  app.get<{ Params: { ticketId: string } }>(
    "/api/v1/support/tickets/:ticketId/sla",
    {
      schema: {
        params: { type: "object", required: ["ticketId"], properties: { ticketId: { type: "string", format: "uuid" } } }
      }
    },
    async (request) => {
      const context = await resolveTenantContext(auth, database, request);
      requirePermission(context, "tickets:read");
      return { sla: await support.slaFor(context, request.params.ticketId) };
    }
  );
}

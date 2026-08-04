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
    return support.listInbox(context, normalizeListQuery(request.query));
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
      return support.ticketDetail(context, request.params.ticketId);
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

  app.patch<{ Params: { ticketId: string }; Body: { assigneeMembershipId: string | null } }>(
    "/api/v1/support/tickets/:ticketId/assignment",
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
          required: ["assigneeMembershipId"],
          // Null unassigns: a ticket parked on somebody who left is worse than one on nobody.
          properties: { assigneeMembershipId: { type: ["string", "null"], format: "uuid" } }
        }
      }
    },
    async (request) => {
      const context = await resolveTenantContext(auth, database, request);
      requirePermission(context, "tickets:manage");
      const ticket = await support.assign(context, request.params.ticketId, request.body.assigneeMembershipId);
      await writeAudit(database, context, request, {
        action: "ticket.assigned",
        targetType: "ticket",
        targetId: ticket.id,
        outcome: "success",
        metadata: { assigneeMembershipId: ticket.assigneeMembershipId }
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

  // Reading the configuration needs only tickets:read, because the inbox has to render the
  // schedule to explain a due date. Changing it needs support:configure, which decides what
  // counts as a breach and so does not belong to whoever merely resolves tickets.
  app.get("/api/v1/support/schedule", async (request) => {
    const context = await resolveTenantContext(auth, database, request);
    requirePermission(context, "tickets:read");
    const [calendar, holidays] = await Promise.all([support.loadCalendar(context), support.listHolidays(context)]);
    return { schedule: calendar.windows, timeZone: calendar.timeZone, holidays };
  });

  app.put<{ Body: { windows: { weekday: number; opensAt: string; closesAt: string }[] } }>(
    "/api/v1/support/schedule",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["windows"],
          properties: {
            windows: {
              type: "array",
              maxItems: 42,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["weekday", "opensAt", "closesAt"],
                properties: {
                  weekday: { type: "integer", minimum: 0, maximum: 6 },
                  opensAt: { type: "string", pattern: "^([01][0-9]|2[0-3]):[0-5][0-9]$" },
                  closesAt: { type: "string", pattern: "^([01][0-9]|2[0-3]):[0-5][0-9]$" }
                }
              }
            }
          }
        }
      }
    },
    async (request) => {
      const context = await resolveTenantContext(auth, database, request);
      requirePermission(context, "support:configure");
      await support.replaceSchedule(context, request.body.windows);
      await writeAudit(database, context, request, {
        action: "support.schedule.updated",
        targetType: "support_schedule",
        outcome: "success",
        metadata: { windows: request.body.windows.length }
      });
      return { status: "updated" };
    }
  );

  app.post<{ Body: { holidayOn: string; label?: string } }>(
    "/api/v1/support/holidays",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["holidayOn"],
          properties: {
            holidayOn: { type: "string", pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$" },
            label: { type: "string", minLength: 1, maxLength: 120 }
          }
        }
      }
    },
    async (request, reply) => {
      const context = await resolveTenantContext(auth, database, request);
      requirePermission(context, "support:configure");
      const holiday = await support.addHoliday(context, request.body.holidayOn, request.body.label ?? null);
      await writeAudit(database, context, request, {
        action: "support.holiday.added",
        targetType: "support_holiday",
        targetId: holiday.id,
        outcome: "success",
        metadata: { holidayOn: holiday.holidayOn }
      });
      return reply.code(201).send({ holiday });
    }
  );

  app.delete<{ Params: { holidayId: string } }>(
    "/api/v1/support/holidays/:holidayId",
    {
      schema: {
        params: {
          type: "object",
          required: ["holidayId"],
          properties: { holidayId: { type: "string", format: "uuid" } }
        }
      }
    },
    async (request, reply) => {
      const context = await resolveTenantContext(auth, database, request);
      requirePermission(context, "support:configure");
      await support.removeHoliday(context, request.params.holidayId);
      await writeAudit(database, context, request, {
        action: "support.holiday.removed",
        targetType: "support_holiday",
        targetId: request.params.holidayId,
        outcome: "success"
      });
      return reply.code(204).send();
    }
  );

  app.get("/api/v1/support/sla-targets", async (request) => {
    const context = await resolveTenantContext(auth, database, request);
    requirePermission(context, "tickets:read");
    return { targets: await support.listSlaTargets(context) };
  });

  app.post<{
    Body: { priority: TicketPriority; firstResponseMinutes: number; resolutionMinutes: number; effectiveFrom?: string };
  }>(
    "/api/v1/support/sla-targets",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["priority", "firstResponseMinutes", "resolutionMinutes"],
          properties: {
            priority: { type: "string", enum: ticketPriorities },
            firstResponseMinutes: { type: "integer", minimum: 1, maximum: 525600 },
            resolutionMinutes: { type: "integer", minimum: 1, maximum: 525600 },
            effectiveFrom: { type: "string", format: "date-time" }
          }
        }
      }
    },
    async (request, reply) => {
      const context = await resolveTenantContext(auth, database, request);
      requirePermission(context, "support:configure");
      const target = await support.publishSlaTarget(context, {
        priority: request.body.priority,
        firstResponseMinutes: request.body.firstResponseMinutes,
        resolutionMinutes: request.body.resolutionMinutes,
        ...(request.body.effectiveFrom ? { effectiveFrom: new Date(request.body.effectiveFrom) } : {})
      });
      await writeAudit(database, context, request, {
        action: "support.sla_target.published",
        targetType: "sla_target",
        targetId: target.id,
        outcome: "success",
        metadata: { priority: target.priority }
      });
      return reply.code(201).send({ target });
    }
  );
}

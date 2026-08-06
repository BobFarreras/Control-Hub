import type { ProjectListQuery, TimeEntryListQuery } from "@control-hub/application";
import { projectStatuses, type ProjectStatus } from "@control-hub/domain";
import { requirePermission, resolveTenantContext, writeAudit } from "../security.js";
import type { ProjectsContext } from "./context.js";

const isoDate = { type: "string", pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$" } as const;
const uuid = { type: "string", format: "uuid" } as const;

const listSchema = {
  querystring: {
    type: "object",
    additionalProperties: false,
    properties: {
      search: { type: "string", maxLength: 160 },
      status: { type: "string", enum: projectStatuses },
      customerId: uuid,
      page: { type: "integer", minimum: 1, default: 1 },
      pageSize: { type: "integer", minimum: 1, maximum: 100, default: 25 },
      sort: { type: "string", enum: ["created_desc", "created_asc", "due_asc", "name_asc"], default: "created_desc" }
    }
  }
} as const;

const timeEntriesSchema = {
  querystring: {
    type: "object",
    additionalProperties: false,
    properties: {
      projectId: uuid,
      ticketId: uuid,
      membershipId: uuid,
      from: isoDate,
      to: isoDate,
      page: { type: "integer", minimum: 1, default: 1 },
      pageSize: { type: "integer", minimum: 1, maximum: 100, default: 25 },
      sort: { type: "string", enum: ["spent_desc", "spent_asc"], default: "spent_desc" }
    }
  }
} as const;

const normalizeProjectQuery = (query: Partial<ProjectListQuery>): ProjectListQuery => ({
  page: query.page ?? 1,
  pageSize: query.pageSize ?? 25,
  sort: query.sort ?? "created_desc",
  ...(query.search ? { search: query.search } : {}),
  ...(query.status ? { status: query.status } : {}),
  ...(query.customerId ? { customerId: query.customerId } : {})
});

const normalizeTimeQuery = (query: Partial<TimeEntryListQuery>): TimeEntryListQuery => ({
  page: query.page ?? 1,
  pageSize: query.pageSize ?? 25,
  sort: query.sort ?? "spent_desc",
  ...(query.projectId ? { projectId: query.projectId } : {}),
  ...(query.ticketId ? { ticketId: query.ticketId } : {}),
  ...(query.membershipId ? { membershipId: query.membershipId } : {}),
  ...(query.from ? { from: query.from } : {}),
  ...(query.to ? { to: query.to } : {})
});

/**
 * Projects, the hours logged against them and the rates those hours are valued with.
 *
 * Cost and margin sit behind `financials:read` on every route that can reveal them, and the
 * service refuses them a second time. An hourly cost is close enough to a salary that one
 * forgotten guard should not be all it takes.
 */
export function registerProjectRoutes({ app, database, auth, projects }: ProjectsContext) {
  app.get<{ Querystring: Partial<ProjectListQuery> }>("/api/v1/projects", { schema: listSchema }, async (request) => {
    const context = await resolveTenantContext(auth, database, request);
    requirePermission(context, "projects:read");
    return projects.listProjects(context, normalizeProjectQuery(request.query));
  });

  app.post<{
    Body: {
      customerId: string;
      code: string;
      name: string;
      description?: string;
      ownerMembershipId?: string;
      startedAt?: string;
      dueAt?: string;
    };
  }>(
    "/api/v1/projects",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["customerId", "code", "name"],
          properties: {
            customerId: uuid,
            code: { type: "string", minLength: 3, maxLength: 64 },
            name: { type: "string", minLength: 3, maxLength: 200 },
            description: { type: "string", maxLength: 2000 },
            ownerMembershipId: uuid,
            startedAt: { type: "string", format: "date-time" },
            dueAt: { type: "string", format: "date-time" }
          }
        }
      }
    },
    async (request, reply) => {
      const context = await resolveTenantContext(auth, database, request);
      requirePermission(context, "projects:manage");
      const project = await projects.createProject(context, {
        customerId: request.body.customerId,
        code: request.body.code,
        name: request.body.name,
        ...(request.body.description ? { description: request.body.description } : {}),
        ...(request.body.ownerMembershipId ? { ownerMembershipId: request.body.ownerMembershipId } : {}),
        ...(request.body.startedAt ? { startedAt: new Date(request.body.startedAt) } : {}),
        ...(request.body.dueAt ? { dueAt: new Date(request.body.dueAt) } : {})
      });
      await writeAudit(database, context, request, {
        action: "project.created",
        targetType: "project",
        targetId: project.id,
        outcome: "success",
        metadata: { code: project.code, customerId: project.customerId }
      });
      return reply.code(201).send({ project });
    }
  );

  app.get<{ Params: { projectId: string } }>(
    "/api/v1/projects/:projectId",
    { schema: { params: { type: "object", required: ["projectId"], properties: { projectId: uuid } } } },
    async (request) => {
      const context = await resolveTenantContext(auth, database, request);
      requirePermission(context, "projects:read");
      return projects.projectDetail(context, request.params.projectId);
    }
  );

  app.patch<{ Params: { projectId: string }; Body: { status: ProjectStatus; reason?: string } }>(
    "/api/v1/projects/:projectId/status",
    {
      schema: {
        params: { type: "object", required: ["projectId"], properties: { projectId: uuid } },
        body: {
          type: "object",
          additionalProperties: false,
          required: ["status"],
          properties: { status: { type: "string", enum: projectStatuses }, reason: { type: "string", maxLength: 500 } }
        }
      }
    },
    async (request) => {
      const context = await resolveTenantContext(auth, database, request);
      requirePermission(context, "projects:manage");
      const project = await projects.changeStatus(
        context,
        request.params.projectId,
        request.body.status,
        request.body.reason ?? null
      );
      await writeAudit(database, context, request, {
        action: "project.status.changed",
        targetType: "project",
        targetId: project.id,
        outcome: "success",
        metadata: { status: project.status }
      });
      return { project };
    }
  );

  app.get<{ Params: { projectId: string } }>(
    "/api/v1/projects/:projectId/profitability",
    { schema: { params: { type: "object", required: ["projectId"], properties: { projectId: uuid } } } },
    async (request) => {
      const context = await resolveTenantContext(auth, database, request);
      requirePermission(context, "financials:read");
      return { profitability: await projects.projectProfitability(context, request.params.projectId) };
    }
  );

  // Under the CRM namespace because that is where a customer lives; the report is the same one.
  app.get<{ Params: { customerId: string } }>(
    "/api/v1/crm/customers/:customerId/profitability",
    { schema: { params: { type: "object", required: ["customerId"], properties: { customerId: uuid } } } },
    async (request) => {
      const context = await resolveTenantContext(auth, database, request);
      requirePermission(context, "financials:read");
      return { profitability: await projects.customerProfitability(context, request.params.customerId) };
    }
  );

  app.get<{ Querystring: Partial<TimeEntryListQuery> }>(
    "/api/v1/time-entries",
    { schema: timeEntriesSchema },
    async (request) => {
      const context = await resolveTenantContext(auth, database, request);
      requirePermission(context, "projects:read");
      return projects.listTimeEntries(context, normalizeTimeQuery(request.query));
    }
  );

  app.post<{
    Body: {
      projectId?: string;
      ticketId?: string;
      spentOn?: string;
      duration: string;
      billable?: boolean;
      note?: string;
      clientReference?: string;
    };
  }>(
    "/api/v1/time-entries",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["duration"],
          properties: {
            projectId: uuid,
            ticketId: uuid,
            spentOn: isoDate,
            // Text, not minutes: `1h 30m` and `90` both arrive as typed and one parser in the
            // domain decides what they mean, so the API and the form cannot disagree.
            duration: { type: "string", minLength: 1, maxLength: 20 },
            billable: { type: "boolean" },
            note: { type: "string", maxLength: 500 },
            clientReference: { type: "string", minLength: 1, maxLength: 200 }
          }
        }
      }
    },
    async (request, reply) => {
      const context = await resolveTenantContext(auth, database, request);
      requirePermission(context, "time:log");
      const entry = await projects.logTime(context, request.body);
      await writeAudit(database, context, request, {
        action: "time_entry.created",
        targetType: "time_entry",
        targetId: entry.id,
        outcome: "success",
        metadata: { minutes: entry.minutes, spentOn: entry.spentOn, billable: entry.billable }
      });
      return reply.code(201).send({ entry });
    }
  );

  app.patch<{
    Params: { timeEntryId: string };
    Body: { duration?: string; spentOn?: string; billable?: boolean; note?: string | null };
  }>(
    "/api/v1/time-entries/:timeEntryId",
    {
      schema: {
        params: { type: "object", required: ["timeEntryId"], properties: { timeEntryId: uuid } },
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            duration: { type: "string", minLength: 1, maxLength: 20 },
            spentOn: isoDate,
            billable: { type: "boolean" },
            note: { type: ["string", "null"], maxLength: 500 }
          }
        }
      }
    },
    async (request) => {
      const context = await resolveTenantContext(auth, database, request);
      // Whether this entry belongs to somebody else is the service's call: `time:log` is the
      // permission to keep your own record straight, `time:manage` to correct a colleague's.
      requirePermission(context, "time:log");
      const { entry, previous } = await projects.updateTimeEntry(context, request.params.timeEntryId, request.body);
      await writeAudit(database, context, request, {
        action: "time_entry.updated",
        targetType: "time_entry",
        targetId: entry.id,
        outcome: "success",
        metadata: {
          minutes: entry.minutes,
          spentOn: entry.spentOn,
          billable: entry.billable,
          previousMinutes: previous.minutes,
          previousSpentOn: previous.spentOn
        }
      });
      return { entry };
    }
  );

  app.delete<{ Params: { timeEntryId: string } }>(
    "/api/v1/time-entries/:timeEntryId",
    { schema: { params: { type: "object", required: ["timeEntryId"], properties: { timeEntryId: uuid } } } },
    async (request, reply) => {
      const context = await resolveTenantContext(auth, database, request);
      requirePermission(context, "time:log");
      // Hours justify invoices, so what was deleted is recorded rather than vanishing.
      const removed = await projects.deleteTimeEntry(context, request.params.timeEntryId);
      await writeAudit(database, context, request, {
        action: "time_entry.deleted",
        targetType: "time_entry",
        targetId: removed.id,
        outcome: "success",
        metadata: {
          minutes: removed.minutes,
          spentOn: removed.spentOn,
          billable: removed.billable,
          projectId: removed.projectId,
          ticketId: removed.ticketId
        }
      });
      return reply.code(204).send();
    }
  );

  app.get("/api/v1/rates", async (request) => {
    const context = await resolveTenantContext(auth, database, request);
    requirePermission(context, "financials:read");
    return projects.listRates(context);
  });

  app.post<{ Body: { membershipId: string; currency: string; costMinorPerHour: number; effectiveFrom?: string } }>(
    "/api/v1/rates/cost",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["membershipId", "currency", "costMinorPerHour"],
          properties: {
            membershipId: uuid,
            currency: { type: "string", pattern: "^[A-Z]{3}$" },
            costMinorPerHour: { type: "integer", minimum: 0, maximum: 9007199254740991 },
            effectiveFrom: isoDate
          }
        }
      }
    },
    async (request, reply) => {
      const context = await resolveTenantContext(auth, database, request);
      requirePermission(context, "rates:manage");
      const rate = await projects.publishCostRate(context, {
        membershipId: request.body.membershipId,
        currency: request.body.currency,
        costMinorPerHour: request.body.costMinorPerHour,
        ...(request.body.effectiveFrom ? { effectiveFrom: request.body.effectiveFrom } : {})
      });
      // The amount is deliberately absent: an hourly cost is adjacent to a salary, and the
      // audit trail is read by more people than the rate itself is.
      await writeAudit(database, context, request, {
        action: "rate.cost.published",
        targetType: "member_cost_rate",
        targetId: rate.id,
        outcome: "success",
        metadata: { membershipId: rate.membershipId, currency: rate.currency, effectiveFrom: rate.effectiveFrom }
      });
      return reply.code(201).send({ rate });
    }
  );

  app.post<{
    Body: {
      scope: "customer" | "project";
      scopeId: string;
      currency: string;
      amountMinorPerHour: number;
      effectiveFrom?: string;
    };
  }>(
    "/api/v1/rates/billing",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["scope", "scopeId", "currency", "amountMinorPerHour"],
          properties: {
            scope: { type: "string", enum: ["customer", "project"] },
            scopeId: uuid,
            currency: { type: "string", pattern: "^[A-Z]{3}$" },
            amountMinorPerHour: { type: "integer", minimum: 0, maximum: 9007199254740991 },
            effectiveFrom: isoDate
          }
        }
      }
    },
    async (request, reply) => {
      const context = await resolveTenantContext(auth, database, request);
      requirePermission(context, "rates:manage");
      const rate = await projects.publishBillingRate(context, {
        scope: request.body.scope,
        scopeId: request.body.scopeId,
        currency: request.body.currency,
        amountMinorPerHour: request.body.amountMinorPerHour,
        ...(request.body.effectiveFrom ? { effectiveFrom: request.body.effectiveFrom } : {})
      });
      await writeAudit(database, context, request, {
        action: "rate.billing.published",
        targetType: "billing_rate",
        targetId: rate.id,
        outcome: "success",
        metadata: {
          scope: rate.scope,
          scopeId: rate.scopeId,
          currency: rate.currency,
          effectiveFrom: rate.effectiveFrom
        }
      });
      return reply.code(201).send({ rate });
    }
  );
}

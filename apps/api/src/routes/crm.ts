import {
  CrmError,
  customerInterestStages,
  type CreateLeadInput,
  type CrmListQuery,
  type CustomerInterestStage
} from "@control-hub/application";
import { parseCsv } from "@control-hub/contracts";
import {
  leadPriorities,
  leadStatuses,
  normalizeComparableName,
  type LeadPriority,
  type LeadStatus
} from "@control-hub/domain";
import { createCrmImportTemplate, createCrmLeadsWorkbook } from "../crm-export.js";
import { requirePermission, resolveTenantContext, writeAudit } from "../security.js";
import type { CrmContext } from "./context.js";

/** Leads, customers, contacts, notes, tasks and the CSV import/export pair. */
export function registerCrmRoutes({ app, database, auth, crm }: CrmContext) {
  const listSchema = {
    querystring: {
      type: "object",
      additionalProperties: false,
      properties: {
        search: { type: "string", maxLength: 160 },
        status: { type: "string", maxLength: 32 },
        priority: { type: "string", enum: ["low", "normal", "high", "urgent"] },
        page: { type: "integer", minimum: 1, default: 1 },
        pageSize: { type: "integer", minimum: 1, maximum: 100, default: 25 },
        sort: {
          type: "string",
          enum: [
            "updated_desc",
            "created_asc",
            "created_desc",
            "name_asc",
            "name_desc",
            "company_asc",
            "company_desc",
            "priority_asc",
            "priority_desc"
          ],
          default: "updated_desc"
        }
      }
    }
  } as const;
  type ListQuery = Partial<CrmListQuery>;
  const normalizeListQuery = (query: ListQuery): CrmListQuery => ({
    page: query.page ?? 1,
    pageSize: query.pageSize ?? 25,
    sort: query.sort ?? "updated_desc",
    ...(query.search ? { search: query.search } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.priority ? { priority: query.priority } : {})
  });

  app.get<{ Querystring: ListQuery }>("/api/v1/crm/leads", { schema: listSchema }, async (request) => {
    const context = await resolveTenantContext(auth, database, request);
    requirePermission(context, "leads:read");
    return crm.listLeads(context, normalizeListQuery(request.query));
  });
  app.post<{ Body: CreateLeadInput }>(
    "/api/v1/crm/leads",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["name", "source", "priority"],
          properties: {
            name: { type: "string", minLength: 2, maxLength: 160 },
            companyName: { type: "string", maxLength: 160 },
            email: { type: "string", format: "email", maxLength: 254 },
            phone: { type: "string", maxLength: 40 },
            source: { type: "string", minLength: 1, maxLength: 80 },
            priority: { type: "string", enum: leadPriorities },
            ownerMembershipId: { type: "string", format: "uuid" }
          }
        }
      }
    },
    async (request, reply) => {
      const context = await resolveTenantContext(auth, database, request);
      requirePermission(context, "leads:manage");
      const lead = await crm.createLead(context, request.body);
      await writeAudit(database, context, request, {
        action: "lead.created",
        targetType: "lead",
        targetId: lead.id,
        outcome: "success"
      });
      return reply.code(201).send({ lead });
    }
  );
  app.patch<{ Params: { leadId: string }; Body: { status: LeadStatus } }>(
    "/api/v1/crm/leads/:leadId/status",
    {
      schema: {
        params: { type: "object", required: ["leadId"], properties: { leadId: { type: "string", format: "uuid" } } },
        body: {
          type: "object",
          additionalProperties: false,
          required: ["status"],
          properties: { status: { type: "string", enum: leadStatuses } }
        }
      }
    },
    async (request) => {
      const context = await resolveTenantContext(auth, database, request);
      requirePermission(context, "leads:manage");
      const lead = await crm.transitionLead(context, request.params.leadId, request.body.status);
      await writeAudit(database, context, request, {
        action: "lead.status.changed",
        targetType: "lead",
        targetId: lead.id,
        outcome: "success",
        metadata: { status: lead.status }
      });
      return { lead };
    }
  );
  app.post<{ Params: { leadId: string } }>(
    "/api/v1/crm/leads/:leadId/convert",
    {
      schema: {
        params: { type: "object", required: ["leadId"], properties: { leadId: { type: "string", format: "uuid" } } }
      }
    },
    async (request) => {
      const context = await resolveTenantContext(auth, database, request);
      requirePermission(context, "leads:manage");
      const customer = await crm.convertLead(context, request.params.leadId);
      await writeAudit(database, context, request, {
        action: "lead.converted",
        targetType: "customer",
        targetId: customer.id,
        outcome: "success",
        metadata: { leadId: request.params.leadId }
      });
      return { customer };
    }
  );
  app.post<{ Params: { leadId: string }; Body: { reason: string } }>(
    "/api/v1/crm/leads/:leadId/reopen",
    {
      schema: {
        params: { type: "object", required: ["leadId"], properties: { leadId: { type: "string", format: "uuid" } } },
        body: {
          type: "object",
          additionalProperties: false,
          required: ["reason"],
          properties: { reason: { type: "string", minLength: 3, maxLength: 500 } }
        }
      }
    },
    async (request) => {
      const context = await resolveTenantContext(auth, database, request);
      requirePermission(context, "leads:manage");
      const lead = await crm.reopenLead(context, request.params.leadId, request.body.reason);
      await writeAudit(database, context, request, {
        action: "lead.reopened",
        targetType: "lead",
        targetId: lead.id,
        outcome: "success",
        metadata: { status: lead.status }
      });
      return { lead };
    }
  );
  app.get<{ Querystring: ListQuery }>("/api/v1/crm/customers", { schema: listSchema }, async (request) => {
    const context = await resolveTenantContext(auth, database, request);
    requirePermission(context, "customers:read");
    return crm.listCustomers(context, normalizeListQuery(request.query));
  });
  app.get("/api/v1/crm/summary", async (request) => {
    const context = await resolveTenantContext(auth, database, request);
    requirePermission(context, "leads:read");
    return crm.commercialSummary(context);
  });
  app.get<{ Params: { customerId: string } }>(
    "/api/v1/crm/customers/:customerId",
    {
      schema: {
        params: {
          type: "object",
          required: ["customerId"],
          properties: { customerId: { type: "string", format: "uuid" } }
        }
      }
    },
    async (request) => {
      const context = await resolveTenantContext(auth, database, request);
      requirePermission(context, "customers:read");
      return { customer: await crm.getCustomer(context, request.params.customerId) };
    }
  );
  app.patch<{
    Params: { customerId: string };
    Body: {
      displayName: string;
      legalName?: string;
      billingEmail?: string;
      phone?: string;
      website?: string;
      taxId?: string;
      preferredLocale?: "ca" | "es" | "en";
      timezone?: string;
      status: "active" | "inactive";
      expectedUpdatedAt: string;
    };
  }>(
    "/api/v1/crm/customers/:customerId",
    {
      schema: {
        params: {
          type: "object",
          required: ["customerId"],
          properties: { customerId: { type: "string", format: "uuid" } }
        },
        body: {
          type: "object",
          additionalProperties: false,
          required: ["displayName", "status", "expectedUpdatedAt"],
          properties: {
            displayName: { type: "string", minLength: 2, maxLength: 160 },
            legalName: { type: "string", maxLength: 200 },
            billingEmail: { type: "string", format: "email", maxLength: 254 },
            phone: { type: "string", maxLength: 40 },
            website: { type: "string", maxLength: 500 },
            taxId: { type: "string", maxLength: 40 },
            preferredLocale: { type: "string", enum: ["ca", "es", "en"] },
            timezone: { type: "string", maxLength: 100 },
            status: { type: "string", enum: ["active", "inactive"] },
            expectedUpdatedAt: { type: "string", format: "date-time" }
          }
        }
      }
    },
    async (request) => {
      const context = await resolveTenantContext(auth, database, request);
      requirePermission(context, "customers:manage");
      const customer = await crm.updateCustomer(context, request.params.customerId, {
        ...request.body,
        expectedUpdatedAt: new Date(request.body.expectedUpdatedAt)
      });
      await writeAudit(database, context, request, {
        action: "customer.updated",
        targetType: "customer",
        targetId: customer.id,
        outcome: "success",
        metadata: {
          fields: "displayName,legalName,billingEmail,phone,website,taxId,preferredLocale,timezone,status"
        }
      });
      return { customer };
    }
  );
  app.post<{
    Params: { customerId: string };
    Body: {
      productId: string;
      probability?: number;
      estimatedAmountMinor?: number;
      currency?: string;
      nextStep?: string;
    };
  }>(
    "/api/v1/crm/customers/:customerId/interests",
    {
      schema: {
        params: {
          type: "object",
          required: ["customerId"],
          properties: { customerId: { type: "string", format: "uuid" } }
        },
        body: {
          type: "object",
          additionalProperties: false,
          required: ["productId"],
          properties: {
            productId: { type: "string", format: "uuid" },
            probability: { type: "integer", minimum: 0, maximum: 100 },
            estimatedAmountMinor: { type: "integer", minimum: 0, maximum: 9007199254740991 },
            currency: { type: "string", pattern: "^[A-Z]{3}$" },
            nextStep: { type: "string", maxLength: 500 }
          }
        }
      }
    },
    async (request, reply) => {
      const context = await resolveTenantContext(auth, database, request);
      requirePermission(context, "customers:manage");
      if (request.body.estimatedAmountMinor !== undefined) requirePermission(context, "financials:read");
      const interest = await crm.createCustomerInterest(context, request.params.customerId, request.body);
      await writeAudit(database, context, request, {
        action: "customer.interest.created",
        targetType: "customer_product_interest",
        targetId: interest.id,
        outcome: "success",
        metadata: { customerId: request.params.customerId, productId: request.body.productId }
      });
      return reply.code(201).send({ interest });
    }
  );
  app.patch<{ Params: { interestId: string }; Body: { stage: CustomerInterestStage } }>(
    "/api/v1/crm/interests/:interestId/stage",
    {
      schema: {
        params: {
          type: "object",
          required: ["interestId"],
          properties: { interestId: { type: "string", format: "uuid" } }
        },
        body: {
          type: "object",
          additionalProperties: false,
          required: ["stage"],
          properties: { stage: { type: "string", enum: [...customerInterestStages] } }
        }
      }
    },
    async (request) => {
      const context = await resolveTenantContext(auth, database, request);
      requirePermission(context, "customers:manage");
      const interest = await crm.transitionCustomerInterest(context, request.params.interestId, request.body.stage);
      await writeAudit(database, context, request, {
        action: "customer.interest.stage_changed",
        targetType: "customer_product_interest",
        targetId: interest.id,
        outcome: "success",
        metadata: { stage: interest.stage }
      });
      return { interest };
    }
  );
  app.post<{
    Params: { customerId: string };
    Body: {
      type: "billing" | "shipping" | "office" | "other";
      label?: string;
      line1: string;
      line2?: string;
      postalCode?: string;
      city: string;
      region?: string;
      countryCode: string;
      isPrimary?: boolean;
    };
  }>(
    "/api/v1/crm/customers/:customerId/addresses",
    {
      schema: {
        params: {
          type: "object",
          required: ["customerId"],
          properties: { customerId: { type: "string", format: "uuid" } }
        },
        body: {
          type: "object",
          additionalProperties: false,
          required: ["type", "line1", "city", "countryCode"],
          properties: {
            type: { type: "string", enum: ["billing", "shipping", "office", "other"] },
            label: { type: "string", maxLength: 120 },
            line1: { type: "string", minLength: 1, maxLength: 200 },
            line2: { type: "string", maxLength: 200 },
            postalCode: { type: "string", maxLength: 32 },
            city: { type: "string", minLength: 1, maxLength: 120 },
            region: { type: "string", maxLength: 120 },
            countryCode: { type: "string", pattern: "^[A-Za-z]{2}$" },
            isPrimary: { type: "boolean", default: false }
          }
        }
      }
    },
    async (request, reply) => {
      const context = await resolveTenantContext(auth, database, request);
      requirePermission(context, "customers:manage");
      const address = await crm.createCustomerAddress(context, request.params.customerId, {
        ...request.body,
        isPrimary: request.body.isPrimary ?? false
      });
      await writeAudit(database, context, request, {
        action: "customer.address.created",
        targetType: "customer_address",
        targetId: address.id,
        outcome: "success",
        metadata: { customerId: request.params.customerId, type: address.type }
      });
      return reply.code(201).send({ address });
    }
  );
  app.delete<{ Params: { customerId: string; addressId: string } }>(
    "/api/v1/crm/customers/:customerId/addresses/:addressId",
    {
      schema: {
        params: {
          type: "object",
          required: ["customerId", "addressId"],
          properties: {
            customerId: { type: "string", format: "uuid" },
            addressId: { type: "string", format: "uuid" }
          }
        }
      }
    },
    async (request, reply) => {
      const context = await resolveTenantContext(auth, database, request);
      requirePermission(context, "customers:manage");
      await crm.deleteCustomerAddress(context, request.params.customerId, request.params.addressId);
      await writeAudit(database, context, request, {
        action: "customer.address.deleted",
        targetType: "customer_address",
        targetId: request.params.addressId,
        outcome: "success",
        metadata: { customerId: request.params.customerId }
      });
      return reply.code(204).send();
    }
  );
  app.post<{
    Params: { customerId: string };
    Body: { name: string; role?: string; email?: string; phone?: string; isPrimary?: boolean };
  }>(
    "/api/v1/crm/customers/:customerId/contacts",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["name"],
          properties: {
            name: { type: "string", minLength: 2, maxLength: 160 },
            role: { type: "string", maxLength: 120 },
            email: { type: "string", format: "email", maxLength: 254 },
            phone: { type: "string", maxLength: 40 },
            isPrimary: { type: "boolean", default: false }
          }
        }
      }
    },
    async (request, reply) => {
      const context = await resolveTenantContext(auth, database, request);
      requirePermission(context, "customers:manage");
      const contact = await crm.addContact(context, request.params.customerId, {
        ...request.body,
        isPrimary: request.body.isPrimary ?? false
      });
      await writeAudit(database, context, request, {
        action: "contact.created",
        targetType: "contact",
        targetId: contact.id,
        outcome: "success"
      });
      return reply.code(201).send({ contact });
    }
  );
  app.post<{ Params: { customerId: string } }>(
    "/api/v1/crm/customers/:customerId/contacts/from-source-lead",
    {
      schema: {
        params: {
          type: "object",
          required: ["customerId"],
          properties: { customerId: { type: "string", format: "uuid" } }
        }
      }
    },
    async (request, reply) => {
      const context = await resolveTenantContext(auth, database, request);
      requirePermission(context, "customers:manage");
      const contact = await crm.createContactFromSourceLead(context, request.params.customerId);
      await writeAudit(database, context, request, {
        action: "contact.recovered_from_lead",
        targetType: "contact",
        targetId: contact.id,
        outcome: "success",
        metadata: { customerId: request.params.customerId, sourceLeadId: contact.sourceLeadId }
      });
      return reply.code(201).send({ contact });
    }
  );
  app.post<{ Params: { customerId: string }; Body: { body: string } }>(
    "/api/v1/crm/customers/:customerId/notes",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["body"],
          properties: { body: { type: "string", minLength: 1, maxLength: 10000 } }
        }
      }
    },
    async (request, reply) => {
      const context = await resolveTenantContext(auth, database, request);
      requirePermission(context, "customers:manage");
      const note = await crm.addNote(context, request.params.customerId, request.body.body);
      await writeAudit(database, context, request, {
        action: "note.created",
        targetType: "customer",
        targetId: request.params.customerId,
        outcome: "success"
      });
      return reply.code(201).send({ note });
    }
  );
  app.post<{
    Params: { customerId: string };
    Body: { title: string; dueAt?: string; assigneeMembershipId?: string };
  }>(
    "/api/v1/crm/customers/:customerId/tasks",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["title"],
          properties: {
            title: { type: "string", minLength: 1, maxLength: 240 },
            dueAt: { type: "string", format: "date-time" },
            assigneeMembershipId: { type: "string", format: "uuid" }
          }
        }
      }
    },
    async (request, reply) => {
      const context = await resolveTenantContext(auth, database, request);
      requirePermission(context, "customers:manage");
      const task = await crm.addTask(context, request.params.customerId, {
        title: request.body.title,
        ...(request.body.dueAt ? { dueAt: new Date(request.body.dueAt) } : {}),
        ...(request.body.assigneeMembershipId ? { assigneeMembershipId: request.body.assigneeMembershipId } : {})
      });
      await writeAudit(database, context, request, {
        action: "task.created",
        targetType: "task",
        targetId: task.id,
        outcome: "success"
      });
      return reply.code(201).send({ task });
    }
  );
  app.post<{ Params: { taskId: string } }>("/api/v1/crm/tasks/:taskId/complete", async (request) => {
    const context = await resolveTenantContext(auth, database, request);
    requirePermission(context, "customers:manage");
    const task = await crm.completeTask(context, request.params.taskId);
    await writeAudit(database, context, request, {
      action: "task.completed",
      targetType: "task",
      targetId: task.id,
      outcome: "success"
    });
    return { task };
  });
  type ExportQuery = { search?: string; status?: string; priority?: LeadPriority; locale?: "ca" | "es" | "en" };
  app.get<{ Querystring: ExportQuery }>(
    "/api/v1/crm/leads/export",
    {
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            search: { type: "string", maxLength: 160 },
            status: { type: "string", enum: leadStatuses },
            priority: { type: "string", enum: leadPriorities },
            locale: { type: "string", enum: ["ca", "es", "en"], default: "ca" }
          }
        }
      }
    },
    async (request, reply) => {
      const context = await resolveTenantContext(auth, database, request);
      requirePermission(context, "leads:read");
      // Paged through rather than asked for in one 10000-row slice. The old cap silently
      // produced a short file: an export of a larger book would look complete and simply be
      // missing customers, which is the worst way for an export to fail.
      const exportPageSize = 500;
      const leads = [];
      for (let page = 1; ; page++) {
        const result = await crm.listLeads(context, {
          page,
          pageSize: exportPageSize,
          sort: "name_asc",
          ...(request.query.search ? { search: request.query.search } : {}),
          ...(request.query.status ? { status: request.query.status } : {}),
          ...(request.query.priority ? { priority: request.query.priority } : {})
        });
        leads.push(...result.items);
        if (result.items.length < exportPageSize || leads.length >= result.total) break;
      }
      const exportedAt = new Date();
      const workbook = await createCrmLeadsWorkbook({
        leads,
        locale: request.query.locale ?? "ca",
        tenantId: context.tenantId,
        exportedAt,
        filters: {
          ...(request.query.search ? { search: request.query.search } : {}),
          ...(request.query.status ? { status: request.query.status } : {}),
          ...(request.query.priority ? { priority: request.query.priority } : {})
        }
      });
      await writeAudit(database, context, request, {
        action: "lead.exported",
        targetType: "lead",
        outcome: "success",
        metadata: {
          rows: leads.length,
          status: request.query.status ?? null,
          priority: request.query.priority ?? null
        }
      });
      return reply
        .type("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        .header(
          "content-disposition",
          `attachment; filename=control-hub-leads-${exportedAt.toISOString().slice(0, 10)}.xlsx`
        )
        .send(Buffer.from(workbook));
    }
  );
  app.post<{ Body: { csv: string; batchId: string; commit?: boolean } }>(
    "/api/v1/crm/leads/import",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["csv", "batchId"],
          properties: {
            csv: { type: "string", minLength: 1, maxLength: 5_000_000 },
            batchId: { type: "string", format: "uuid" },
            commit: { type: "boolean", default: false }
          }
        }
      }
    },
    async (request) => {
      const context = await resolveTenantContext(auth, database, request);
      requirePermission(context, request.body.commit ? "leads:manage" : "leads:read");
      let rows: string[][];
      try {
        rows = parseCsv(request.body.csv);
      } catch {
        throw new CrmError("INVALID_INPUT");
      }
      const header = rows.shift()?.map((value) => value.trim().toLowerCase()) ?? [];
      const required = ["name", "source", "priority"];
      if (!required.every((column) => header.includes(column))) throw new CrmError("INVALID_INPUT");
      const index = (column: string) => header.indexOf(column);
      const results: {
        row: number;
        status: "valid" | "warning" | "imported" | "skipped" | "error";
        code?: string;
      }[] = [];
      const fileEmails = new Set<string>();
      const filePhones = new Set<string>();
      const fileNames = new Set<string>();
      for (const [offset, row] of rows.entries()) {
        const input: CreateLeadInput = {
          name: row[index("name")] ?? "",
          source: row[index("source")] ?? "",
          priority: (row[index("priority")] ?? "") as LeadPriority,
          ...(row[index("company")] ? { companyName: row[index("company")] } : {}),
          ...(row[index("email")] ? { email: row[index("email")] } : {}),
          ...(row[index("phone")] ? { phone: row[index("phone")] } : {})
        };
        try {
          if (input.name.trim().length < 2) {
            results.push({ row: offset + 2, status: "error", code: "INVALID_LEAD_NAME" });
            continue;
          }
          if (input.source.trim().length === 0) {
            results.push({ row: offset + 2, status: "error", code: "SOURCE_REQUIRED" });
            continue;
          }
          if (!leadPriorities.includes(input.priority)) {
            results.push({ row: offset + 2, status: "error", code: "INVALID_PRIORITY" });
            continue;
          }
          const emailKey = input.email?.trim().toLowerCase();
          const phoneKey = input.phone?.replace(/\D/g, "");
          if (emailKey && fileEmails.has(emailKey)) throw new CrmError("DUPLICATE_EMAIL");
          if (phoneKey && filePhones.has(phoneKey)) throw new CrmError("DUPLICATE_PHONE");
          if (emailKey && !/^\S+@\S+\.\S+$/.test(emailKey)) {
            results.push({ row: offset + 2, status: "error", code: "INVALID_EMAIL" });
            continue;
          }
          const nameKey = normalizeComparableName(input.name);
          let similarName = fileNames.has(nameKey);
          if (!request.body.commit) {
            const duplicate = await crm.listLeads(context, {
              search: emailKey || phoneKey || input.name,
              page: 1,
              pageSize: 10,
              sort: "updated_desc"
            });
            if (duplicate.items.some((lead) => emailKey && lead.email?.trim().toLowerCase() === emailKey))
              throw new CrmError("DUPLICATE_EMAIL");
            if (duplicate.items.some((lead) => phoneKey && lead.phone?.replace(/\D/g, "") === phoneKey))
              throw new CrmError("DUPLICATE_PHONE");
            similarName ||= duplicate.items.some((lead) => normalizeComparableName(lead.name) === nameKey);
          } else {
            const outcome = await crm.importLead(context, input, `${request.body.batchId}:${offset + 2}`);
            if (outcome === "already_imported") {
              results.push({ row: offset + 2, status: "skipped", code: "ALREADY_IMPORTED" });
              continue;
            }
          }
          if (emailKey) fileEmails.add(emailKey);
          if (phoneKey) filePhones.add(phoneKey);
          fileNames.add(nameKey);
          results.push({
            row: offset + 2,
            status: request.body.commit ? "imported" : similarName ? "warning" : "valid",
            ...(similarName && !request.body.commit ? { code: "SIMILAR_NAME" } : {})
          });
        } catch (error) {
          if (!(error instanceof CrmError)) throw error;
          results.push({
            row: offset + 2,
            status: "error",
            code: error.code
          });
        }
      }
      const summary = {
        total: results.length,
        imported: results.filter((result) => result.status === "imported").length,
        skipped: results.filter((result) => result.status === "skipped").length,
        warnings: results.filter((result) => result.status === "warning").length,
        errors: results.filter((result) => result.status === "error").length
      };
      if (request.body.commit)
        await writeAudit(database, context, request, {
          action: "lead.imported",
          targetType: "lead",
          outcome: "success",
          metadata: {
            batchId: request.body.batchId,
            imported: summary.imported,
            skipped: summary.skipped,
            failed: summary.errors
          }
        });
      return { batchId: request.body.batchId, results, summary };
    }
  );
  app.get<{ Querystring: { locale?: "ca" | "es" | "en" } }>(
    "/api/v1/crm/leads/import-template",
    {
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: { locale: { type: "string", enum: ["ca", "es", "en"], default: "ca" } }
        }
      }
    },
    async (request, reply) => {
      const context = await resolveTenantContext(auth, database, request);
      requirePermission(context, "leads:read");
      const workbook = await createCrmImportTemplate(request.query.locale ?? "ca");
      return reply
        .type("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        .header("content-disposition", "attachment; filename=control-hub-leads-template-v1.xlsx")
        .send(Buffer.from(workbook));
    }
  );
}

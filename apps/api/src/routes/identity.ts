import type { RoleCode } from "@control-hub/domain";
import { assignMemberRole, listAuditEvents, listMembers } from "../identity-repository.js";
import { requestHeaders } from "../request-headers.js";
import { ApiSecurityError, requirePermission, resolveTenantContext, writeAudit } from "../security.js";
import { tableColumns, type TableId } from "../table-columns.js";
import { getTablePreference, saveTablePreference } from "../table-preference-repository.js";
import type { RouteContext } from "./context.js";

/** Session, membership and audit endpoints: who the caller is and what they may do. */
export function registerIdentityRoutes({ app, database, auth }: RouteContext) {
  app.get("/api/v1/me", async (request) => ({ context: await resolveTenantContext(auth, database, request) }));
  app.get<{ Params: { tableId: string } }>("/api/v1/table-preferences/:tableId", async (request) => {
    const context = await resolveTenantContext(auth, database, request);
    if (!Object.hasOwn(tableColumns, request.params.tableId))
      throw new ApiSecurityError(403, "TABLE_PREFERENCE_DENIED");
    return { preference: await getTablePreference(database, context, request.params.tableId) };
  });
  app.put<{
    Params: { tableId: string };
    Body: {
      columnOrder: string[];
      hiddenColumns: string[];
      columnWidths: Record<string, number>;
      pageSize: 10 | 25 | 50 | 100;
    };
  }>(
    "/api/v1/table-preferences/:tableId",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["columnOrder", "hiddenColumns", "columnWidths", "pageSize"],
          properties: {
            columnOrder: { type: "array", maxItems: 20, uniqueItems: true, items: { type: "string", maxLength: 80 } },
            hiddenColumns: {
              type: "array",
              maxItems: 20,
              uniqueItems: true,
              items: { type: "string", maxLength: 80 }
            },
            columnWidths: {
              type: "object",
              maxProperties: 20,
              additionalProperties: { type: "integer", minimum: 80, maximum: 600 }
            },
            pageSize: { type: "integer", enum: [10, 25, 50, 100] }
          }
        }
      }
    },
    async (request) => {
      const context = await resolveTenantContext(auth, database, request);
      const tableId = request.params.tableId as TableId;
      if (!Object.hasOwn(tableColumns, tableId)) throw new ApiSecurityError(403, "TABLE_PREFERENCE_DENIED");
      const allowed = new Set<string>(tableColumns[tableId]);
      if (
        [...request.body.columnOrder, ...request.body.hiddenColumns, ...Object.keys(request.body.columnWidths)].some(
          (column) => !allowed.has(column)
        )
      )
        throw new ApiSecurityError(403, "TABLE_PREFERENCE_DENIED");
      return { preference: await saveTablePreference(database, context, { tableId, ...request.body }) };
    }
  );
  app.get("/api/v1/sessions", async (request) => {
    await resolveTenantContext(auth, database, request);
    return { sessions: await auth.api.listSessions({ headers: requestHeaders(request.headers) }) };
  });
  app.get("/api/v1/members", async (request) => {
    const context = await resolveTenantContext(auth, database, request);
    requirePermission(context, "members:manage");
    return { members: await listMembers(database, context) };
  });
  app.patch<{ Params: { membershipId: string }; Body: { role: RoleCode } }>(
    "/api/v1/members/:membershipId/role",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["role"],
          properties: { role: { type: "string", enum: ["owner", "administrator", "technical"] } }
        }
      }
    },
    async (request) => {
      const context = await resolveTenantContext(auth, database, request);
      requirePermission(context, "roles:manage");
      await assignMemberRole(database, context, request.params.membershipId, request.body.role);
      await writeAudit(database, context, request, {
        action: "membership.role.changed",
        targetType: "membership",
        targetId: request.params.membershipId,
        outcome: "success",
        metadata: { role: request.body.role }
      });
      return { status: "updated" };
    }
  );
  app.get("/api/v1/audit", async (request) => {
    const context = await resolveTenantContext(auth, database, request);
    requirePermission(context, "audit:read");
    return { events: await listAuditEvents(database, context) };
  });
}

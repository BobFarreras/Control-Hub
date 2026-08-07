import type { AttendanceRange } from "@control-hub/application";
import { attendanceEventKinds, type AttendanceEventKind } from "@control-hub/domain";
import { requirePermission, resolveTenantContext, writeAudit } from "../security.js";
import type { AttendanceContext } from "./context.js";

const isoDate = { type: "string", pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$" } as const;
const uuid = { type: "string", format: "uuid" } as const;

const rangeSchema = {
  querystring: {
    type: "object",
    additionalProperties: false,
    required: ["from", "to"],
    properties: { from: isoDate, to: isoDate }
  }
} as const;

const memberRangeSchema = {
  querystring: {
    type: "object",
    additionalProperties: false,
    required: ["from", "to"],
    properties: { from: isoDate, to: isoDate, membershipId: uuid }
  }
} as const;

/**
 * The body of a punch carries the kind and nothing else.
 *
 * There is deliberately no time field. Accepting one would mean the record could be written from
 * the browser's clock, and a working time record whose times come from the device it was pressed
 * on proves nothing. A past time reaches the log only through a correction, which says so.
 */
const punchSchema = {
  body: {
    type: "object",
    additionalProperties: false,
    required: ["kind"],
    properties: {
      kind: { type: "string", enum: attendanceEventKinds },
      clientReference: { type: "string", minLength: 1, maxLength: 200 }
    }
  }
} as const;

const correctionSchema = {
  body: {
    type: "object",
    additionalProperties: false,
    required: ["kind", "occurredAt", "reason"],
    properties: {
      membershipId: uuid,
      kind: { type: "string", enum: attendanceEventKinds },
      occurredAt: { type: "string", format: "date-time" },
      reason: { type: "string", minLength: 1, maxLength: 500 },
      correctsEventId: uuid
    }
  }
} as const;

const range = (query: { from: string; to: string }): AttendanceRange => ({ from: query.from, to: query.to });

/**
 * Working time records.
 *
 * Two rules shape every route here. A person's own record needs nothing beyond
 * `attendance:record`, because it is the document the law recognises them; and reading somebody
 * else's is audited even when the caller is entitled to it, because knowing when a person comes
 * and goes is exactly the kind of access that has to leave a trace.
 */
export function registerAttendanceRoutes({ app, database, auth, attendance }: AttendanceContext) {
  app.post<{ Body: { kind: AttendanceEventKind; clientReference?: string } }>(
    "/api/v1/attendance/events",
    { schema: punchSchema },
    async (request, reply) => {
      const context = await resolveTenantContext(auth, database, request);
      requirePermission(context, "attendance:record");
      const event = await attendance.punch(context, {
        kind: request.body.kind,
        source: "web",
        ...(request.body.clientReference ? { clientReference: request.body.clientReference } : {})
      });
      await writeAudit(database, context, request, {
        action: "attendance.recorded",
        targetType: "attendance_event",
        targetId: event.id,
        outcome: "success",
        metadata: { kind: event.kind }
      });
      return reply.code(201).send({ event });
    }
  );

  /** What the button in the header renders: where this person is, and whether breaks exist. */
  app.get("/api/v1/attendance/me", async (request) => {
    const context = await resolveTenantContext(auth, database, request);
    requirePermission(context, "attendance:record");
    return attendance.currentState(context);
  });

  app.post<{
    Body: {
      membershipId?: string;
      kind: AttendanceEventKind;
      occurredAt: string;
      reason: string;
      correctsEventId?: string;
    };
  }>("/api/v1/attendance/corrections", { schema: correctionSchema }, async (request, reply) => {
    const context = await resolveTenantContext(auth, database, request);
    requirePermission(context, "attendance:record");
    // Somebody else's record needs `attendance:manage`, and the service is where that is decided:
    // omitting the field means one's own, which is the common case and the one that needs no rank.
    const membershipId = request.body.membershipId ?? context.membershipId;
    const event = await attendance.correct(context, {
      membershipId,
      kind: request.body.kind,
      occurredAt: new Date(request.body.occurredAt),
      reason: request.body.reason,
      ...(request.body.correctsEventId ? { correctsEventId: request.body.correctsEventId } : {})
    });
    await writeAudit(database, context, request, {
      action: "attendance.corrected",
      targetType: "attendance_event",
      targetId: event.id,
      outcome: "success",
      // No times and no reason in the audit metadata: the entry itself carries both, and copying
      // them here would put a person's movements in a second place that outlives the record.
      metadata: { kind: event.kind, ownRecord: membershipId === context.membershipId }
    });
    return reply.code(201).send({ event });
  });

  /**
   * A month. Without `membershipId` it is the caller's own and needs no further permission;
   * with one it is somebody else's, and that read is written to the audit log.
   */
  app.get<{ Querystring: { from: string; to: string; membershipId?: string } }>(
    "/api/v1/attendance/summary",
    { schema: memberRangeSchema },
    async (request) => {
      const context = await resolveTenantContext(auth, database, request);
      requirePermission(context, "attendance:record");
      const membershipId = request.query.membershipId ?? context.membershipId;
      const month = await attendance.month(context, membershipId, range(request.query));

      if (membershipId !== context.membershipId) {
        await writeAudit(database, context, request, {
          action: "attendance.read_other",
          targetType: "membership",
          targetId: membershipId,
          outcome: "success",
          metadata: { from: request.query.from, to: request.query.to }
        });
      }
      return month;
    }
  );

  /** Everybody's totals, which is the export the accountancy reads. */
  app.get<{ Querystring: { from: string; to: string } }>(
    "/api/v1/attendance",
    { schema: rangeSchema },
    async (request) => {
      const context = await resolveTenantContext(auth, database, request);
      requirePermission(context, "attendance:manage");
      const members = await attendance.everyone(context, range(request.query));
      await writeAudit(database, context, request, {
        action: "attendance.exported",
        targetType: "tenant",
        outcome: "success",
        metadata: { from: request.query.from, to: request.query.to, members: members.length }
      });
      return { members };
    }
  );

  /**
   * Hours worked against hours logged to projects and tickets.
   *
   * `financials:read` on top of `attendance:manage`, on the route and again in the service. What
   * this exposes is what structural time costs, which is the same class of information as a rate.
   */
  app.get<{ Querystring: { from: string; to: string } }>(
    "/api/v1/attendance/reconciliation",
    { schema: rangeSchema },
    async (request) => {
      const context = await resolveTenantContext(auth, database, request);
      requirePermission(context, "attendance:manage");
      requirePermission(context, "financials:read");
      return { members: await attendance.reconciliation(context, range(request.query)) };
    }
  );
}

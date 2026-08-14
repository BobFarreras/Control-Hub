import type {
  AlertEventRecord,
  AlertRuleRecord,
  AutomationRecord,
  CreateAlertRuleInput,
  UpdateAlertRuleInput
} from "@control-hub/application";
import type { AlertSeverity, TenantContext } from "@control-hub/domain";
import type { FastifyRequest } from "fastify";
import { requirePermission, resolveTenantContext, writeAudit } from "../security.js";
import type { InfrastructureContext } from "./context.js";

/**
 * The infrastructure surface: what runs, who it belongs to, and what is worth being told about.
 *
 * Three things hold for every handler here. **No response carries a provider address, a token or
 * a raw event body** -- each one is written field by field, so a column added to a table later
 * cannot reach a client by existing. An automation travels as `instanceId` and `externalId`, and
 * the screen composes the link from the base it already holds. **Every observed figure travels
 * with the hour it was read**, because a stale number without its age is worse than no number.
 * And **every change is audited, refusals included**: a denial nobody recorded is the one an
 * investigation cannot see later.
 *
 * Specification: `docs/specifications/infrastructure.md`.
 */

export function automationResponse(automation: AutomationRecord) {
  return {
    instanceId: automation.instanceId,
    externalId: automation.externalId,
    name: automation.name,
    active: automation.active,
    archived: automation.archived,
    tags: automation.tags,
    observedAt: automation.observedAt,
    customerId: automation.customerId,
    notes: automation.notes
  };
}

export function ruleResponse(rule: AlertRuleRecord) {
  return {
    id: rule.id,
    name: rule.name,
    kind: rule.kind,
    instanceId: rule.instanceId,
    targetType: rule.targetType,
    targetId: rule.targetId,
    severity: rule.severity,
    params: rule.params,
    freshnessSeconds: rule.freshnessSeconds,
    opensIncident: rule.opensIncident,
    enabled: rule.enabled,
    createdAt: rule.createdAt,
    updatedAt: rule.updatedAt
  };
}

/**
 * `summary` is ours and not the provider's: the domain builds it out of identifiers and counts,
 * which is why it can be sent whole without reading it here.
 */
export function alertResponse(alert: AlertEventRecord) {
  return {
    id: alert.id,
    ruleId: alert.ruleId,
    ruleName: alert.ruleName,
    dedupKey: alert.dedupKey,
    status: alert.status,
    severity: alert.severity,
    summary: alert.summary,
    startedAt: alert.startedAt,
    lastSeenAt: alert.lastSeenAt,
    occurrences: alert.occurrences,
    resolvedAt: alert.resolvedAt,
    acknowledgedAt: alert.acknowledgedAt,
    acknowledgedByMembershipId: alert.acknowledgedByMembershipId,
    incidentId: alert.incidentId
  };
}

const severities: readonly AlertSeverity[] = ["critical", "high", "normal", "low"];

/**
 * The summary a landing screen opens with, counted from the same two reads the screen can do
 * itself. Pure, so the counting is a test rather than a route somebody has to exercise.
 *
 * `observedFrom` is the oldest reading and not the newest: a summary is only as fresh as the
 * stalest thing in it, and the freshest would hide the instance that stopped answering yesterday.
 * With nothing to summarise it is null rather than `now`, which would be an age we do not have.
 */
export function overviewOf(input: { automations: readonly AutomationRecord[]; alerts: readonly AlertEventRecord[] }) {
  const bySeverity = Object.fromEntries(
    severities.map((severity) => [severity, input.alerts.filter((alert) => alert.severity === severity).length])
  ) as Record<AlertSeverity, number>;

  const readings = input.automations.map((automation) => automation.observedAt.getTime());

  return {
    automations: {
      total: input.automations.length,
      active: input.automations.filter((automation) => automation.active).length,
      linked: input.automations.filter((automation) => automation.customerId !== null).length
    },
    alerts: {
      total: input.alerts.length,
      acknowledged: input.alerts.filter((alert) => alert.acknowledgedAt !== null).length,
      bySeverity
    },
    observedFrom: readings.length > 0 ? new Date(Math.min(...readings)) : null
  };
}

const ruleParams = {
  type: "object",
  additionalProperties: false,
  required: ["ruleId"],
  properties: { ruleId: { type: "string", format: "uuid" } }
} as const;

const alertParams = {
  type: "object",
  additionalProperties: false,
  required: ["alertId"],
  properties: { alertId: { type: "string", format: "uuid" } }
} as const;

const linkParams = {
  type: "object",
  additionalProperties: false,
  required: ["instanceId", "externalId"],
  properties: {
    instanceId: { type: "string", format: "uuid" },
    externalId: { type: "string", minLength: 1, maxLength: 200 }
  }
} as const;

/** The rule fields a request may set. `kind` and `instanceId` are fixed once the rule exists. */
const ruleFields = {
  name: { type: "string", minLength: 3, maxLength: 120 },
  targetType: { type: "string", enum: ["instance", "automation"] },
  targetId: { type: ["string", "null"], minLength: 1, maxLength: 200 },
  severity: { type: "string", enum: ["critical", "high", "normal", "low"] },
  // Bounded here and validated by the domain: what a parameter means depends on the kind, and a
  // second opinion in JSON Schema would only be a second thing to keep in step with the first.
  params: { type: "object" },
  freshnessSeconds: { type: "integer", minimum: 60, maximum: 86400 },
  opensIncident: { type: "boolean" }
} as const;

export function registerInfrastructureRoutes({ app, database, auth, infrastructure }: InfrastructureContext) {
  /** The same shape as the integrations surface: a refusal is recorded before the error travels. */
  async function requireAudited(
    context: TenantContext,
    request: FastifyRequest,
    permission: Parameters<typeof requirePermission>[1],
    event: { action: string; targetType: string; targetId?: string; metadata?: Record<string, string> }
  ) {
    try {
      requirePermission(context, permission);
    } catch (error) {
      await writeAudit(database, context, request, { ...event, outcome: "denied" });
      throw error;
    }
  }

  app.get(
    "/api/v1/infrastructure/overview",
    {
      schema: {
        tags: ["infrastructure"],
        summary: "What is running and what is on fire",
        description:
          "Counts drawn from the automations and the live alerts, with `observedFrom` — the oldest reading behind the figures. Null when there is nothing to summarise: an age we do not have is not reported as now."
      }
    },
    async (request) => {
      const context = await resolveTenantContext(auth, database, request);
      requirePermission(context, "infrastructure:read");
      const [automations, alerts] = await Promise.all([
        infrastructure.listAutomations(context),
        infrastructure.listAlerts(context, { status: "firing" })
      ]);
      return { overview: overviewOf({ automations, alerts }) };
    }
  );

  app.get(
    "/api/v1/infrastructure/automations",
    {
      schema: {
        tags: ["infrastructure"],
        summary: "Every automation the connectors have seen",
        description:
          "What the provider says exists, with the client it was associated with and the note somebody left. No provider address: the response carries `instanceId` and `externalId`, and the screen builds the link."
      }
    },
    async (request) => {
      const context = await resolveTenantContext(auth, database, request);
      requirePermission(context, "infrastructure:read");
      return { automations: (await infrastructure.listAutomations(context)).map(automationResponse) };
    }
  );

  app.put<{
    Params: { instanceId: string; externalId: string };
    Body: { customerId?: string | null; notes?: string | null };
  }>(
    "/api/v1/infrastructure/automations/:instanceId/:externalId/link",
    {
      schema: {
        tags: ["infrastructure"],
        summary: "Associate an automation with a client",
        description:
          "A null `customerId` withdraws the association and keeps the note: somebody wrote it, and losing it as a side effect of unlinking would be a surprise. The association outlives the automation, so it survives a workflow being archived.",
        params: linkParams,
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            customerId: { type: ["string", "null"], format: "uuid" },
            notes: { type: ["string", "null"], maxLength: 2000 }
          }
        }
      }
    },
    async (request) => {
      const context = await resolveTenantContext(auth, database, request);
      const { instanceId, externalId } = request.params;
      const event = {
        action: "infrastructure.automation_linked",
        targetType: "infra_automation",
        targetId: externalId,
        metadata: { instanceId }
      };
      await requireAudited(context, request, "infrastructure:operate", event);
      await infrastructure.linkAutomation(context, {
        instanceId,
        externalId,
        customerId: request.body.customerId ?? null,
        notes: request.body.notes ?? null
      });
      await writeAudit(database, context, request, {
        ...event,
        outcome: "success",
        // The client it now belongs to, never the note: a note is free text somebody typed.
        metadata: { instanceId, customerId: request.body.customerId ?? "none" }
      });
      return { linked: true };
    }
  );

  app.get(
    "/api/v1/infrastructure/alert-rules",
    { schema: { tags: ["infrastructure"], summary: "Every alert rule of this tenant" } },
    async (request) => {
      const context = await resolveTenantContext(auth, database, request);
      requirePermission(context, "infrastructure:read");
      return { rules: (await infrastructure.listRules(context)).map(ruleResponse) };
    }
  );

  app.post<{ Body: CreateAlertRuleInput }>(
    "/api/v1/infrastructure/alert-rules",
    {
      schema: {
        tags: ["infrastructure"],
        summary: "Decide what is worth an alert",
        description:
          "`freshnessSeconds` is how old the data may be before the rule reports that it cannot see rather than that all is well. A rule that cannot be evaluated is refused rather than stored: one sitting in the table looks like coverage and never fires.",
        body: {
          type: "object",
          additionalProperties: false,
          required: ["name", "kind", "instanceId", "targetType", "severity", "freshnessSeconds"],
          properties: {
            ...ruleFields,
            kind: { type: "string", enum: ["workflow_failed"] },
            instanceId: { type: "string", format: "uuid" }
          }
        }
      }
    },
    async (request, reply) => {
      const context = await resolveTenantContext(auth, database, request);
      const event = {
        action: "infrastructure.alert_rule_created",
        targetType: "infra_alert_rule",
        metadata: { kind: request.body.kind, instanceId: request.body.instanceId }
      };
      await requireAudited(context, request, "infrastructure:operate", event);
      const rule = await infrastructure.createRule(context, {
        ...request.body,
        targetId: request.body.targetId ?? null,
        params: request.body.params ?? {},
        opensIncident: request.body.opensIncident ?? false
      });
      await writeAudit(database, context, request, {
        ...event,
        targetId: rule.id,
        outcome: "success",
        // Identifiers, never the parameters whole: acceptance criterion of the audit section.
        metadata: { kind: rule.kind, instanceId: rule.instanceId }
      });
      return reply.code(201).send({ rule: ruleResponse(rule) });
    }
  );

  app.patch<{ Params: { ruleId: string }; Body: UpdateAlertRuleInput }>(
    "/api/v1/infrastructure/alert-rules/:ruleId",
    {
      schema: {
        tags: ["infrastructure"],
        summary: "Change a rule",
        description:
          "Only what the body mentions changes. Disabling a rule resolves the alerts it was keeping alive, because an operator who disabled it has said what they think of it.",
        params: ruleParams,
        body: {
          type: "object",
          additionalProperties: false,
          minProperties: 1,
          properties: { ...ruleFields, enabled: { type: "boolean" } }
        }
      }
    },
    async (request) => {
      const context = await resolveTenantContext(auth, database, request);
      const { ruleId } = request.params;
      const event = {
        action: "infrastructure.alert_rule_updated",
        targetType: "infra_alert_rule",
        targetId: ruleId
      };
      await requireAudited(context, request, "infrastructure:operate", event);
      const rule = await infrastructure.updateRule(context, ruleId, request.body);
      await writeAudit(database, context, request, {
        ...event,
        outcome: "success",
        metadata: { enabled: String(rule.enabled), severity: rule.severity }
      });
      return { rule: ruleResponse(rule) };
    }
  );

  app.delete<{ Params: { ruleId: string } }>(
    "/api/v1/infrastructure/alert-rules/:ruleId",
    {
      schema: {
        tags: ["infrastructure"],
        summary: "Remove a rule",
        description: "The alerts it raised go with it: they are evidence about a rule that no longer exists.",
        params: ruleParams
      }
    },
    async (request, reply) => {
      const context = await resolveTenantContext(auth, database, request);
      const { ruleId } = request.params;
      const event = {
        action: "infrastructure.alert_rule_deleted",
        targetType: "infra_alert_rule",
        targetId: ruleId
      };
      await requireAudited(context, request, "infrastructure:operate", event);
      await infrastructure.deleteRule(context, ruleId);
      await writeAudit(database, context, request, { ...event, outcome: "success" });
      return reply.code(204).send();
    }
  );

  app.get<{ Querystring: { status?: "firing" | "resolved" } }>(
    "/api/v1/infrastructure/alerts",
    {
      schema: {
        tags: ["infrastructure"],
        summary: "What has fired",
        description:
          "`occurrences` counts how many passes have seen the same thing: one alert that counts up rather than a row per failure. Without `status`, the resolved ones come too, newest reading first.",
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: { status: { type: "string", enum: ["firing", "resolved"] } }
        }
      }
    },
    async (request) => {
      const context = await resolveTenantContext(auth, database, request);
      requirePermission(context, "infrastructure:read");
      const status = request.query.status;
      const alerts = await infrastructure.listAlerts(context, status ? { status } : {});
      return { alerts: alerts.map(alertResponse) };
    }
  );

  app.post<{ Params: { alertId: string } }>(
    "/api/v1/infrastructure/alerts/:alertId/acknowledge",
    {
      schema: {
        tags: ["infrastructure"],
        summary: "Say somebody has seen it",
        description:
          "Does not resolve anything. The sweep owns resolution — it resolves what is no longer true — and a person acknowledging an alert has not made the thing stop failing. The first hand raised is the one recorded.",
        params: alertParams
      }
    },
    async (request) => {
      const context = await resolveTenantContext(auth, database, request);
      const { alertId } = request.params;
      const event = { action: "infrastructure.alert_acknowledged", targetType: "infra_alert_event", targetId: alertId };
      await requireAudited(context, request, "infrastructure:operate", event);
      const alert = await infrastructure.acknowledgeAlert(context, alertId);
      await writeAudit(database, context, request, { ...event, outcome: "success" });
      return { alert: alertResponse(alert) };
    }
  );

  app.post<{ Params: { alertId: string } }>(
    "/api/v1/infrastructure/alerts/:alertId/resolve",
    {
      schema: {
        tags: ["infrastructure"],
        summary: "Close an alert by hand",
        description:
          "For the case the sweep will not close on its own. Any incident it opened goes to `monitoring` rather than `resolved`: the symptom stopping is not evidence that anybody looked into why.",
        params: alertParams
      }
    },
    async (request) => {
      const context = await resolveTenantContext(auth, database, request);
      const { alertId } = request.params;
      const event = { action: "infrastructure.alert_resolved", targetType: "infra_alert_event", targetId: alertId };
      await requireAudited(context, request, "infrastructure:operate", event);
      const alert = await infrastructure.resolveAlert(context, alertId, new Date());
      await writeAudit(database, context, request, { ...event, outcome: "success" });
      return { alert: alertResponse(alert) };
    }
  );
}

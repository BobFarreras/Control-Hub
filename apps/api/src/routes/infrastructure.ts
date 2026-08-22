import type {
  AlertEventRecord,
  AlertRuleRecord,
  AutomationRecord,
  CreateAlertRuleInput,
  DeclareHostInput,
  DeclareServiceInput,
  HostRecord,
  Inventory,
  ObservedHost,
  ObservedService,
  ServiceRecord,
  UpdateAlertRuleInput,
  UpdateHostInput,
  UpdateServiceInput
} from "@control-hub/application";
import {
  alertRuleKinds,
  type AlertSeverity,
  type ConnectorDiagnosis,
  type ConnectorDiagnosisStep,
  type CurrentReading,
  type JsonValue,
  type TenantContext
} from "@control-hub/domain";
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

export function hostResponse(host: HostRecord) {
  return {
    id: host.id,
    name: host.name,
    hostname: host.hostname,
    environment: host.environment,
    notes: host.notes,
    createdAt: host.createdAt,
    updatedAt: host.updatedAt
  };
}

export function serviceResponse(service: ServiceRecord) {
  return {
    id: service.id,
    hostId: service.hostId,
    name: service.name,
    kind: service.kind,
    matchKey: service.matchKey,
    expectedState: service.expectedState,
    customerId: service.customerId,
    createdAt: service.createdAt,
    updatedAt: service.updatedAt
  };
}

/**
 * What a reading may say to a client, named per kind of thing rather than handed over whole.
 *
 * The connector already writes a projection field by field, so this is the second fence and not
 * the first -- but it is the one on the side of the wire a browser is on. A field a future
 * collector starts publishing reaches nobody by the mere fact of existing, which is the same rule
 * every other response on this surface follows. A prefix nobody lists carries nothing, which is
 * the safe way round: a new kind of observed thing shows its state and its age, and somebody has
 * to decide on purpose what else it may show.
 */
const readableFields: Readonly<Record<string, readonly string[]>> = {
  host: ["cpuBusyRatio", "memoryUsedRatio", "filesystemUsedRatio", "load1", "uptimeSeconds"],
  container: ["lastSeenAt", "startedAt", "memoryBytes", "cpuCores"],
  probe: ["success", "scrapeUp", "durationSeconds", "certificateExpiresAt"],
  backup: ["lastSuccessAt"]
};

export function readingResponse(matchKey: string, reading: CurrentReading) {
  const colon = matchKey.indexOf(":");
  const data: Record<string, JsonValue> = {};
  for (const field of readableFields[colon === -1 ? "" : matchKey.slice(0, colon)] ?? []) {
    const value = reading.data[field];
    if (value !== undefined) data[field] = value;
  }
  return { state: reading.state, observedAt: reading.observedAt, data };
}

export function observedServiceResponse(service: ObservedService) {
  return { ...serviceResponse(service), reading: readingResponse(service.matchKey, service.reading) };
}

/** A host's reading is looked up by the identifier its metrics carry, which is `host:<hostname>`. */
export function observedHostResponse(host: ObservedHost) {
  return {
    ...hostResponse(host),
    reading: readingResponse(`host:${host.hostname}`, host.reading),
    services: host.services.map(observedServiceResponse)
  };
}

export function inventoryResponse(inventory: Inventory) {
  return { hosts: inventory.hosts.map(observedHostResponse), observedFrom: inventory.observedFrom };
}

/**
 * What a finding may say to a client, named per rung rather than handed over whole.
 *
 * The domain builds a diagnosis with no field an address could occupy, so this is the second
 * fence and not the first — but it is the one on the side of the wire a browser is on, and it is
 * the reason a key a later rung starts attaching reaches nobody by the mere fact of existing. A
 * rung listed with no keys says only its status and its code, which is the safe way round.
 */
const evidenceKeys: Readonly<Record<ConnectorDiagnosisStep, readonly string[]>> = {
  migrations: ["migrations"],
  allowlist: [],
  reachable: [],
  answers_prometheus: [],
  scraping: [],
  matching: ["seen", "declared"]
};

/**
 * How many names travel, and why the count travels with them.
 *
 * A collector scraping four hundred targets would otherwise turn one question into a data dump,
 * and the answer somebody needs is settled by the first handful. The total goes too so the screen
 * can say how many it is not showing: a list cut short and drawn as if it were the whole thing is
 * the same class of lie as a stale figure drawn without its age.
 */
const evidenceLimit = 20;

export function diagnosisResponse(diagnosis: ConnectorDiagnosis) {
  return {
    problem: diagnosis.problem,
    findings: diagnosis.findings.map((finding) => {
      const evidence: Record<string, { values: readonly string[]; total: number }> = {};
      for (const key of evidenceKeys[finding.step]) {
        const values = finding.evidence[key];
        if (values && values.length > 0)
          evidence[key] = { values: values.slice(0, evidenceLimit), total: values.length };
      }
      return { step: finding.step, status: finding.status, code: finding.code, evidence };
    })
  };
}

const instanceParams = {
  type: "object",
  additionalProperties: false,
  required: ["instanceId"],
  properties: { instanceId: { type: "string", format: "uuid" } }
} as const;

const hostParams = {
  type: "object",
  additionalProperties: false,
  required: ["hostId"],
  properties: { hostId: { type: "string", format: "uuid" } }
} as const;

const serviceParams = {
  type: "object",
  additionalProperties: false,
  required: ["serviceId"],
  properties: { serviceId: { type: "string", format: "uuid" } }
} as const;

/** `hostname` is capped where the connector caps a host label, so `host:<label>` still fits. */
const hostFields = {
  name: { type: "string", minLength: 3, maxLength: 120 },
  hostname: { type: "string", minLength: 1, maxLength: 190 },
  environment: { type: "string", enum: ["production", "staging", "development"] },
  notes: { type: ["string", "null"], maxLength: 2000 }
} as const;

/** `hostId` is absent from the patch on purpose: a service that moved machine is a new service. */
const serviceFields = {
  name: { type: "string", minLength: 3, maxLength: 120 },
  kind: { type: "string", enum: ["container", "http", "database", "automation"] },
  matchKey: { type: "string", minLength: 1, maxLength: 200 },
  expectedState: { type: "string", enum: ["up", "stopped", "ignored"] },
  customerId: { type: ["string", "null"], format: "uuid" }
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
    "/api/v1/infrastructure/inventory",
    {
      schema: {
        tags: ["infrastructure"],
        summary: "Every machine and service, with what is currently known of it",
        description:
          "The declared inventory joined to its readings, judged exactly as the `service_down` rule judges one, so a dashboard and an alert cannot disagree about what down means. `state` has three values and the third is the point: `unknown` is a collector we have lost sight of, and it is never drawn as an outage. `observedFrom` is the oldest reading behind the answer, because a dashboard is only as fresh as the stalest thing on it."
      }
    },
    async (request) => {
      const context = await resolveTenantContext(auth, database, request);
      requirePermission(context, "infrastructure:read");
      return { inventory: inventoryResponse(await infrastructure.readInventory(context, new Date())) };
    }
  );

  app.get<{ Params: { instanceId: string } }>(
    "/api/v1/infrastructure/connectors/:instanceId/diagnosis",
    {
      schema: {
        tags: ["infrastructure"],
        summary: "Why a collector is telling us nothing",
        params: instanceParams,
        description:
          "The chain of things that have to hold before a reading can appear, answered one rung at a time and stopped at the first that does not. A rung the chain never reached is `unchecked` and one nobody has gathered evidence for is `unknown` — neither is a failure, and reporting them as one is what turns a tunnel nobody has knocked on into a tunnel somebody reports as shut. The answer carries migration file names and `instance` labels and nothing else: no base address, no credential and no provider hostname, because the sentence that needs the address is composed on the screen out of what the person just typed."
      }
    },
    async (request) => {
      const context = await resolveTenantContext(auth, database, request);
      requirePermission(context, "infrastructure:read");
      return { diagnosis: diagnosisResponse(await infrastructure.diagnose(context, request.params.instanceId)) };
    }
  );

  app.get(
    "/api/v1/infrastructure/hosts",
    {
      schema: {
        tags: ["infrastructure"],
        summary: "Every machine somebody declared",
        description:
          "The inventory, not the readings. `hostname` is the label a reading is matched to a host by, which is why a host cannot exist without one."
      }
    },
    async (request) => {
      const context = await resolveTenantContext(auth, database, request);
      requirePermission(context, "infrastructure:read");
      return { hosts: (await infrastructure.listHosts(context)).map(hostResponse) };
    }
  );

  app.post<{ Body: DeclareHostInput }>(
    "/api/v1/infrastructure/hosts",
    {
      schema: {
        tags: ["infrastructure"],
        summary: "Declare a machine we look after",
        description:
          "`hostname` is required and unique: two hosts claiming one label would turn a single outage into two alerts about the same machine. There is no route to delete a host — a decommissioned machine is one whose `environment` says so, and the privilege on the table says the same.",
        body: {
          type: "object",
          additionalProperties: false,
          required: ["name", "hostname", "environment"],
          properties: hostFields
        }
      }
    },
    async (request, reply) => {
      const context = await resolveTenantContext(auth, database, request);
      const event = {
        action: "infrastructure.host_declared",
        targetType: "infra_host",
        metadata: { hostname: request.body.hostname, environment: request.body.environment }
      };
      await requireAudited(context, request, "infrastructure:operate", event);
      const host = await infrastructure.declareHost(context, { ...request.body, notes: request.body.notes ?? null });
      await writeAudit(database, context, request, { ...event, targetId: host.id, outcome: "success" });
      return reply.code(201).send({ host: hostResponse(host) });
    }
  );

  app.get<{ Params: { hostId: string } }>(
    "/api/v1/infrastructure/hosts/:hostId",
    { schema: { tags: ["infrastructure"], summary: "One machine", params: hostParams } },
    async (request) => {
      const context = await resolveTenantContext(auth, database, request);
      requirePermission(context, "infrastructure:read");
      return { host: hostResponse(await infrastructure.getHost(context, request.params.hostId)) };
    }
  );

  app.patch<{ Params: { hostId: string }; Body: UpdateHostInput }>(
    "/api/v1/infrastructure/hosts/:hostId",
    {
      schema: {
        tags: ["infrastructure"],
        summary: "Correct what was declared",
        description:
          "Only the fields present are changed. A null `notes` clears the note, which is why absence and null are not the same thing here.",
        params: hostParams,
        body: { type: "object", additionalProperties: false, properties: hostFields }
      }
    },
    async (request) => {
      const context = await resolveTenantContext(auth, database, request);
      const { hostId } = request.params;
      const event = { action: "infrastructure.host_updated", targetType: "infra_host", targetId: hostId };
      await requireAudited(context, request, "infrastructure:operate", event);
      const host = await infrastructure.updateHost(context, hostId, request.body);
      await writeAudit(database, context, request, { ...event, outcome: "success" });
      return { host: hostResponse(host) };
    }
  );

  app.get<{ Querystring: { hostId?: string } }>(
    "/api/v1/infrastructure/services",
    {
      schema: {
        tags: ["infrastructure"],
        summary: "Every service worth being told about",
        description:
          "`kind` says what the service is; `matchKey` says how it is observed — the complete `external_id` of the record, prefix included. They are separate because a database can be seen as a container.",
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: { hostId: { type: "string", format: "uuid" } }
        }
      }
    },
    async (request) => {
      const context = await resolveTenantContext(auth, database, request);
      requirePermission(context, "infrastructure:read");
      const { hostId } = request.query;
      const services = await infrastructure.listServices(context, hostId === undefined ? {} : { hostId });
      return { services: services.map(serviceResponse) };
    }
  );

  app.post<{ Body: DeclareServiceInput }>(
    "/api/v1/infrastructure/services",
    {
      schema: {
        tags: ["infrastructure"],
        summary: "Declare a service on a host",
        description:
          "`expectedState` is what the evaluation should conclude: `up` for the ordinary case, `stopped` for something that must stay down and about which we want to hear if it returns, `ignored` for declared but deliberately not alerted on. Two services may not share a `matchKey`: that would be two alerts about one outage.",
        body: {
          type: "object",
          additionalProperties: false,
          required: ["hostId", "name", "kind", "matchKey"],
          properties: { ...serviceFields, hostId: { type: "string", format: "uuid" } }
        }
      }
    },
    async (request, reply) => {
      const context = await resolveTenantContext(auth, database, request);
      const event = {
        action: "infrastructure.service_declared",
        targetType: "infra_service",
        metadata: { hostId: request.body.hostId, kind: request.body.kind, matchKey: request.body.matchKey }
      };
      await requireAudited(context, request, "infrastructure:operate", event);
      const service = await infrastructure.declareService(context, {
        ...request.body,
        expectedState: request.body.expectedState ?? "up",
        customerId: request.body.customerId ?? null
      });
      await writeAudit(database, context, request, { ...event, targetId: service.id, outcome: "success" });
      return reply.code(201).send({ service: serviceResponse(service) });
    }
  );

  app.patch<{ Params: { serviceId: string }; Body: UpdateServiceInput }>(
    "/api/v1/infrastructure/services/:serviceId",
    {
      schema: {
        tags: ["infrastructure"],
        summary: "Correct a declared service",
        description: "A null `customerId` withdraws the association. `hostId` is not patchable.",
        params: serviceParams,
        body: { type: "object", additionalProperties: false, properties: serviceFields }
      }
    },
    async (request) => {
      const context = await resolveTenantContext(auth, database, request);
      const { serviceId } = request.params;
      const event = { action: "infrastructure.service_updated", targetType: "infra_service", targetId: serviceId };
      await requireAudited(context, request, "infrastructure:operate", event);
      const service = await infrastructure.updateService(context, serviceId, request.body);
      await writeAudit(database, context, request, { ...event, outcome: "success" });
      return { service: serviceResponse(service) };
    }
  );

  app.delete<{ Params: { serviceId: string } }>(
    "/api/v1/infrastructure/services/:serviceId",
    {
      schema: {
        tags: ["infrastructure"],
        summary: "Stop watching a service",
        description: "Deciding something no longer matters is ordinary and audited. A host has no such route.",
        params: serviceParams
      }
    },
    async (request, reply) => {
      const context = await resolveTenantContext(auth, database, request);
      const { serviceId } = request.params;
      const event = { action: "infrastructure.service_deleted", targetType: "infra_service", targetId: serviceId };
      await requireAudited(context, request, "infrastructure:operate", event);
      await infrastructure.deleteService(context, serviceId);
      await writeAudit(database, context, request, { ...event, outcome: "success" });
      return reply.code(204).send();
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
            kind: { type: "string", enum: [...alertRuleKinds] },
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

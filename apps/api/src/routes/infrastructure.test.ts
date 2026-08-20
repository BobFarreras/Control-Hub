import type {
  AlertEventRecord,
  AlertRuleRecord,
  AutomationRecord,
  HostRecord,
  ServiceRecord
} from "@control-hub/application";
import { alertRuleKinds } from "@control-hub/domain";
import { describe, expect, it } from "vitest";
import {
  alertResponse,
  automationResponse,
  hostResponse,
  overviewOf,
  ruleResponse,
  serviceResponse
} from "./infrastructure.js";

/**
 * An automation as the adapter hands it over, with two things on it that must not travel: the
 * provider's own address, and a token somebody pasted into a note. Both are cast on deliberately
 * -- the types have no field for either, which is exactly the property being tested.
 */
const automation = {
  instanceId: "i-1",
  externalId: "workflow:42",
  name: "Invoicing",
  active: true,
  archived: false,
  tags: ["billing"],
  observedAt: new Date("2026-08-13T11:55:00.000Z"),
  customerId: "c-1",
  notes: "les factures",
  baseUrl: "https://n8n.internal.example/rest",
  apiKey: "n8n_api_9f2c8ab4"
} as unknown as AutomationRecord;

const rule: AlertRuleRecord = {
  id: "r-1",
  name: "Invoicing failures",
  kind: "workflow_failed",
  instanceId: "i-1",
  targetType: "automation",
  targetId: "workflow:42",
  severity: "high",
  params: { withinMinutes: 30 },
  freshnessSeconds: 900,
  opensIncident: true,
  enabled: true,
  createdAt: new Date(0),
  updatedAt: new Date(0)
};

const alert: AlertEventRecord = {
  id: "a-1",
  ruleId: "r-1",
  ruleName: "Invoicing failures",
  dedupKey: "workflow:42",
  status: "firing",
  severity: "high",
  summary: { workflowId: "42", failures: "3" },
  startedAt: new Date("2026-08-13T11:00:00.000Z"),
  lastSeenAt: new Date("2026-08-13T11:58:00.000Z"),
  occurrences: 3,
  resolvedAt: null,
  acknowledgedAt: null,
  acknowledgedByMembershipId: null,
  incidentId: null
};

describe("what an automation response says", () => {
  /**
   * Acceptance criterion 2, at the layer that decides it. The response is written field by field,
   * so neither a column added later nor a value the provider happened to return can reach a
   * client by simply existing on the row.
   */
  it("carries no provider address and no secret, whatever arrived on the row", () => {
    const response = automationResponse(automation);
    const serialized = JSON.stringify(response);

    expect(serialized).not.toContain("n8n_api_9f2c8ab4");
    expect(serialized).not.toContain("n8n.internal.example");
    expect(Object.keys(response).sort()).toEqual([
      "active",
      "archived",
      "customerId",
      "externalId",
      "instanceId",
      "name",
      "notes",
      "observedAt",
      "tags"
    ]);
  });

  /**
   * The screen builds the link from these two and the base it already has. Sending the assembled
   * URL would put the provider's address in every response, every log line and every screenshot,
   * for a link the client can compose itself.
   */
  it("gives the screen what it needs to build a link, and not the link", () => {
    expect(automationResponse(automation)).toMatchObject({ instanceId: "i-1", externalId: "workflow:42" });
  });

  it("carries the reading with its hour, because an old figure without its age is a lie", () => {
    expect(automationResponse(automation).observedAt).toEqual(automation.observedAt);
  });
});

describe("what a rule response says", () => {
  it("describes the rule, its target and its budget", () => {
    expect(ruleResponse(rule)).toEqual({
      id: "r-1",
      name: "Invoicing failures",
      kind: "workflow_failed",
      instanceId: "i-1",
      targetType: "automation",
      targetId: "workflow:42",
      severity: "high",
      params: { withinMinutes: 30 },
      freshnessSeconds: 900,
      opensIncident: true,
      enabled: true,
      createdAt: rule.createdAt,
      updatedAt: rule.updatedAt
    });
  });
});

describe("what an alert response says", () => {
  it("carries the count, the incident and a summary that is ours, never a provider payload", () => {
    expect(alertResponse(alert)).toEqual({
      id: "a-1",
      ruleId: "r-1",
      ruleName: "Invoicing failures",
      dedupKey: "workflow:42",
      status: "firing",
      severity: "high",
      summary: { workflowId: "42", failures: "3" },
      startedAt: alert.startedAt,
      lastSeenAt: alert.lastSeenAt,
      occurrences: 3,
      resolvedAt: null,
      acknowledgedAt: null,
      acknowledgedByMembershipId: null,
      incidentId: null
    });
  });
});

describe("the overview", () => {
  const automations: AutomationRecord[] = [
    automation,
    { ...automation, externalId: "workflow:43", active: false, customerId: null },
    { ...automation, externalId: "workflow:44", customerId: "c-2", observedAt: new Date("2026-08-13T09:00:00.000Z") }
  ];
  const alerts: AlertEventRecord[] = [
    alert,
    { ...alert, id: "a-2", severity: "critical" },
    { ...alert, id: "a-3", severity: "critical", acknowledgedAt: new Date("2026-08-13T11:30:00.000Z") }
  ];

  it("counts what there is, how much of it runs and how much belongs to somebody", () => {
    expect(overviewOf({ automations, alerts })).toMatchObject({
      automations: { total: 3, active: 2, linked: 2 }
    });
  });

  it("counts the live alerts by severity, and how many a person has seen", () => {
    expect(overviewOf({ automations, alerts })).toMatchObject({
      alerts: { total: 3, acknowledged: 1, bySeverity: { critical: 2, high: 1, normal: 0, low: 0 } }
    });
  });

  /**
   * The oldest reading and not the newest: a summary is only as fresh as the stalest thing in it,
   * and reporting the freshest would hide the one instance that stopped answering yesterday.
   */
  it("reports the oldest reading behind it, so the whole figure travels with its age", () => {
    expect(overviewOf({ automations, alerts }).observedFrom).toEqual(new Date("2026-08-13T09:00:00.000Z"));
  });

  it("says nothing rather than lying about an age it does not have", () => {
    expect(overviewOf({ automations: [], alerts: [] })).toEqual({
      automations: { total: 0, active: 0, linked: 0 },
      alerts: { total: 0, acknowledged: 0, bySeverity: { critical: 0, high: 0, normal: 0, low: 0 } },
      observedFrom: null
    });
  });
});
/**
 * A host as the adapter hands it over, with two things a row must never carry outward: an address
 * somebody pasted while declaring the machine, and a credential. Both are cast on deliberately --
 * the type has no field for either, which is the property under test.
 */
const host = {
  id: "h-1",
  name: "VPS principal",
  hostname: "node-exporter:9100",
  environment: "production",
  notes: "la de produccio",
  createdAt: new Date(0),
  updatedAt: new Date(0),
  baseUrl: "https://prometheus.internal.example",
  sshKey: "ssh_key_5c1d0e"
} as unknown as HostRecord;

const service: ServiceRecord = {
  id: "s-1",
  hostId: "h-1",
  name: "Automatitzacions",
  kind: "container",
  matchKey: "container:n8n",
  expectedState: "up",
  customerId: "c-1",
  createdAt: new Date(0),
  updatedAt: new Date(0)
};

describe("what an inventory response says", () => {
  it("carries no address and no secret, whatever arrived on the row", () => {
    const response = hostResponse(host);
    const serialized = JSON.stringify(response);

    expect(serialized).not.toContain("prometheus.internal.example");
    expect(serialized).not.toContain("ssh_key_5c1d0e");
    expect(Object.keys(response).sort()).toEqual([
      "createdAt",
      "environment",
      "hostname",
      "id",
      "name",
      "notes",
      "updatedAt"
    ]);
  });

  it("keeps the kind and the match key apart, because one is not derivable from the other", () => {
    const database = serviceResponse({ ...service, kind: "database", matchKey: "container:supabase-db" });

    expect(database.kind).toBe("database");
    expect(database.matchKey).toBe("container:supabase-db");
    expect(Object.keys(serviceResponse(service)).sort()).toEqual([
      "createdAt",
      "customerId",
      "expectedState",
      "hostId",
      "id",
      "kind",
      "matchKey",
      "name",
      "updatedAt"
    ]);
  });
});

describe("what a rule of the infrastructure kinds looks like on the way out", () => {
  it("carries the kind through untouched, so the screen can group by it", () => {
    for (const kind of alertRuleKinds) {
      expect(ruleResponse({ ...rule, kind })).toMatchObject({ kind });
    }
  });

  /**
   * The route's schema spreads the same array the engine's switch is checked against. Adding a
   * kind to one and forgetting the other used to be possible, and the symptom was a rule the API
   * refused to create for a reason nobody could see in either file.
   */
  it("accepts exactly the kinds the engine knows how to evaluate", () => {
    expect([...alertRuleKinds]).toEqual(["workflow_failed", "service_down", "certificate_expiring", "backup_stale"]);
  });
});

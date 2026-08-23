import type {
  AlertEventRecord,
  AlertRuleRecord,
  AutomationRecord,
  HostRecord,
  ServiceRecord
} from "@control-hub/application";
import { alertRuleKinds, type ConnectorDiagnosis, type DiagnosisFinding } from "@control-hub/domain";
import { describe, expect, it } from "vitest";
import {
  alertResponse,
  automationResponse,
  diagnosisResponse,
  hostResponse,
  inventoryResponse,
  overviewOf,
  readingResponse,
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

/**
 * The reading the technical dashboard draws, on the side of the wire a browser is on.
 *
 * The connector already writes a named projection, so the allow-list here is the second fence.
 * It exists because a future collector adding a field must not reach a client by the mere fact of
 * having been added: the same rule the rest of this surface follows, applied to a payload whose
 * shape a provider influences.
 */
describe("what a reading says on the way out", () => {
  const reading = {
    state: "up" as const,
    observedAt: new Date("2026-08-13T11:59:00.000Z"),
    instanceId: "instance-1",
    data: {
      cpuBusyRatio: 0.12,
      memoryUsedRatio: 0.4,
      filesystemUsedRatio: 0.6,
      load1: 0.2,
      uptimeSeconds: 900,
      scrapeUrl: "https://prometheus.internal.example/api/v1/query",
      apiToken: "prom_9f2c8ab4"
    }
  };

  it("names the fields it lets through, and drops what nobody asked for", () => {
    const response = readingResponse("host:node-exporter:9100", reading);
    const serialized = JSON.stringify(response);

    expect(response.state).toBe("up");
    expect(response.observedAt).toEqual(reading.observedAt);
    expect(Object.keys(response.data).sort()).toEqual([
      "cpuBusyRatio",
      "filesystemUsedRatio",
      "load1",
      "memoryUsedRatio",
      "uptimeSeconds"
    ]);
    expect(serialized).not.toContain("prometheus.internal.example");
    expect(serialized).not.toContain("prom_9f2c8ab4");
  });

  it("lets a container through only what a container publishes", () => {
    const container = readingResponse("container:n8n", {
      state: "up",
      observedAt: null,
      instanceId: "instance-1",
      data: { memoryBytes: 512, cpuCores: 0.01, host: "node-exporter:9100", cpuBusyRatio: 0.9 }
    });

    expect(Object.keys(container.data).sort()).toEqual(["cpuCores", "memoryBytes"]);
  });

  it("carries a certificate's expiry, which is the whole point of watching a probe", () => {
    const probe = readingResponse("probe:https://example.test/healthz", {
      state: "down",
      observedAt: null,
      instanceId: "instance-1",
      data: { success: false, scrapeUp: true, durationSeconds: 1.2, certificateExpiresAt: "2026-10-09T00:00:00.000Z" }
    });

    expect(probe.data).toEqual({
      success: false,
      scrapeUp: true,
      durationSeconds: 1.2,
      certificateExpiresAt: "2026-10-09T00:00:00.000Z"
    });
  });

  /** A prefix nobody listed shows its state and its age and nothing else, which is the safe way. */
  it("gives a kind nobody has decided about nothing but its state", () => {
    expect(
      readingResponse("printer:hp", { state: "unknown", observedAt: null, instanceId: null, data: { serial: "X" } })
    ).toEqual({
      state: "unknown",
      observedAt: null,
      instanceId: null,
      data: {}
    });
  });

  it("omits a field the collector did not write rather than sending it as null", () => {
    expect(
      readingResponse("host:vps", { state: "down", observedAt: null, instanceId: "instance-1", data: { load1: 0.2 } })
        .data
    ).toEqual({
      load1: 0.2
    });
  });
});

describe("the inventory a dashboard receives", () => {
  const reading = {
    state: "up" as const,
    observedAt: new Date("2026-08-13T11:59:00.000Z"),
    instanceId: "instance-1",
    data: {}
  };

  const emptySummary = {
    hosts: { total: 0, up: 0, down: 0, unknown: 0 },
    services: { total: 0, up: 0, down: 0, unknown: 0 }
  };

  it("hangs the services under their host and looks the host up by its own identifier", () => {
    const response = inventoryResponse({
      hosts: [
        {
          ...host,
          reading: { ...reading, data: { load1: 0.2, apiToken: "prom_9f2c8ab4" } },
          services: [{ ...service, reading: { ...reading, data: { memoryBytes: 512 } } }],
          labels: [],
          observed: []
        }
      ],
      summary: emptySummary,
      observedFrom: new Date("2026-08-13T11:58:00.000Z")
    });

    expect(response.hosts[0]).toMatchObject({ id: host.id, reading: { state: "up", data: { load1: 0.2 } } });
    expect(response.hosts[0]!.services).toMatchObject([{ id: service.id, reading: { data: { memoryBytes: 512 } } }]);
    expect(JSON.stringify(response)).not.toContain("prom_9f2c8ab4");
    expect(response.observedFrom).toEqual(new Date("2026-08-13T11:58:00.000Z"));
  });

  /**
   * The undeclared things a machine's page shows leave through the same allow-list as the rest.
   *
   * They are a newer field on an older answer, and a field added later is exactly the one that
   * gets its filtering forgotten.
   *
   * Specification: `docs/specifications/connector-onboarding.md`, "C8".
   */
  it("carries what was seen on a machine's labels, with nothing the allow-list does not name", () => {
    const response = inventoryResponse({
      hosts: [
        {
          ...host,
          reading,
          services: [],
          labels: ["cadvisor:8080"],
          observed: [
            {
              matchKey: "container:traefik",
              kind: "container" as const,
              name: "traefik",
              seenOn: "cadvisor:8080",
              declared: false,
              reading: { ...reading, data: { memoryBytes: 512, apiToken: "prom_9f2c8ab4" } }
            }
          ]
        }
      ],
      summary: emptySummary,
      observedFrom: null
    });

    expect(response.hosts[0]!.labels).toEqual(["cadvisor:8080"]);
    expect(response.hosts[0]!.observed).toMatchObject([
      { matchKey: "container:traefik", declared: false, reading: { data: { memoryBytes: 512 } } }
    ]);
    expect(JSON.stringify(response)).not.toContain("prom_9f2c8ab4");
  });

  it("says it has no age rather than inventing one", () => {
    expect(inventoryResponse({ hosts: [], summary: emptySummary, observedFrom: null })).toEqual({
      hosts: [],
      summary: emptySummary,
      observedFrom: null
    });
  });

  /**
   * The summary is passed through and never recomputed here. Counting it a second time on the way
   * out would let the route and the use case disagree about how many machines are down, which is
   * exactly the drift that keeping the count in the domain exists to prevent.
   */
  it("hands the summary over as it was counted", () => {
    const summary = {
      hosts: { total: 3, up: 1, down: 1, unknown: 1 },
      services: { total: 8, up: 6, down: 2, unknown: 0 }
    };

    expect(inventoryResponse({ hosts: [], summary, observedFrom: null }).summary).toEqual(summary);
  });

  /** Which collector read a line is what the fleet is filtered by, so the response has to carry it. */
  it("says which connector instance each reading came from", () => {
    const response = inventoryResponse({
      hosts: [
        {
          ...host,
          reading: { ...reading, instanceId: "instance-1" },
          services: [{ ...service, reading: { ...reading, instanceId: "instance-2" } }],
          labels: [],
          observed: []
        }
      ],
      summary: emptySummary,
      observedFrom: null
    });

    expect(response.hosts[0]!.reading.instanceId).toBe("instance-1");
    expect(response.hosts[0]!.services[0]!.reading.instanceId).toBe("instance-2");
  });
});

/**
 * The second fence, on the side of the wire a browser is on.
 *
 * The domain already builds a diagnosis with no field an address could occupy, so nothing here is
 * the only thing standing between a secret and a client. What it does hold is that a key a later
 * rung starts attaching reaches nobody by the mere fact of existing -- the same rule
 * `readableFields` holds for a reading, for the same reason.
 */
describe("what a diagnosis says on the way out", () => {
  const finding = (overrides: Partial<DiagnosisFinding> = {}): DiagnosisFinding => ({
    step: "matching",
    status: "failed",
    code: null,
    evidence: {},
    ...overrides
  });

  const answer = (findings: readonly DiagnosisFinding[], problem: ConnectorDiagnosis["problem"] = "matching") =>
    diagnosisResponse({ findings, problem });

  it("says which rung is the problem and what each of them found", () => {
    const response = answer([finding({ step: "migrations", status: "passed" })], "migrations");

    expect(response.problem).toBe("migrations");
    expect(response.findings[0]).toEqual({ step: "migrations", status: "passed", code: null, evidence: {} });
  });

  it("carries the code, which is what a screen turns into a sentence", () => {
    const response = answer([finding({ step: "reachable", code: "CONNECT_TIMEOUT" })], "reachable");
    expect(response.findings[0]?.code).toBe("CONNECT_TIMEOUT");
  });

  it("names the migrations and the two lists a mismatch needs", () => {
    const response = answer([
      finding({ step: "migrations", evidence: { migrations: ["0037_infrastructure_hosts.sql"] } }),
      finding({ evidence: { seen: ["node-exporter:9100"], declared: ["hub-vps"] } })
    ]);

    expect(response.findings[0]?.evidence).toEqual({
      migrations: { values: ["0037_infrastructure_hosts.sql"], total: 1 }
    });
    expect(response.findings[1]?.evidence).toEqual({
      seen: { values: ["node-exporter:9100"], total: 1 },
      declared: { values: ["hub-vps"], total: 1 }
    });
  });

  /** A key nobody listed travels nowhere, whatever a later rung decides to attach. */
  it("drops a key the rung was never allowed to say", () => {
    const leaky = finding({
      step: "allowlist",
      evidence: { baseUrl: ["http://prometheus.internal.example:9090"] }
    });

    expect(answer([leaky], "allowlist").findings[0]?.evidence).toEqual({});
    expect(JSON.stringify(answer([leaky], "allowlist"))).not.toContain("prometheus.internal.example");
  });

  it("refuses the same key on a rung that is not the one it belongs to", () => {
    const misplaced = finding({ step: "scraping", evidence: { seen: ["node-exporter:9100"] } });
    expect(answer([misplaced], "scraping").findings[0]?.evidence).toEqual({});
  });

  /**
   * A collector scraping four hundred targets would turn one question into a data dump, and the
   * answer is settled by the first handful. The total goes with the list so the screen can say how
   * many it is not showing: a list cut short and drawn as the whole thing is the same class of lie
   * as a figure drawn without its age.
   */
  it("cuts a long list short and says how long it really was", () => {
    const seen = Array.from({ length: 412 }, (_, index) => `node-${index}:9100`);
    const evidence = answer([finding({ evidence: { seen, declared: ["hub-vps"] } })]).findings[0]?.evidence;

    expect(evidence?.seen?.values).toHaveLength(20);
    expect(evidence?.seen?.total).toBe(412);
    expect(evidence?.seen?.values[0]).toBe("node-0:9100");
  });

  it("leaves out a list that is empty rather than sending an empty one", () => {
    expect(answer([finding({ evidence: { seen: [], declared: ["hub-vps"] } })]).findings[0]?.evidence).toEqual({
      declared: { values: ["hub-vps"], total: 1 }
    });
  });
});

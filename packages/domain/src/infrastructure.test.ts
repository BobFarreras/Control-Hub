import { describe, expect, it } from "vitest";
import {
  evaluateAlertRules,
  incidentFor,
  type AlertRule,
  type DeclaredService,
  type JsonValue,
  type LiveAlert,
  type ObservedRecord,
  type OperationFreshness
} from "./infrastructure.js";

const now = new Date("2026-08-13T12:00:00.000Z");
const instanceId = "instance-1";

const rule = (overrides: Partial<AlertRule> = {}): AlertRule => ({
  id: "rule-1",
  kind: "workflow_failed",
  name: "Invoicing failures",
  instanceId,
  targetType: "instance",
  targetId: null,
  severity: "high",
  params: {},
  freshnessSeconds: 900,
  opensIncident: false,
  enabled: true,
  ...overrides
});

const failure = (id: string, workflowId: string, minutesAgo: number): ObservedRecord => ({
  instanceId,
  operation: "pull_executions",
  externalId: `execution:${id}`,
  data: { workflowId, status: "error", startedAt: new Date(now.getTime() - minutesAgo * 60_000).toISOString() },
  firstSeenAt: new Date(now.getTime() - minutesAgo * 60_000),
  lastSeenAt: new Date(now.getTime() - minutesAgo * 60_000)
});

const fresh: OperationFreshness[] = [
  { instanceId, operation: "pull_executions", lastSuccessAt: new Date(now.getTime() - 60_000) }
];

const evaluate = (input: {
  rules?: readonly AlertRule[];
  records?: readonly ObservedRecord[];
  live?: readonly LiveAlert[];
  freshness?: readonly OperationFreshness[];
}) =>
  evaluateAlertRules({
    rules: input.rules ?? [rule()],
    records: input.records ?? [],
    services: [],
    liveAlerts: input.live ?? [],
    freshness: input.freshness ?? fresh,
    now
  });

describe("a workflow that keeps failing", () => {
  it("fires once per workflow, not once per failed execution", () => {
    const verdicts = evaluate({
      records: [failure("1", "wf-a", 5), failure("2", "wf-a", 9), failure("3", "wf-b", 2)]
    });

    expect(verdicts).toHaveLength(2);
    expect(verdicts.map((verdict) => verdict.dedupKey).sort()).toEqual(["workflow:wf-a", "workflow:wf-b"]);
    expect(verdicts.every((verdict) => verdict.status === "firing")).toBe(true);
  });

  it("counts the failures and names the last one, and carries no payload", () => {
    const verdicts = evaluate({ records: [failure("1", "wf-a", 30), failure("2", "wf-a", 4)] });

    expect(verdicts[0]).toMatchObject({
      ruleId: "rule-1",
      status: "firing",
      dedupKey: "workflow:wf-a",
      severity: "high",
      summary: { workflowId: "wf-a", failures: "2", lastFailureAt: "2026-08-13T11:56:00.000Z" }
    });
  });

  it("ignores failures older than the window it was asked about", () => {
    const rules = [rule({ params: { withinMinutes: 15 } })];
    expect(evaluate({ rules, records: [failure("1", "wf-a", 90)] })).toEqual([]);
    expect(evaluate({ rules, records: [failure("1", "wf-a", 10)] })).toHaveLength(1);
  });

  it("waits for the agreed number of failures before it says anything", () => {
    const rules = [rule({ params: { minimumFailures: 3 } })];
    expect(evaluate({ rules, records: [failure("1", "wf-a", 5), failure("2", "wf-a", 6)] })).toEqual([]);

    const third = [failure("1", "wf-a", 5), failure("2", "wf-a", 6), failure("3", "wf-a", 7)];
    expect(evaluate({ rules, records: third })).toHaveLength(1);
  });

  it("watches one workflow when it was pointed at one, and everything otherwise", () => {
    const records = [failure("1", "wf-a", 5), failure("2", "wf-b", 5)];
    const targeted = [rule({ targetType: "automation", targetId: "workflow:wf-b" })];

    expect(evaluate({ rules: targeted, records }).map((verdict) => verdict.dedupKey)).toEqual(["workflow:wf-b"]);
    expect(evaluate({ records })).toHaveLength(2);
  });

  it("reads nothing from another instance, even inside the same tenant", () => {
    const elsewhere = { ...failure("1", "wf-a", 5), instanceId: "instance-2" };
    expect(evaluate({ records: [elsewhere] })).toEqual([]);
  });

  it("reads only what the operation it depends on returned", () => {
    const workflowRecord = { ...failure("1", "wf-a", 5), operation: "pull_workflows" };
    expect(evaluate({ records: [workflowRecord] })).toEqual([]);
  });
});

describe("a workflow that stopped failing", () => {
  it("resolves the alert that is no longer true", () => {
    const live: LiveAlert[] = [{ ruleId: "rule-1", dedupKey: "workflow:wf-a" }];

    const verdicts = evaluate({ records: [], live });

    expect(verdicts).toEqual([
      { ruleId: "rule-1", status: "resolved", dedupKey: "workflow:wf-a", severity: "high", summary: {} }
    ]);
  });

  it("keeps a live alert alive rather than resolving and reopening it", () => {
    const live: LiveAlert[] = [{ ruleId: "rule-1", dedupKey: "workflow:wf-a" }];

    const verdicts = evaluate({ records: [failure("1", "wf-a", 5)], live });

    expect(verdicts).toEqual([expect.objectContaining({ status: "firing", dedupKey: "workflow:wf-a" })]);
  });

  it("resolves everything a rule had when somebody disables the rule", () => {
    const live: LiveAlert[] = [
      { ruleId: "rule-1", dedupKey: "workflow:wf-a" },
      { ruleId: "rule-1", dedupKey: "workflow:wf-b" }
    ];

    const verdicts = evaluate({ rules: [rule({ enabled: false })], records: [failure("1", "wf-a", 1)], live });

    expect(verdicts.map((verdict) => verdict.status)).toEqual(["resolved", "resolved"]);
  });

  it("leaves alone an alert belonging to a rule nobody asked about", () => {
    const live: LiveAlert[] = [{ ruleId: "rule-gone", dedupKey: "workflow:wf-a" }];
    expect(evaluate({ live })).toEqual([]);
  });
});

describe("a rule nobody is feeding", () => {
  const stale: OperationFreshness[] = [
    { instanceId, operation: "pull_executions", lastSuccessAt: new Date(now.getTime() - 3_600_000) }
  ];

  it("is starved rather than green, so it cannot pass for coverage", () => {
    const verdicts = evaluate({ freshness: stale });
    expect(verdicts).toEqual([
      { ruleId: "rule-1", status: "starved", dedupKey: "rule:rule-1", severity: "high", summary: {} }
    ]);
  });

  it("is starved when the operation has never once succeeded", () => {
    const never: OperationFreshness[] = [{ instanceId, operation: "pull_executions", lastSuccessAt: null }];
    expect(evaluate({ freshness: never })[0]?.status).toBe("starved");

    // And when nobody has even told us the operation exists.
    expect(evaluate({ freshness: [] })[0]?.status).toBe("starved");
  });

  it("does not fire on data it already knows is too old", () => {
    const verdicts = evaluate({ records: [failure("1", "wf-a", 5)], freshness: stale });
    expect(verdicts.map((verdict) => verdict.status)).toEqual(["starved"]);
  });

  /**
   * The reason decision 7 exists. Losing sight of n8n must produce one alert saying so, not a
   * wave of resolutions that look like every workflow recovered at the same moment.
   */
  it("does not resolve what was already firing, because we no longer know", () => {
    const live: LiveAlert[] = [{ ruleId: "rule-1", dedupKey: "workflow:wf-a" }];
    const verdicts = evaluate({ records: [], live, freshness: stale });

    expect(verdicts.map((verdict) => verdict.status)).toEqual(["starved"]);
    expect(verdicts.some((verdict) => verdict.status === "resolved")).toBe(false);
  });

  it("measures freshness against the budget the rule was given", () => {
    const aMinuteOld: OperationFreshness[] = [
      { instanceId, operation: "pull_executions", lastSuccessAt: new Date(now.getTime() - 61_000) }
    ];
    expect(evaluate({ rules: [rule({ freshnessSeconds: 60 })], freshness: aMinuteOld })[0]?.status).toBe("starved");
    expect(evaluate({ rules: [rule({ freshnessSeconds: 120 })], freshness: aMinuteOld })).toEqual([]);
  });
});

describe("the incident a rule opens", () => {
  it("opens nothing unless the rule was told to", () => {
    const verdict = evaluate({ records: [failure("1", "wf-a", 5)] })[0];
    expect(incidentFor(rule(), verdict!)).toBeNull();
  });

  it("carries the rule's severity, and a title that names the workflow", () => {
    const opener = rule({ opensIncident: true, severity: "critical" });
    const verdict = evaluate({ rules: [opener], records: [failure("1", "wf-a", 5)] })[0];

    expect(incidentFor(opener, verdict!)).toEqual({
      severity: "critical",
      title: "Invoicing failures: workflow:wf-a"
    });
  });

  it("opens nothing for a verdict that is not a fresh firing", () => {
    const opener = rule({ opensIncident: true });
    const resolved = {
      ruleId: "rule-1",
      status: "resolved" as const,
      dedupKey: "workflow:wf-a",
      severity: "high" as const,
      summary: {}
    };
    const starved = { ...resolved, status: "starved" as const, dedupKey: "rule:rule-1" };

    expect(incidentFor(opener, resolved)).toBeNull();
    expect(incidentFor(opener, starved)).toBeNull();
  });

  it("keeps a title inside what the incidents table accepts", () => {
    const opener = rule({ opensIncident: true, name: "x".repeat(120) });
    const verdict = evaluate({ rules: [opener], records: [failure("1", "w".repeat(180), 5)] })[0];

    const incident = incidentFor(opener, verdict!);
    expect(incident?.title.length).toBeLessThanOrEqual(200);
  });
});

describe("many rules at once", () => {
  it("judges each one on its own, so a starved rule does not silence a firing one", () => {
    const other = rule({ id: "rule-2", name: "Other", instanceId: "instance-2", freshnessSeconds: 60 });
    const verdicts = evaluate({
      rules: [rule(), other],
      records: [failure("1", "wf-a", 5)],
      freshness: fresh
    });

    expect(verdicts).toEqual([
      expect.objectContaining({ ruleId: "rule-1", status: "firing" }),
      expect.objectContaining({ ruleId: "rule-2", status: "starved" })
    ]);
  });

  it("gives the same answer twice for the same input, because a missed pass must not lose an alert", () => {
    const input = { records: [failure("1", "wf-a", 5), failure("2", "wf-b", 5)] };
    expect(evaluate(input)).toEqual(evaluate(input));
  });
});

/**
 * The three infrastructure rules of phase 7.2.
 *
 * They read the same table as the one above but ask a different question: not "did something
 * fail" but "is the thing we declared still there". The inventory is what makes the difference --
 * absence only means an outage when somebody said the thing should exist.
 */
const service = (overrides: Partial<DeclaredService> = {}): DeclaredService => ({
  name: "Supabase database",
  hostName: "vps-1",
  matchKey: "container:supabase-db",
  expectedState: "up",
  ...overrides
});

const seen = (
  externalId: string,
  operation: string,
  data: Record<string, JsonValue>,
  secondsAgo = 30
): ObservedRecord => ({
  instanceId,
  operation,
  externalId,
  data,
  firstSeenAt: new Date(now.getTime() - 86_400_000),
  lastSeenAt: new Date(now.getTime() - secondsAgo * 1000)
});

/** A Prometheus instance that has run all three of its operations recently. */
const observing: OperationFreshness[] = [
  { instanceId, operation: "pull_host_metrics", lastSuccessAt: new Date(now.getTime() - 60_000) },
  { instanceId, operation: "pull_container_state", lastSuccessAt: new Date(now.getTime() - 60_000) },
  { instanceId, operation: "pull_probe_state", lastSuccessAt: new Date(now.getTime() - 60_000) }
];

const watch = (input: {
  rules?: readonly AlertRule[];
  records?: readonly ObservedRecord[];
  services?: readonly DeclaredService[];
  live?: readonly LiveAlert[];
  freshness?: readonly OperationFreshness[];
}) =>
  evaluateAlertRules({
    rules: input.rules ?? [rule({ kind: "service_down" })],
    records: input.records ?? [],
    services: input.services ?? [service()],
    liveAlerts: input.live ?? [],
    freshness: input.freshness ?? observing,
    now
  });

describe("a service somebody declared", () => {
  it("fires when its reading has stopped being refreshed, and names it by its match key", () => {
    const verdicts = watch({ records: [seen("container:supabase-db", "pull_container_state", {}, 1_200)] });

    expect(verdicts).toEqual([
      {
        ruleId: "rule-1",
        status: "firing",
        dedupKey: "container:supabase-db",
        severity: "high",
        summary: {
          service: "Supabase database",
          host: "vps-1",
          expected: "up",
          lastSeenAt: "2026-08-13T11:40:00.000Z"
        }
      }
    ]);
  });

  it("says nothing about one that is still being refreshed", () => {
    expect(watch({ records: [seen("container:supabase-db", "pull_container_state", {})] })).toEqual([]);
  });

  /** Decision 1: a declared service that no observation ever mentions is exactly the case to see. */
  it("fires for one that has never been observed at all", () => {
    const verdicts = watch({ records: [] });

    expect(verdicts).toHaveLength(1);
    expect(verdicts[0]).toMatchObject({ status: "firing", dedupKey: "container:supabase-db" });
    expect(verdicts[0]?.summary.lastSeenAt).toBeUndefined();
  });

  it("believes a probe that says it failed, even though the reading is current", () => {
    const probe = service({ matchKey: "probe:https://example.test", name: "Public site" });
    const records = [seen("probe:https://example.test", "pull_probe_state", { success: false, scrapeUp: true })];

    expect(watch({ services: [probe], records })).toHaveLength(1);
  });

  it("believes Prometheus when it says it could not scrape the exporter", () => {
    const probe = service({ matchKey: "probe:node-exporter:9100" });
    const records = [seen("probe:node-exporter:9100", "pull_probe_state", { scrapeUp: false })];

    expect(watch({ services: [probe], records })).toHaveLength(1);
  });

  it("believes an automation that says it is not active", () => {
    const automation = service({ matchKey: "workflow:wf-a" });
    const freshness = [
      ...observing,
      { instanceId, operation: "pull_workflows", lastSuccessAt: new Date(now.getTime() - 60_000) }
    ];
    const records = [seen("workflow:wf-a", "pull_workflows", { active: false })];

    expect(watch({ services: [automation], records, freshness })).toHaveLength(1);
    const running = [seen("workflow:wf-a", "pull_workflows", { active: true })];
    expect(watch({ services: [automation], records: running, freshness })).toEqual([]);
  });

  it("reads a service expected to stay stopped the other way round", () => {
    const retired = service({ matchKey: "container:old-admin", expectedState: "stopped" });
    const back = [seen("container:old-admin", "pull_container_state", {})];

    expect(watch({ services: [retired], records: back })).toMatchObject([{ status: "firing" }]);
    expect(watch({ services: [retired], records: [] })).toEqual([]);
  });

  it("never evaluates one that was declared and deliberately ignored", () => {
    const ignored = service({ expectedState: "ignored" });
    expect(watch({ services: [ignored], records: [] })).toEqual([expect.objectContaining({ status: "starved" })]);
  });

  /**
   * A tenant with Prometheus and n8n has two instances and may declare services of both. Without
   * this, each rule would fire for the other instance's inventory.
   */
  it("leaves alone a service whose operation this instance does not run", () => {
    // The container is this Prometheus instance's to judge and is missing, so it fires. The
    // automation belongs to the n8n instance next to it: without the filter it would drag
    // `pull_workflows` into what this rule must have read, and starve the whole rule instead.
    const automation = service({ matchKey: "workflow:wf-a", name: "Facturacio" });
    const freshness = [
      ...observing,
      { instanceId: "instance-2", operation: "pull_workflows", lastSuccessAt: new Date(now.getTime() - 60_000) }
    ];

    const verdicts = watch({ services: [service(), automation], records: [], freshness });

    expect(verdicts).toEqual([expect.objectContaining({ status: "firing", dedupKey: "container:supabase-db" })]);
  });

  it("is starved rather than green when it has nothing evaluable to watch", () => {
    expect(watch({ services: [] })).toEqual([
      { ruleId: "rule-1", status: "starved", dedupKey: "rule:rule-1", severity: "high", summary: {} }
    ]);
  });

  it("is starved when the operation behind its inventory has gone stale", () => {
    const stale = observing.map((entry) =>
      entry.operation === "pull_container_state"
        ? { ...entry, lastSuccessAt: new Date(now.getTime() - 3_600_000) }
        : entry
    );

    expect(watch({ records: [], freshness: stale })).toMatchObject([{ status: "starved" }]);
  });

  it("resolves when the service comes back", () => {
    const live: LiveAlert[] = [{ ruleId: "rule-1", dedupKey: "container:supabase-db" }];
    const records = [seen("container:supabase-db", "pull_container_state", {})];

    expect(watch({ records, live })).toEqual([
      { ruleId: "rule-1", status: "resolved", dedupKey: "container:supabase-db", severity: "high", summary: {} }
    ]);
  });
});

describe("a certificate about to expire", () => {
  const expiring = (days: number) =>
    seen("probe:https://example.test", "pull_probe_state", {
      certificateExpiresAt: new Date(now.getTime() + days * 86_400_000).toISOString()
    });

  const certificateRule = [rule({ kind: "certificate_expiring" })];

  it("fires inside the fortnight it watches by default, and names the days left", () => {
    const verdicts = watch({ rules: certificateRule, records: [expiring(9)] });

    expect(verdicts).toEqual([
      {
        ruleId: "rule-1",
        status: "firing",
        dedupKey: "probe:https://example.test",
        severity: "high",
        summary: {
          target: "https://example.test",
          expiresAt: "2026-08-22T12:00:00.000Z",
          daysLeft: "9"
        }
      }
    ]);
  });

  it("says nothing about one with time left", () => {
    expect(watch({ rules: certificateRule, records: [expiring(40)] })).toEqual([]);
  });

  it("watches the window it was asked about", () => {
    const rules = [rule({ kind: "certificate_expiring", params: { withinDays: 45 } })];
    expect(watch({ rules, records: [expiring(40)] })).toHaveLength(1);
  });

  it("fires for one that has already expired, and says so with a negative count", () => {
    const verdicts = watch({ rules: certificateRule, records: [expiring(-3)] });
    expect(verdicts[0]?.summary.daysLeft).toBe("-3");
  });

  /**
   * The failure mode this rule exists to avoid is the quiet one: no blackbox job configured, no
   * certificate in any reading, and a screen that looks fine.
   */
  it("is starved when no reading carries a certificate at all", () => {
    const records = [seen("probe:https://example.test", "pull_probe_state", { success: true })];
    expect(watch({ rules: certificateRule, records })).toMatchObject([{ status: "starved" }]);
  });

  it("ignores a date that does not parse rather than firing on it", () => {
    const broken = [seen("probe:https://example.test", "pull_probe_state", { certificateExpiresAt: "soon" })];
    expect(watch({ rules: certificateRule, records: broken })).toMatchObject([{ status: "starved" }]);
  });
});

describe("a backup that stopped running", () => {
  const ranHoursAgo = (hours: number) =>
    seen("backup:hub-vps-daily", "pull_probe_state", {
      lastSuccessAt: new Date(now.getTime() - hours * 3_600_000).toISOString()
    });

  const backupRule = [rule({ kind: "backup_stale" })];

  it("fires past the day and two hours it allows by default", () => {
    const verdicts = watch({ rules: backupRule, records: [ranHoursAgo(30)] });

    expect(verdicts).toEqual([
      {
        ruleId: "rule-1",
        status: "firing",
        dedupKey: "backup:hub-vps-daily",
        severity: "high",
        summary: {
          backupJob: "hub-vps-daily",
          lastSuccessAt: "2026-08-12T06:00:00.000Z",
          ageHours: "30"
        }
      }
    ]);
  });

  it("says nothing about a backup that ran last night", () => {
    expect(watch({ rules: backupRule, records: [ranHoursAgo(11)] })).toEqual([]);
  });

  it("allows the age it was asked to allow", () => {
    const rules = [rule({ kind: "backup_stale", params: { maximumAgeHours: 8 } })];
    expect(watch({ rules, records: [ranHoursAgo(11)] })).toHaveLength(1);
  });

  /**
   * The whole point of the rule. A backup script that writes no `backup_job` label produces no
   * record, and a rule that answered "green" to that would be worse than having no rule.
   */
  it("is starved when nothing ever wrote a backup heartbeat", () => {
    expect(watch({ rules: backupRule, records: [] })).toEqual([
      { ruleId: "rule-1", status: "starved", dedupKey: "rule:rule-1", severity: "high", summary: {} }
    ]);
  });

  it("reads no backup from another instance", () => {
    const elsewhere = { ...ranHoursAgo(30), instanceId: "instance-2" };
    expect(watch({ rules: backupRule, records: [elsewhere] })).toMatchObject([{ status: "starved" }]);
  });
});

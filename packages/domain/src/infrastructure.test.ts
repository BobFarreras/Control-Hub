import { describe, expect, it } from "vitest";
import {
  evaluateAlertRules,
  incidentFor,
  type AlertRule,
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

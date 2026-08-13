/**
 * What the alert rules make of what the connectors read.
 *
 * Everything here is pure: rules, records and a clock go in, a list of verdicts comes out. No
 * database, no queue, no network. That is what lets the awkward cases -- a provider we lost
 * sight of, a rule somebody disabled, the same pass run twice -- be tested as data instead of by
 * arranging a stack into the right state.
 *
 * Two properties matter more than the rules themselves:
 *
 * **It is recomputed, never accumulated.** Each pass reaches its verdict from the current state
 * alone, exactly as the support escalation sweep does. Missing a pass loses nothing, because the
 * next one reaches the same conclusion; running one twice changes nothing either.
 *
 * **Freshness comes before verdict.** A rule whose data is older than its budget is `starved`,
 * not `firing` and not resolved. We do not know whether the thing broke or whether we stopped
 * being told about it, and guessing in either direction is worse than saying so: guessing
 * `firing` turns one outage at the provider into an alert per workflow, and guessing resolved
 * makes a real failure disappear the moment we lose sight of it.
 *
 * Specification: `docs/specifications/infrastructure.md`, "Avaluacio de regles i alertes".
 */

/** Severities are the incidents table's own, so a rule can hand one over without translation. */
export type AlertSeverity = "critical" | "high" | "normal" | "low";

/**
 * The kinds of rule that exist. Phase 7.1 ships one; 7.2 adds the infrastructure three.
 *
 * A union rather than a string means an unhandled kind is a compile error at the switch below,
 * not a rule that silently never fires.
 */
export type AlertRuleKind = "workflow_failed";

export type AlertRuleTargetType = "instance" | "automation";

export type AlertRule = {
  id: string;
  name: string;
  kind: AlertRuleKind;
  /** Whose data feeds it. A rule reads one instance; it never spans two. */
  instanceId: string;
  targetType: AlertRuleTargetType;
  /** The `externalId` of the one automation being watched, or null for all of them. */
  targetId: string | null;
  severity: AlertSeverity;
  params: Readonly<Record<string, JsonValue>>;
  /** How old the data may be before the rule stops claiming to know anything. */
  freshnessSeconds: number;
  opensIncident: boolean;
  enabled: boolean;
};

/**
 * A JSON value, which is what both a stored record and a rule's parameters are.
 *
 * Not `unknown`. Both of these round-trip through a `jsonb` column, so a `Date`, a `Map` or a
 * class instance is a bug that has to fail where it was built rather than at the insert, where
 * the message would name a column instead of the code that made the value.
 */
export type JsonValue = null | string | number | boolean | JsonValue[] | { [key: string]: JsonValue };

export type ObservedRecord = {
  instanceId: string;
  operation: string;
  externalId: string;
  data: Readonly<Record<string, JsonValue>>;
  firstSeenAt: Date;
  lastSeenAt: Date;
};

/** When an operation last returned successfully. Null means it never has. */
export type OperationFreshness = { instanceId: string; operation: string; lastSuccessAt: Date | null };

/** An alert that is currently firing, which is what a verdict of `resolved` is about. */
export type LiveAlert = { ruleId: string; dedupKey: string };

export type AlertVerdictStatus = "firing" | "resolved" | "starved";

export type AlertVerdict = {
  ruleId: string;
  status: AlertVerdictStatus;
  /**
   * What makes two firings the same alert. One per workflow for `workflow_failed`, so a bad
   * afternoon on one automation is one row that counts up rather than forty rows.
   */
  dedupKey: string;
  severity: AlertSeverity;
  /** Small, flat, and never a provider payload: this is drawn on a screen and put in a log. */
  summary: Readonly<Record<string, string>>;
};

export type EvaluateAlertRulesInput = {
  rules: readonly AlertRule[];
  records: readonly ObservedRecord[];
  liveAlerts: readonly LiveAlert[];
  freshness: readonly OperationFreshness[];
  now: Date;
};

/** Defaults chosen so that a rule created with no parameters at all is still meaningful. */
const defaultWithinMinutes = 60;
const defaultMinimumFailures = 1;

/** Which operation each kind of rule reads. It is also the operation whose age is its freshness. */
const operationFor: Record<AlertRuleKind, string> = { workflow_failed: "pull_executions" };

function positiveInteger(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function isFresh(rule: AlertRule, freshness: readonly OperationFreshness[], now: Date): boolean {
  const operation = operationFor[rule.kind];
  const entry = freshness.find((item) => item.instanceId === rule.instanceId && item.operation === operation);
  if (!entry?.lastSuccessAt) return false;
  return now.getTime() - entry.lastSuccessAt.getTime() <= rule.freshnessSeconds * 1000;
}

const asString = (value: JsonValue | undefined): string | null => (typeof value === "string" ? value : null);

/**
 * The failures inside the rule's window, grouped by the workflow they belong to.
 *
 * `startedAt` comes from the provider and may be missing or unparseable, in which case the record
 * is left out rather than counted as recent: an alert that fires because a date failed to parse
 * is worse than one that waits for the next pass.
 */
function failuresByWorkflow(rule: AlertRule, records: readonly ObservedRecord[], now: Date): Map<string, Date[]> {
  const withinMinutes = positiveInteger(rule.params.withinMinutes, defaultWithinMinutes);
  const since = now.getTime() - withinMinutes * 60_000;
  const grouped = new Map<string, Date[]>();

  for (const record of records) {
    if (record.instanceId !== rule.instanceId) continue;
    if (record.operation !== operationFor.workflow_failed) continue;
    if (asString(record.data.status) !== "error") continue;

    const workflowId = asString(record.data.workflowId);
    if (!workflowId) continue;

    const dedupKey = `workflow:${workflowId}`;
    if (rule.targetType === "automation" && rule.targetId !== dedupKey) continue;

    const startedAt = asString(record.data.startedAt);
    const at = startedAt ? new Date(startedAt) : null;
    if (!at || Number.isNaN(at.getTime()) || at.getTime() < since) continue;

    grouped.set(dedupKey, [...(grouped.get(dedupKey) ?? []), at]);
  }
  return grouped;
}

function workflowFailedVerdicts(rule: AlertRule, records: readonly ObservedRecord[], now: Date): AlertVerdict[] {
  const minimum = positiveInteger(rule.params.minimumFailures, defaultMinimumFailures);
  const verdicts: AlertVerdict[] = [];

  for (const [dedupKey, failures] of failuresByWorkflow(rule, records, now)) {
    if (failures.length < minimum) continue;
    const last = failures.reduce((latest, at) => (at > latest ? at : latest));
    verdicts.push({
      ruleId: rule.id,
      status: "firing",
      dedupKey,
      severity: rule.severity,
      summary: {
        workflowId: dedupKey.slice("workflow:".length),
        failures: String(failures.length),
        lastFailureAt: last.toISOString()
      }
    });
  }
  return verdicts;
}

/**
 * Every rule's verdict, and a resolution for every live alert no rule still claims.
 *
 * A rule nobody passed in gets no verdict at all -- not a resolution. Its alerts belong to a rule
 * this pass knows nothing about, and quietly closing somebody else's alerts is the kind of thing
 * that happens once and is never explained.
 */
export function evaluateAlertRules(input: EvaluateAlertRulesInput): AlertVerdict[] {
  const verdicts: AlertVerdict[] = [];

  for (const rule of input.rules) {
    const live = input.liveAlerts.filter((alert) => alert.ruleId === rule.id);
    const resolutions = (keys: ReadonlySet<string>) =>
      live
        .filter((alert) => !keys.has(alert.dedupKey))
        .map<AlertVerdict>((alert) => ({
          ruleId: rule.id,
          status: "resolved",
          dedupKey: alert.dedupKey,
          severity: rule.severity,
          summary: {}
        }));

    // A disabled rule keeps no alerts. Leaving them firing would mean the only way to clear them
    // is to re-enable the rule, and an operator who disabled it has said what they think of it.
    if (!rule.enabled) {
      verdicts.push(...resolutions(new Set()));
      continue;
    }

    if (!isFresh(rule, input.freshness, input.now)) {
      // Deliberately no resolutions: see the note at the top of the file. The rule reports that
      // it cannot see, and whatever was firing stays firing until something can.
      verdicts.push({
        ruleId: rule.id,
        status: "starved",
        dedupKey: `rule:${rule.id}`,
        severity: rule.severity,
        summary: {}
      });
      continue;
    }

    const firing = kindVerdicts(rule, input.records, input.now);
    verdicts.push(...firing, ...resolutions(new Set(firing.map((verdict) => verdict.dedupKey))));
  }

  return verdicts;
}

function kindVerdicts(rule: AlertRule, records: readonly ObservedRecord[], now: Date): AlertVerdict[] {
  switch (rule.kind) {
    case "workflow_failed":
      return workflowFailedVerdicts(rule, records, now);
  }
}

/** The incidents table's own limit. A title built from tenant data has to fit inside it. */
const maxIncidentTitle = 200;

export type IncidentToOpen = { severity: AlertSeverity; title: string };

/**
 * The incident a verdict opens, or null.
 *
 * Only a firing verdict opens one, and only when the rule was told to. Whether one already exists
 * is not decided here: that is the partial unique index's job, and asking a pure function to know
 * would mean handing it the database it was designed not to have.
 */
export function incidentFor(rule: AlertRule, verdict: AlertVerdict): IncidentToOpen | null {
  if (!rule.opensIncident || verdict.status !== "firing") return null;
  const title = `${rule.name}: ${verdict.dedupKey}`;
  return { severity: rule.severity, title: title.slice(0, maxIncidentTitle) };
}

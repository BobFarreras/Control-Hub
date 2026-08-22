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
 * The kinds of rule that exist. Phase 7.1 shipped one; 7.2 adds the infrastructure three.
 *
 * A union rather than a string means an unhandled kind is a compile error at the switch below,
 * not a rule that silently never fires. It is derived from a runtime list, and not written twice,
 * so the API schema that accepts a kind and the engine that evaluates one cannot drift: the route
 * spreads the same array the switch is checked against.
 */
export const alertRuleKinds = ["workflow_failed", "service_down", "certificate_expiring", "backup_stale"] as const;

export type AlertRuleKind = (typeof alertRuleKinds)[number];

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

/** What a service is expected to be doing, which is what makes its absence mean something. */
export type ServiceExpectedState = "up" | "stopped" | "ignored";

/**
 * One line of the declared inventory, reduced to what a verdict needs.
 *
 * It is declared and not discovered on purpose (decision 1): a service nobody claimed is noise,
 * and a claimed one that stopped appearing in the metrics is the case worth seeing. `matchKey` is
 * the whole `externalId` a reading would carry, prefix included, so matching is an equality and
 * not a convention somebody has to remember.
 */
export type DeclaredService = {
  name: string;
  hostName: string;
  matchKey: string;
  expectedState: ServiceExpectedState;
};

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
  /** The whole tenant's inventory. Which of it a rule may judge is decided below, not here. */
  services: readonly DeclaredService[];
  liveAlerts: readonly LiveAlert[];
  freshness: readonly OperationFreshness[];
  now: Date;
};

/** Defaults chosen so that a rule created with no parameters at all is still meaningful. */
const defaultWithinMinutes = 60;
const defaultMinimumFailures = 1;
const defaultWithinDays = 14;
/** A daily backup with two hours of slack, so an ordinary late run is not an alert. */
const defaultMaximumAgeHours = 26;

const executionOperation = "pull_executions";
const probeOperation = "pull_probe_state";

/**
 * Which operation observes a thing, read from the prefix of its identifier.
 *
 * The prefix is not a convention this file invented: it is the `externalId` the connectors build,
 * and `match_key` is that identifier in full. A prefix nobody publishes maps to nothing, and a
 * service carrying one is simply never in scope -- see `servicesInScope`.
 */
const operationForPrefix: Readonly<Record<string, string>> = {
  host: "pull_host_metrics",
  container: "pull_container_state",
  probe: probeOperation,
  backup: probeOperation,
  workflow: "pull_workflows"
};

/**
 * The fields whose `false` means "and it is not up", by the kind of thing they belong to.
 *
 * A reading being refreshed is the ordinary evidence that something is alive, but two sources say
 * more than that: the blackbox exporter answers whether the probe itself succeeded, and n8n says
 * whether a workflow is active. A container or a host has no such field, and its refreshment is
 * the whole story.
 */
const downFlagsForPrefix: Readonly<Record<string, readonly string[]>> = {
  probe: ["success", "scrapeUp"],
  workflow: ["active"]
};

function positiveInteger(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

/** Everything before the first colon of an identifier, or the empty string when there is none. */
function prefixOf(identifier: string): string {
  const colon = identifier.indexOf(":");
  return colon === -1 ? "" : identifier.slice(0, colon);
}

/** A date a provider wrote, or null. Never a value that silently becomes the epoch. */
function instantFrom(value: JsonValue | undefined): Date | null {
  const text = asString(value);
  if (!text) return null;
  const at = new Date(text);
  return Number.isNaN(at.getTime()) ? null : at;
}

function isFresh(rule: AlertRule, operation: string, freshness: readonly OperationFreshness[], now: Date): boolean {
  const entry = freshness.find((item) => item.instanceId === rule.instanceId && item.operation === operation);
  if (!entry?.lastSuccessAt) return false;
  return now.getTime() - entry.lastSuccessAt.getTime() <= rule.freshnessSeconds * 1000;
}

/**
 * Which of the tenant's declared services this rule may judge.
 *
 * A rule reads one instance, and a tenant running Prometheus and n8n has two. Without this filter
 * each rule would fire for the other instance's inventory, since neither would find a reading for
 * it. The instance a service belongs to needs no column: the prefix says which operation observes
 * it, and an instance that runs that operation has a row for it in the freshness table. An
 * operation that has never run has no row, and then we have not looked yet and say nothing.
 */
function servicesInScope(
  rule: AlertRule,
  services: readonly DeclaredService[],
  freshness: readonly OperationFreshness[]
): DeclaredService[] {
  const available = new Set(
    freshness.filter((entry) => entry.instanceId === rule.instanceId).map((entry) => entry.operation)
  );
  return services.filter((service) => {
    if (service.expectedState === "ignored") return false;
    const operation = operationForPrefix[prefixOf(service.matchKey)];
    return operation !== undefined && available.has(operation);
  });
}

/**
 * The operations a rule needs to have read recently before it claims to know anything.
 *
 * More than one for `service_down`, because an inventory of containers and probes is fed by two
 * different passes and a rule is only as informed as the least recent of them. An empty list is
 * a rule with nothing to read at all, which `isStarved` turns into exactly that verdict.
 */
function operationsFor(rule: AlertRule, scope: readonly DeclaredService[]): readonly string[] {
  switch (rule.kind) {
    case "workflow_failed":
      return [executionOperation];
    case "certificate_expiring":
    case "backup_stale":
      return [probeOperation];
    case "service_down":
      return [...new Set(scope.map((service) => operationForPrefix[prefixOf(service.matchKey)]!))];
  }
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
    if (record.operation !== executionOperation) continue;
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
 * Whether a declared service is currently being reported as alive.
 *
 * `connector_records` holds state and is overwritten, so a container that stopped does not lose
 * its row: what stops is its `last_seen_at` moving. Absence is therefore a reading that stopped
 * being refreshed, not a missing row, and the rule's own freshness budget is what "stopped" means.
 * The budget is used twice on purpose: if the whole operation is stale the rule is starved and
 * says nothing about anybody, and only when the pass is current does one unrefreshed reading mean
 * that one thing went away.
 */
function observation(
  rule: AlertRule,
  service: DeclaredService,
  records: readonly ObservedRecord[],
  now: Date
): { alive: boolean; lastSeenAt: Date | null } {
  const operation = operationForPrefix[prefixOf(service.matchKey)];
  const record = latestRecord(records, operation, service.matchKey, rule.instanceId);
  if (!record) return { alive: false, lastSeenAt: null };

  const alive = refreshedWithin(record, rule.freshnessSeconds, now) && !contradicted(service.matchKey, record);
  return { alive, lastSeenAt: record.lastSeenAt };
}

/**
 * The most recently seen reading carrying this identifier, or none.
 *
 * `instanceId` narrows it when the caller is a rule, which reads one instance and no other. The
 * dashboard passes null, because a tenant may run two collectors over the same machine and the
 * honest answer there is the newer of the two rather than whichever row came back first.
 */
function latestRecord(
  records: readonly ObservedRecord[],
  operation: string | undefined,
  externalId: string,
  instanceId: string | null
): ObservedRecord | undefined {
  if (operation === undefined) return undefined;

  let latest: ObservedRecord | undefined;
  for (const record of records) {
    if (record.operation !== operation || record.externalId !== externalId) continue;
    if (instanceId !== null && record.instanceId !== instanceId) continue;
    if (!latest || record.lastSeenAt > latest.lastSeenAt) latest = record;
  }
  return latest;
}

function refreshedWithin(record: ObservedRecord, budgetSeconds: number, now: Date): boolean {
  return now.getTime() - record.lastSeenAt.getTime() <= budgetSeconds * 1000;
}

/** Whether the reading itself carries a field saying the thing did not answer. */
function contradicted(matchKey: string, record: ObservedRecord): boolean {
  return (downFlagsForPrefix[prefixOf(matchKey)] ?? []).some((field) => record.data[field] === false);
}

function serviceDownVerdicts(
  rule: AlertRule,
  scope: readonly DeclaredService[],
  records: readonly ObservedRecord[],
  now: Date
): AlertVerdict[] {
  const verdicts: AlertVerdict[] = [];

  for (const service of scope) {
    const { alive, lastSeenAt } = observation(rule, service, records, now);
    // `stopped` is read the other way round: what we want to be told about is its return.
    if (alive !== (service.expectedState === "stopped")) continue;

    verdicts.push({
      ruleId: rule.id,
      status: "firing",
      dedupKey: service.matchKey,
      severity: rule.severity,
      summary: {
        service: service.name,
        host: service.hostName,
        expected: service.expectedState,
        ...(lastSeenAt ? { lastSeenAt: lastSeenAt.toISOString() } : {})
      }
    });
  }
  return verdicts;
}

/** Every probe reading of this instance that carries an expiry we could read. */
function certificateReadings(
  rule: AlertRule,
  records: readonly ObservedRecord[]
): { externalId: string; expiresAt: Date }[] {
  const readings: { externalId: string; expiresAt: Date }[] = [];
  for (const record of records) {
    if (record.instanceId !== rule.instanceId || record.operation !== probeOperation) continue;
    if (prefixOf(record.externalId) !== "probe") continue;
    const expiresAt = instantFrom(record.data.certificateExpiresAt);
    if (expiresAt) readings.push({ externalId: record.externalId, expiresAt });
  }
  return readings;
}

/**
 * The certificates close enough to expiry to be worth saying, and the ones already past it.
 *
 * The reading's own age is deliberately not consulted here. An expiry date is absolute: a
 * certificate does not become valid again because we read it an hour ago rather than a minute ago,
 * and the operation's freshness has already been checked for the rule as a whole.
 */
function certificateExpiringVerdicts(rule: AlertRule, records: readonly ObservedRecord[], now: Date): AlertVerdict[] {
  const withinDays = positiveInteger(rule.params.withinDays, defaultWithinDays);
  const verdicts: AlertVerdict[] = [];

  for (const reading of certificateReadings(rule, records)) {
    const remaining = reading.expiresAt.getTime() - now.getTime();
    if (remaining > withinDays * 86_400_000) continue;

    verdicts.push({
      ruleId: rule.id,
      status: "firing",
      dedupKey: reading.externalId,
      severity: rule.severity,
      summary: {
        target: reading.externalId.slice("probe:".length),
        expiresAt: reading.expiresAt.toISOString(),
        daysLeft: String(Math.floor(remaining / 86_400_000))
      }
    });
  }
  return verdicts;
}

/** Every backup heartbeat of this instance whose timestamp we could read. */
function backupReadings(
  rule: AlertRule,
  records: readonly ObservedRecord[]
): { externalId: string; lastSuccessAt: Date }[] {
  const readings: { externalId: string; lastSuccessAt: Date }[] = [];
  for (const record of records) {
    if (record.instanceId !== rule.instanceId || record.operation !== probeOperation) continue;
    if (prefixOf(record.externalId) !== "backup") continue;
    const lastSuccessAt = instantFrom(record.data.lastSuccessAt);
    if (lastSuccessAt) readings.push({ externalId: record.externalId, lastSuccessAt });
  }
  return readings;
}

function backupStaleVerdicts(rule: AlertRule, records: readonly ObservedRecord[], now: Date): AlertVerdict[] {
  const maximumAgeHours = positiveInteger(rule.params.maximumAgeHours, defaultMaximumAgeHours);
  const verdicts: AlertVerdict[] = [];

  for (const reading of backupReadings(rule, records)) {
    const age = now.getTime() - reading.lastSuccessAt.getTime();
    if (age <= maximumAgeHours * 3_600_000) continue;

    verdicts.push({
      ruleId: rule.id,
      status: "firing",
      dedupKey: reading.externalId,
      severity: rule.severity,
      summary: {
        backupJob: reading.externalId.slice("backup:".length),
        lastSuccessAt: reading.lastSuccessAt.toISOString(),
        ageHours: String(Math.floor(age / 3_600_000))
      }
    });
  }
  return verdicts;
}

/**
 * Whether the rule has anything at all to reason from, which is not the same as an empty verdict.
 *
 * Absence means opposite things depending on who declared what. For `service_down` the inventory
 * says the thing should exist, so a reading that is missing **is** the alert. For the other two
 * nothing declares what ought to be there: a rule with no certificate in any reading, or no backup
 * heartbeat at all, does not know that everything is fine -- it knows nothing, and decision 7 says
 * that must look like starvation rather than coverage. It is also the failure mode that a backup
 * script writing no `backup_job` label produces, and the one nobody would ever notice.
 */
function hasData(rule: AlertRule, records: readonly ObservedRecord[]): boolean {
  switch (rule.kind) {
    // Phase 7.1's rule, unchanged: no failed execution is genuinely good news. And for
    // `service_down` an empty scope already leaves `operationsFor` empty, which starves the rule
    // before this is ever asked.
    case "workflow_failed":
    case "service_down":
      return true;
    case "certificate_expiring":
      return certificateReadings(rule, records).length > 0;
    case "backup_stale":
      return backupReadings(rule, records).length > 0;
  }
}

function isStarved(
  rule: AlertRule,
  scope: readonly DeclaredService[],
  records: readonly ObservedRecord[],
  freshness: readonly OperationFreshness[],
  now: Date
): boolean {
  const operations = operationsFor(rule, scope);
  if (operations.length === 0) return true;
  if (!operations.every((operation) => isFresh(rule, operation, freshness, now))) return true;
  return !hasData(rule, records);
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

    const scope = rule.kind === "service_down" ? servicesInScope(rule, input.services, input.freshness) : [];

    if (isStarved(rule, scope, input.records, input.freshness, input.now)) {
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

    const firing = kindVerdicts(rule, scope, input.records, input.now);
    verdicts.push(...firing, ...resolutions(new Set(firing.map((verdict) => verdict.dedupKey))));
  }

  return verdicts;
}

function kindVerdicts(
  rule: AlertRule,
  scope: readonly DeclaredService[],
  records: readonly ObservedRecord[],
  now: Date
): AlertVerdict[] {
  switch (rule.kind) {
    case "workflow_failed":
      return workflowFailedVerdicts(rule, records, now);
    case "service_down":
      return serviceDownVerdicts(rule, scope, records, now);
    case "certificate_expiring":
      return certificateExpiringVerdicts(rule, records, now);
    case "backup_stale":
      return backupStaleVerdicts(rule, records, now);
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

/** What a declared thing looks like from the outside right now. */
export type ObservedState = "up" | "down" | "unknown";

export type CurrentReading = {
  state: ObservedState;
  /** When the reading behind this state was last refreshed, or null when there is none. */
  observedAt: Date | null;
  /**
   * The connector instance whose record this state was read from, or null when there is no record
   * behind it.
   *
   * A property of the reading and never of the thing read: the same machine may be scraped by a
   * different collector tomorrow, and two of them may scrape it today. It is what lets a fleet be
   * filtered by which collector sees it, and a machine's own page say where its figures came from
   * -- neither of which is answerable from the declaration alone.
   */
  instanceId: string | null;
  /** The projection the connector wrote, handed over whole for the screen to name fields of. */
  data: Readonly<Record<string, JsonValue>>;
};

/** The identifier a host's reading carries, so the prefix convention lives in exactly one file. */
export function hostMatchKey(hostname: string): string {
  return `host:${hostname}`;
}

/**
 * What one declared thing looks like right now, for a screen rather than for an alert.
 *
 * The same core `service_down` reasons with, asked a different question. Two differences follow
 * from that, and both are deliberate.
 *
 * **There is a third answer.** A rule that cannot see says `starved` about itself; a dashboard has
 * to say `unknown` about the thing. Drawing a collector we have lost sight of as twenty machines
 * going down at once would be a lie told at the exact moment somebody needs the screen to be
 * honest, and `down` is reserved for a pass that did run and did not find this.
 *
 * **It reads no intent.** A service declared `stopped` reads as down here, and it is the screen
 * that puts "expected" beside it. Teaching this function about expectations would give the
 * dashboard and the rules two notions of down, which is the drift the whole file exists to avoid.
 *
 * The budget is per operation rather than per rule, because there is no rule involved: it comes
 * from the cadence the connector declares, so a screen never invents a threshold of its own.
 */
export function currentReading(input: {
  matchKey: string;
  records: readonly ObservedRecord[];
  freshness: readonly OperationFreshness[];
  /** How old a reading of each operation may be, in seconds. An operation absent here is unknown. */
  budgets: Readonly<Record<string, number>>;
  now: Date;
}): CurrentReading {
  const blind: CurrentReading = { state: "unknown", observedAt: null, instanceId: null, data: {} };

  const operation = operationForPrefix[prefixOf(input.matchKey)];
  if (operation === undefined) return blind;

  const budget = input.budgets[operation];
  if (budget === undefined) return blind;

  // The freshest pass of any instance running the operation. An operation that has never returned
  // has no last success, and then nobody has looked yet -- which is not the same as looked and
  // found nothing.
  let lastPass: Date | null = null;
  for (const entry of input.freshness) {
    if (entry.operation !== operation || !entry.lastSuccessAt) continue;
    if (!lastPass || entry.lastSuccessAt > lastPass) lastPass = entry.lastSuccessAt;
  }
  if (!lastPass || input.now.getTime() - lastPass.getTime() > budget * 1000) return blind;

  const record = latestRecord(input.records, operation, input.matchKey, null);
  if (!record) return { state: "down", observedAt: null, instanceId: null, data: {} };

  const alive = refreshedWithin(record, budget, input.now) && !contradicted(input.matchKey, record);
  return {
    state: alive ? "up" : "down",
    observedAt: record.lastSeenAt,
    instanceId: record.instanceId,
    data: record.data
  };
}

/** How many declared things are in each of the three states, and how many there are at all. */
export type ObservedTally = { total: number; up: number; down: number; unknown: number };

/**
 * The fleet counted by what it is doing right now.
 *
 * Here rather than on the screen for the same reason `currentReading` is here: the summary at the
 * top of a dashboard and the rows below it have to be the same claim counted twice, and a screen
 * that tallied for itself would be a second opinion about how many machines are down. Every state
 * lands in exactly one column, so the total is always the sum of the three -- a summary whose
 * parts do not add up is worse than no summary.
 */
export function observedTally(states: readonly ObservedState[]): ObservedTally {
  const tally: ObservedTally = { total: states.length, up: 0, down: 0, unknown: 0 };
  for (const state of states) tally[state] += 1;
  return tally;
}

/**
 * Every code an infrastructure response may carry, and the whole of it.
 *
 * The same closed list `connectorErrorCodes` is for the connector platform, and for the same
 * reason: a code with no sentence is not a loud failure but a silent one. The screen falls back
 * to "the operation could not be completed", which is exactly what a person was told when the
 * real answer was that a migration had not been applied -- a minute's work, had anybody said so.
 *
 * Four sources contribute, and none of them can see the other three, which is why the agreement
 * lives here: the session guard before a handler runs, the schema that refuses a malformed body,
 * the service's own rules, and the constraints the adapter turns back into codes. `INTERNAL_ERROR`
 * is a member because an unclassified failure still reaches a screen and still has to say
 * something in the reader's language.
 *
 * `packages/i18n` walks this list in a test and refuses a code with no words, in any of the three
 * languages; `apps/api` walks it and refuses one with no title. A code raised anywhere in the
 * module and not written here is therefore a code somebody has to add on purpose.
 *
 * Specification: `docs/specifications/connector-onboarding.md`, acceptance criterion 11.
 */
export const infrastructureErrorCodes = [
  // The session guard, before any handler runs.
  "AUTHENTICATION_REQUIRED",
  "TENANT_ACCESS_DENIED",
  "TENANT_SELECTION_REQUIRED",
  "MFA_REQUIRED",
  "PERMISSION_DENIED",
  // A body or a parameter the schema refused, and the failure nobody classified.
  "INVALID_INPUT",
  "INTERNAL_ERROR",
  // The module's own rules.
  "FORBIDDEN",
  "INVALID_NAME",
  "INVALID_HOSTNAME",
  "INVALID_MATCH_KEY",
  "INVALID_FRESHNESS",
  "NOTES_TOO_LONG",
  "TARGET_REQUIRED",
  "TARGET_NOT_ALLOWED",
  // Something named that is not there, or is not this tenant's.
  "INSTANCE_NOT_FOUND",
  "HOST_NOT_FOUND",
  "SERVICE_NOT_FOUND",
  "RULE_NOT_FOUND",
  "ALERT_NOT_FOUND",
  "REFERENCE_NOT_FOUND",
  // What the constraints refuse, which is two people acting at once as often as it is a mistake.
  "DUPLICATE_ENTRY",
  "DUPLICATE_HOST_NAME",
  "DUPLICATE_HOSTNAME",
  "DUPLICATE_SERVICE_NAME",
  "DUPLICATE_MATCH_KEY",
  "DUPLICATE_RULE_NAME",
  "ALERT_ALREADY_HAS_INCIDENT"
] as const;

export type InfrastructureErrorCode = (typeof infrastructureErrorCodes)[number];

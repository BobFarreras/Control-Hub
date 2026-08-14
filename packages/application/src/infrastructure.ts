import {
  evaluateAlertRules,
  hasPermission,
  incidentFor,
  type AlertRule,
  type AlertSeverity,
  type AlertVerdict,
  type AlertRuleKind,
  type AlertRuleTargetType,
  type JsonValue,
  type LiveAlert,
  type ObservedRecord,
  type OperationFreshness,
  type TenantContext
} from "@control-hub/domain";

/**
 * What somebody with a session may do to the infrastructure module, and how an alert gets stored.
 *
 * The judging itself is not here: it is `evaluateAlertRules` in the domain, which is pure. What
 * is here is the coordination -- read the current state, ask the domain, write down the answer --
 * and the permission rules, so that "Administrator reads but does not change" is closed by tests
 * that never open a socket.
 *
 * The sweep and the webhook call the same method deliberately. Two entry points computing the
 * same alert by different code is how you end up with an alert one of them can create and the
 * other cannot recognise.
 *
 * Specification: `docs/specifications/infrastructure.md`.
 */

export class InfrastructureServiceError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}

/** An automation as a screen sees it: the provider's record, plus what we decided about it. */
export type AutomationRecord = {
  instanceId: string;
  externalId: string;
  name: string;
  active: boolean;
  archived: boolean;
  tags: readonly string[];
  /** When the pull that produced this last succeeded. Every observed figure travels with its age. */
  observedAt: Date;
  customerId: string | null;
  notes: string | null;
};

export type AlertRuleRecord = AlertRule & { createdAt: Date; updatedAt: Date };

export type AlertEventRecord = {
  id: string;
  ruleId: string;
  ruleName: string;
  dedupKey: string;
  status: "firing" | "resolved";
  severity: AlertSeverity;
  summary: Readonly<Record<string, string>>;
  startedAt: Date;
  lastSeenAt: Date;
  occurrences: number;
  resolvedAt: Date | null;
  acknowledgedAt: Date | null;
  acknowledgedByMembershipId: string | null;
  incidentId: string | null;
};

export type LinkAutomationInput = {
  instanceId: string;
  externalId: string;
  customerId: string | null;
  notes: string | null;
};

export type CreateAlertRuleInput = {
  name: string;
  kind: AlertRuleKind;
  instanceId: string;
  targetType: AlertRuleTargetType;
  targetId: string | null;
  severity: AlertSeverity;
  params: Readonly<Record<string, JsonValue>>;
  freshnessSeconds: number;
  opensIncident: boolean;
};

export type UpdateAlertRuleInput = Partial<Omit<CreateAlertRuleInput, "kind" | "instanceId">> & { enabled?: boolean };

/** Everything one pass of the engine needs, read in one place so a pass is one consistent view. */
export type EvaluationState = {
  rules: readonly AlertRuleRecord[];
  records: readonly ObservedRecord[];
  liveAlerts: readonly LiveAlert[];
  freshness: readonly OperationFreshness[];
};

/**
 * What writing a verdict produced.
 *
 * `created` is the whole reason this is not a plain count: an incident is opened when an alert
 * starts, and only the write itself can tell a first firing from the four hundredth. Deciding it
 * with a read beforehand is exactly the race the partial unique index exists to remove.
 */
export type AppliedVerdict = { ruleId: string; dedupKey: string; alertId: string; created: boolean };

export type InfrastructureRepository = {
  listAutomations(context: TenantContext): Promise<readonly AutomationRecord[]>;
  linkAutomation(context: TenantContext, input: LinkAutomationInput): Promise<void>;

  listRules(context: TenantContext): Promise<readonly AlertRuleRecord[]>;
  createRule(context: TenantContext, input: CreateAlertRuleInput): Promise<AlertRuleRecord>;
  updateRule(context: TenantContext, ruleId: string, patch: UpdateAlertRuleInput): Promise<AlertRuleRecord>;
  deleteRule(context: TenantContext, ruleId: string): Promise<void>;

  listAlerts(context: TenantContext, input: { status?: "firing" | "resolved" }): Promise<readonly AlertEventRecord[]>;
  acknowledgeAlert(context: TenantContext, alertId: string, membershipId: string): Promise<AlertEventRecord>;
  resolveAlert(context: TenantContext, alertId: string, at: Date): Promise<AlertEventRecord>;

  readEvaluationState(context: TenantContext): Promise<EvaluationState>;
  applyVerdicts(
    context: TenantContext,
    verdicts: readonly AlertVerdict[],
    at: Date
  ): Promise<readonly AppliedVerdict[]>;
  /**
   * Retention, and the only call on this port without a tenant.
   *
   * Ageing out one tenant at a time would turn one bounded statement into hundreds, and retention
   * is not a tenant's decision anyway. The predicate is fixed in the schema, so the application
   * role still holds no delete privilege on the table.
   */
  purgeAlertEvents(input: { resolvedBefore: Date; batchLimit: number }): Promise<number>;
  /** Opens the incident and ties it to the alert in one go, so neither can exist without the other. */
  openIncidentForAlert(
    context: TenantContext,
    input: { alertId: string; severity: AlertSeverity; title: string }
  ): Promise<string>;
};

const shortestName = 3;
const longestName = 120;
const shortestFreshness = 60;
const longestFreshness = 86_400;

function requireRead(context: TenantContext) {
  if (!hasPermission(context, "infrastructure:read")) throw new InfrastructureServiceError("FORBIDDEN");
}

/**
 * Everything that changes something.
 *
 * `Administrator` holds `infrastructure:read` and not this, exactly as it holds the read of
 * integrations and not their management. Acceptance criterion 9.
 */
function requireOperate(context: TenantContext) {
  if (!hasPermission(context, "infrastructure:operate")) throw new InfrastructureServiceError("FORBIDDEN");
}

function checkName(name: string) {
  const trimmed = name.trim();
  if (trimmed.length < shortestName || trimmed.length > longestName) {
    throw new InfrastructureServiceError("INVALID_NAME");
  }
  return trimmed;
}

/**
 * A rule that cannot be evaluated is refused rather than stored.
 *
 * A rule sitting in the table that no pass can act on looks like coverage on the screen and is
 * the reason nobody was told when the thing it watched broke.
 */
function checkRule(input: CreateAlertRuleInput | UpdateAlertRuleInput) {
  if (input.freshnessSeconds !== undefined) {
    const seconds = input.freshnessSeconds;
    if (!Number.isSafeInteger(seconds) || seconds < shortestFreshness || seconds > longestFreshness) {
      throw new InfrastructureServiceError("INVALID_FRESHNESS");
    }
  }
  if (input.targetType === "automation" && !input.targetId) throw new InfrastructureServiceError("TARGET_REQUIRED");
  if (input.targetType === "instance" && input.targetId) throw new InfrastructureServiceError("TARGET_NOT_ALLOWED");
}

export class InfrastructureService {
  constructor(private readonly repository: InfrastructureRepository) {}

  async listAutomations(context: TenantContext): Promise<readonly AutomationRecord[]> {
    requireRead(context);
    return await this.repository.listAutomations(context);
  }

  /**
   * Associates an automation with a client, or takes the association away.
   *
   * A null customer is the removal: the row stays, because the notes on it are somebody's work.
   */
  async linkAutomation(context: TenantContext, input: LinkAutomationInput): Promise<void> {
    requireOperate(context);
    if (input.notes !== null && input.notes.length > 2000) throw new InfrastructureServiceError("NOTES_TOO_LONG");
    await this.repository.linkAutomation(context, { ...input, notes: input.notes?.trim() || null });
  }

  async listRules(context: TenantContext): Promise<readonly AlertRuleRecord[]> {
    requireRead(context);
    return await this.repository.listRules(context);
  }

  async createRule(context: TenantContext, input: CreateAlertRuleInput): Promise<AlertRuleRecord> {
    requireOperate(context);
    checkRule(input);
    return await this.repository.createRule(context, { ...input, name: checkName(input.name) });
  }

  async updateRule(context: TenantContext, ruleId: string, patch: UpdateAlertRuleInput): Promise<AlertRuleRecord> {
    requireOperate(context);
    checkRule(patch);
    return await this.repository.updateRule(context, ruleId, {
      ...patch,
      ...(patch.name === undefined ? {} : { name: checkName(patch.name) })
    });
  }

  async deleteRule(context: TenantContext, ruleId: string): Promise<void> {
    requireOperate(context);
    await this.repository.deleteRule(context, ruleId);
  }

  async listAlerts(
    context: TenantContext,
    input: { status?: "firing" | "resolved" } = {}
  ): Promise<readonly AlertEventRecord[]> {
    requireRead(context);
    return await this.repository.listAlerts(context, input);
  }

  /**
   * Acknowledging says a person has seen it. It does not resolve anything.
   *
   * The two are separate because the sweep owns resolution -- it resolves what is no longer true
   * -- and a person acknowledging an alert has not made the thing stop failing.
   */
  async acknowledgeAlert(context: TenantContext, alertId: string): Promise<AlertEventRecord> {
    requireOperate(context);
    return await this.repository.acknowledgeAlert(context, alertId, context.membershipId);
  }

  async resolveAlert(context: TenantContext, alertId: string, at: Date): Promise<AlertEventRecord> {
    requireOperate(context);
    return await this.repository.resolveAlert(context, alertId, at);
  }
}

export type AlertSweepResult = { firing: number; resolved: number; starved: number; incidentsOpened: number };

/**
 * One pass of the alert engine.
 *
 * Not part of `InfrastructureService` because it has no session behind it: it runs on a worker
 * under an automated context, and it must not be reachable from a request. Keeping it a separate
 * class means the permission checks above cannot be accidentally satisfied by a background job.
 */
export class AlertEngine {
  constructor(private readonly repository: InfrastructureRepository) {}

  async sweep(context: TenantContext, now: Date): Promise<AlertSweepResult> {
    const state = await this.repository.readEvaluationState(context);
    const verdicts = evaluateAlertRules({
      rules: state.rules,
      records: state.records,
      liveAlerts: state.liveAlerts,
      freshness: state.freshness,
      now
    });

    const applied = await this.repository.applyVerdicts(context, verdicts, now);
    const rulesById = new Map(state.rules.map((rule) => [rule.id, rule]));
    let incidentsOpened = 0;

    for (const outcome of applied) {
      // Only a first firing. A rule that has been firing all afternoon has an incident already,
      // and the index that made `created` false is the same one that keeps it to one.
      if (!outcome.created) continue;
      const rule = rulesById.get(outcome.ruleId);
      const verdict = verdicts.find((item) => item.ruleId === outcome.ruleId && item.dedupKey === outcome.dedupKey);
      if (!rule || !verdict) continue;

      const incident = incidentFor(rule, verdict);
      if (!incident) continue;
      await this.repository.openIncidentForAlert(context, { alertId: outcome.alertId, ...incident });
      incidentsOpened += 1;
    }

    return {
      firing: verdicts.filter((verdict) => verdict.status === "firing").length,
      resolved: verdicts.filter((verdict) => verdict.status === "resolved").length,
      starved: verdicts.filter((verdict) => verdict.status === "starved").length,
      incidentsOpened
    };
  }
}

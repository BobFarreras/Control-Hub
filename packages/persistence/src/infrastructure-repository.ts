import { randomUUID } from "node:crypto";
import {
  InfrastructureServiceError,
  type AlertEventRecord,
  type AlertRuleRecord,
  type AppliedVerdict,
  type AutomationRecord,
  type CreateAlertRuleInput,
  type DeclareHostInput,
  type DeclareServiceInput,
  type EvaluationState,
  type HostRecord,
  type InfrastructureRepository,
  type LinkAutomationInput,
  type ServiceRecord,
  type UpdateAlertRuleInput,
  type UpdateHostInput,
  type UpdateServiceInput
} from "@control-hub/application";
import { withTenant, type DatabaseClient } from "@control-hub/database";
import type { AlertSeverity, AlertVerdict, LiveAlert, ObservedRecord, TenantContext } from "@control-hub/domain";

/**
 * The infrastructure module's reads and writes, all of them inside a tenant scope.
 *
 * Two things here are load-bearing rather than incidental.
 *
 * **The listing joins records to links, not the other way round.** What exists is what the
 * provider says exists; a link is an annotation on it. A link whose workflow is gone shows
 * nothing, and the row stays where it is until the workflow comes back.
 *
 * **`applyVerdicts` reports what the write did**, using `xmax = 0` to tell an insert from an
 * update. An incident is opened when an alert starts, and only the statement itself can know
 * whether it started: reading first would give two concurrent sweeps the same answer, which is
 * exactly the race the partial unique index removes.
 *
 * Specification: `docs/specifications/infrastructure.md`.
 */

type DatabaseError = { code?: string; constraint_name?: string };

const ruleColumns = `id, name, kind, instance_id as "instanceId", target_type as "targetType",
  target_id as "targetId", severity, params, freshness_seconds as "freshnessSeconds",
  opens_incident as "opensIncident", enabled, created_at as "createdAt", updated_at as "updatedAt"`;

const alertColumns = `e.id, e.rule_id as "ruleId", r.name as "ruleName", e.dedup_key as "dedupKey", e.status,
  e.severity, e.summary, e.started_at as "startedAt", e.last_seen_at as "lastSeenAt", e.occurrences,
  e.resolved_at as "resolvedAt", e.acknowledged_at as "acknowledgedAt",
  e.acknowledged_by_membership_id as "acknowledgedByMembershipId", e.incident_id as "incidentId"`;

const hostColumns = `id, name, hostname, environment, notes, created_at as "createdAt",
  updated_at as "updatedAt"`;

const serviceColumns = `id, host_id as "hostId", name, kind, match_key as "matchKey",
  expected_state as "expectedState", customer_id as "customerId", created_at as "createdAt",
  updated_at as "updatedAt"`;

/** The operation whose records describe an automation, and the one whose age is a rule's freshness. */
const workflowOperation = "pull_workflows";
const executionOperation = "pull_executions";

export class PostgresInfrastructureRepository implements InfrastructureRepository {
  constructor(private readonly database: DatabaseClient) {}

  async listAutomations(context: TenantContext): Promise<readonly AutomationRecord[]> {
    return withTenant(this.database, context.tenantId, async (tx) => {
      return tx<AutomationRecord[]>`
        select
          r.instance_id as "instanceId",
          r.external_id as "externalId",
          coalesce(r.data ->> 'name', '') as name,
          coalesce((r.data -> 'active')::boolean, false) as active,
          coalesce((r.data -> 'archived')::boolean, false) as archived,
          coalesce(
            array(select jsonb_array_elements_text(r.data -> 'tags')),
            array[]::text[]
          ) as tags,
          r.last_seen_at as "observedAt",
          l.customer_id as "customerId",
          l.notes
        from connector_records r
        left join infra_automation_links l
          on l.tenant_id = r.tenant_id and l.instance_id = r.instance_id and l.external_id = r.external_id
        where r.tenant_id = ${context.tenantId} and r.operation = ${workflowOperation}
        order by name asc, r.external_id asc`;
    });
  }

  /**
   * Upsert, because the association and the note are one row per automation.
   *
   * Nulling the customer is how an association is withdrawn. The row survives it: somebody wrote
   * those notes, and deleting them as a side effect of unlinking would be a surprise.
   */
  async linkAutomation(context: TenantContext, input: LinkAutomationInput): Promise<void> {
    await withTenant(this.database, context.tenantId, async (tx) => {
      await tx`
        insert into infra_automation_links (id, tenant_id, instance_id, external_id, customer_id, notes)
        values (${randomUUID()}, ${context.tenantId}, ${input.instanceId}, ${input.externalId},
          ${input.customerId}, ${input.notes})
        on conflict (tenant_id, instance_id, external_id) do update
          set customer_id = excluded.customer_id, notes = excluded.notes, updated_at = now()`;
    }).catch(mapConstraint);
  }

  async listHosts(context: TenantContext): Promise<readonly HostRecord[]> {
    return withTenant(this.database, context.tenantId, async (tx) => {
      return tx<HostRecord[]>`
        select ${tx.unsafe(hostColumns)} from infra_hosts
        where tenant_id = ${context.tenantId} order by name`;
    });
  }

  async findHost(context: TenantContext, hostId: string): Promise<HostRecord | null> {
    return withTenant(this.database, context.tenantId, async (tx) => {
      const [host] = await tx<HostRecord[]>`
        select ${tx.unsafe(hostColumns)} from infra_hosts
        where tenant_id = ${context.tenantId} and id = ${hostId}`;
      return host ?? null;
    });
  }

  async declareHost(context: TenantContext, input: DeclareHostInput): Promise<HostRecord> {
    return withTenant(this.database, context.tenantId, async (tx) => {
      const [host] = await tx<HostRecord[]>`
        insert into infra_hosts (id, tenant_id, name, hostname, environment, notes)
        values (${randomUUID()}, ${context.tenantId}, ${input.name}, ${input.hostname},
          ${input.environment}, ${input.notes})
        returning ${tx.unsafe(hostColumns)}`;
      return host!;
    }).catch(mapInventoryConstraint);
  }

  /**
   * The same `coalesce` shape as a rule patch, with one exception that matters.
   *
   * `notes` and `customerId` may be set to null on purpose -- clearing a note, unlinking a client
   * -- so for those the absence of the field, not its nullness, is what leaves the column alone.
   * Coalescing them would make the two indistinguishable and the clearing impossible.
   */
  async updateHost(context: TenantContext, hostId: string, patch: UpdateHostInput): Promise<HostRecord> {
    const host = await withTenant(this.database, context.tenantId, async (tx) => {
      const [updated] = await tx<HostRecord[]>`
        update infra_hosts set
          name = coalesce(${patch.name ?? null}, name),
          hostname = coalesce(${patch.hostname ?? null}, hostname),
          environment = coalesce(${patch.environment ?? null}, environment),
          notes = case when ${patch.notes === undefined}::boolean then notes else ${patch.notes ?? null} end,
          updated_at = now()
        where tenant_id = ${context.tenantId} and id = ${hostId}
        returning ${tx.unsafe(hostColumns)}`;
      return updated ?? null;
    }).catch(mapInventoryConstraint);

    if (!host) throw new InfrastructureServiceError("HOST_NOT_FOUND");
    return host;
  }

  async listServices(context: TenantContext, input: { hostId?: string }): Promise<readonly ServiceRecord[]> {
    const hostId = input.hostId ?? null;
    return withTenant(this.database, context.tenantId, async (tx) => {
      return tx<ServiceRecord[]>`
        select ${tx.unsafe(serviceColumns)} from infra_services
        where tenant_id = ${context.tenantId} and (${hostId}::uuid is null or host_id = ${hostId})
        order by name`;
    });
  }

  async declareService(context: TenantContext, input: DeclareServiceInput): Promise<ServiceRecord> {
    return withTenant(this.database, context.tenantId, async (tx) => {
      const [service] = await tx<ServiceRecord[]>`
        insert into infra_services (id, tenant_id, host_id, name, kind, match_key, expected_state, customer_id)
        values (${randomUUID()}, ${context.tenantId}, ${input.hostId}, ${input.name}, ${input.kind},
          ${input.matchKey}, ${input.expectedState}, ${input.customerId})
        returning ${tx.unsafe(serviceColumns)}`;
      return service!;
    }).catch(mapInventoryConstraint);
  }

  async updateService(context: TenantContext, serviceId: string, patch: UpdateServiceInput): Promise<ServiceRecord> {
    const service = await withTenant(this.database, context.tenantId, async (tx) => {
      const [updated] = await tx<ServiceRecord[]>`
        update infra_services set
          name = coalesce(${patch.name ?? null}, name),
          kind = coalesce(${patch.kind ?? null}, kind),
          match_key = coalesce(${patch.matchKey ?? null}, match_key),
          expected_state = coalesce(${patch.expectedState ?? null}, expected_state),
          customer_id = case when ${patch.customerId === undefined}::boolean then customer_id
            else ${patch.customerId ?? null} end,
          updated_at = now()
        where tenant_id = ${context.tenantId} and id = ${serviceId}
        returning ${tx.unsafe(serviceColumns)}`;
      return updated ?? null;
    }).catch(mapInventoryConstraint);

    if (!service) throw new InfrastructureServiceError("SERVICE_NOT_FOUND");
    return service;
  }

  async deleteService(context: TenantContext, serviceId: string): Promise<void> {
    const deleted = await withTenant(this.database, context.tenantId, async (tx) => {
      const rows = await tx`delete from infra_services
        where tenant_id = ${context.tenantId} and id = ${serviceId} returning id`;
      return rows.length;
    });
    if (deleted === 0) throw new InfrastructureServiceError("SERVICE_NOT_FOUND");
  }

  async listRules(context: TenantContext): Promise<readonly AlertRuleRecord[]> {
    return withTenant(this.database, context.tenantId, async (tx) => {
      return tx<AlertRuleRecord[]>`
        select ${tx.unsafe(ruleColumns)} from infra_alert_rules
        where tenant_id = ${context.tenantId} order by name asc, id asc`;
    });
  }

  async createRule(context: TenantContext, input: CreateAlertRuleInput): Promise<AlertRuleRecord> {
    return withTenant(this.database, context.tenantId, async (tx) => {
      const [rule] = await tx<AlertRuleRecord[]>`
        insert into infra_alert_rules
          (id, tenant_id, name, kind, instance_id, target_type, target_id, severity, params,
           freshness_seconds, opens_incident)
        values (${randomUUID()}, ${context.tenantId}, ${input.name}, ${input.kind}, ${input.instanceId},
          ${input.targetType}, ${input.targetId}, ${input.severity}, ${tx.json(input.params)},
          ${input.freshnessSeconds}, ${input.opensIncident})
        returning ${tx.unsafe(ruleColumns)}`;
      return rule!;
    }).catch(mapConstraint);
  }

  /**
   * Every column is written from `coalesce(value, column)`, so an absent field keeps what it had.
   *
   * A patch built by string concatenation would be the one place in this file where the shape of
   * a request decides the shape of a statement, and that is not a door worth opening for six
   * columns.
   */
  async updateRule(context: TenantContext, ruleId: string, patch: UpdateAlertRuleInput): Promise<AlertRuleRecord> {
    const rule = await withTenant(this.database, context.tenantId, async (tx) => {
      const [updated] = await tx<AlertRuleRecord[]>`
        update infra_alert_rules set
          name = coalesce(${patch.name ?? null}, name),
          target_type = coalesce(${patch.targetType ?? null}, target_type),
          -- Target is the exception: null is a value here, meaning "watch the whole instance",
          -- so it moves with the type it belongs to rather than being coalesced away.
          target_id = case when ${patch.targetType ?? null}::text is null then target_id else ${patch.targetId ?? null} end,
          severity = coalesce(${patch.severity ?? null}, severity),
          params = coalesce(${patch.params === undefined ? null : tx.json(patch.params)}, params),
          freshness_seconds = coalesce(${patch.freshnessSeconds ?? null}, freshness_seconds),
          opens_incident = coalesce(${patch.opensIncident ?? null}, opens_incident),
          enabled = coalesce(${patch.enabled ?? null}, enabled),
          updated_at = now()
        where tenant_id = ${context.tenantId} and id = ${ruleId}
        returning ${tx.unsafe(ruleColumns)}`;
      return updated ?? null;
    }).catch(mapConstraint);

    if (!rule) throw new InfrastructureServiceError("RULE_NOT_FOUND");
    return rule;
  }

  async deleteRule(context: TenantContext, ruleId: string): Promise<void> {
    const deleted = await withTenant(this.database, context.tenantId, async (tx) => {
      const rows = await tx`delete from infra_alert_rules
        where tenant_id = ${context.tenantId} and id = ${ruleId} returning id`;
      return rows.length;
    });
    if (deleted === 0) throw new InfrastructureServiceError("RULE_NOT_FOUND");
  }

  async listAlerts(
    context: TenantContext,
    input: { status?: "firing" | "resolved" }
  ): Promise<readonly AlertEventRecord[]> {
    return withTenant(this.database, context.tenantId, async (tx) => {
      return tx<AlertEventRecord[]>`
        select ${tx.unsafe(alertColumns)}
        from infra_alert_events e
        join infra_alert_rules r on r.tenant_id = e.tenant_id and r.id = e.rule_id
        where e.tenant_id = ${context.tenantId}
          and (${input.status ?? null}::text is null or e.status = ${input.status ?? null})
        order by e.last_seen_at desc, e.id asc`;
    });
  }

  /**
   * Acknowledging is idempotent and keeps the first hand raised.
   *
   * A second person acknowledging does not overwrite who saw it first: the question the column
   * answers is "did somebody notice", and the first answer is the true one.
   */
  async acknowledgeAlert(context: TenantContext, alertId: string, membershipId: string): Promise<AlertEventRecord> {
    return this.returnOne(
      context,
      alertId,
      (tx) => tx`
      update infra_alert_events set
        acknowledged_at = coalesce(acknowledged_at, now()),
        acknowledged_by_membership_id = coalesce(acknowledged_by_membership_id, ${membershipId}::uuid)
      where tenant_id = ${context.tenantId} and id = ${alertId}
      returning id`
    );
  }

  /**
   * A person closing an alert the sweep would otherwise keep alive.
   *
   * The incident it opened goes to `monitoring` rather than `resolved`: the alert stopping is
   * evidence that the symptom went away, not that anybody looked into why.
   */
  async resolveAlert(context: TenantContext, alertId: string, at: Date): Promise<AlertEventRecord> {
    return this.returnOne(
      context,
      alertId,
      (tx) => tx`
      with closed as (
        update infra_alert_events set status = 'resolved', resolved_at = ${at}, last_seen_at = ${at}
        where tenant_id = ${context.tenantId} and id = ${alertId} and status = 'firing'
        returning id, incident_id
      ), observed as (
        update incidents set status = 'monitoring', updated_at = now()
        where tenant_id = ${context.tenantId} and status = 'open'
          and id in (select incident_id from closed where incident_id is not null)
        returning id
      )
      -- The top level answers "was there an alert to close", which is not the same question as
      -- "was there an incident to put under observation": most alerts open none, and reporting
      -- the incident update as the outcome would make every one of those a not-found.
      select id from closed`
    );
  }

  async readEvaluationState(context: TenantContext): Promise<EvaluationState> {
    return withTenant(this.database, context.tenantId, async (tx) => {
      const rules = await tx<AlertRuleRecord[]>`
        select ${tx.unsafe(ruleColumns)} from infra_alert_rules where tenant_id = ${context.tenantId}`;

      // Only the operation the rules read, and only for instances a rule points at. A tenant with
      // one rule does not pay for reading every record of every instance it has installed.
      const instanceIds = [...new Set(rules.map((rule) => rule.instanceId))];
      const records = instanceIds.length
        ? await tx<ObservedRecord[]>`
            select instance_id as "instanceId", operation, external_id as "externalId", data,
              first_seen_at as "firstSeenAt", last_seen_at as "lastSeenAt"
            from connector_records
            where tenant_id = ${context.tenantId} and operation = ${executionOperation}
              and instance_id in ${tx(instanceIds)}`
        : [];

      const freshness = await tx<{ instanceId: string; operation: string; lastSuccessAt: Date | null }[]>`
        select instance_id as "instanceId", operation, last_success_at as "lastSuccessAt"
        from connector_operation_state where tenant_id = ${context.tenantId}`;

      const liveAlerts = await tx<LiveAlert[]>`
        select rule_id as "ruleId", dedup_key as "dedupKey" from infra_alert_events
        where tenant_id = ${context.tenantId} and status = 'firing'`;

      return { rules, records, liveAlerts, freshness };
    });
  }

  /**
   * Writes every verdict, and says which firings were new.
   *
   * `starved` writes nothing. It is a property of a rule at a moment, not an event that happened,
   * and storing one per rule per two minutes would bury the alerts in a table of shrugs. What
   * shows a starved rule on screen is the rule's freshness, computed at read time.
   */
  async applyVerdicts(
    context: TenantContext,
    verdicts: readonly AlertVerdict[],
    at: Date
  ): Promise<readonly AppliedVerdict[]> {
    const firing = verdicts.filter((verdict) => verdict.status === "firing");
    const resolved = verdicts.filter((verdict) => verdict.status === "resolved");
    if (firing.length === 0 && resolved.length === 0) return [];

    return withTenant(this.database, context.tenantId, async (tx) => {
      const applied: AppliedVerdict[] = [];

      for (const verdict of firing) {
        const [row] = await tx<{ id: string; inserted: boolean }[]>`
          insert into infra_alert_events
            (id, tenant_id, rule_id, dedup_key, status, severity, summary, started_at, last_seen_at)
          values (${randomUUID()}, ${context.tenantId}, ${verdict.ruleId}, ${verdict.dedupKey}, 'firing',
            ${verdict.severity}, ${tx.json(verdict.summary)}, ${at}, ${at})
          on conflict (tenant_id, rule_id, dedup_key) where status = 'firing' do update
            set last_seen_at = ${at},
                occurrences = infra_alert_events.occurrences + 1,
                severity = excluded.severity,
                summary = excluded.summary
          returning id, (xmax = 0) as inserted`;
        applied.push({ ruleId: verdict.ruleId, dedupKey: verdict.dedupKey, alertId: row!.id, created: row!.inserted });
      }

      for (const verdict of resolved) {
        const rows = await tx<{ id: string; incident_id: string | null }[]>`
          update infra_alert_events set status = 'resolved', resolved_at = ${at}, last_seen_at = ${at}
          where tenant_id = ${context.tenantId} and rule_id = ${verdict.ruleId}
            and dedup_key = ${verdict.dedupKey} and status = 'firing'
          returning id, incident_id`;

        const incidents = rows.map((row) => row.incident_id).filter((id): id is string => id !== null);
        if (incidents.length > 0) {
          await tx`update incidents set status = 'monitoring', updated_at = now()
            where tenant_id = ${context.tenantId} and id in ${tx(incidents)} and status = 'open'`;
        }
        for (const row of rows) {
          applied.push({ ruleId: verdict.ruleId, dedupKey: verdict.dedupKey, alertId: row.id, created: false });
        }
      }

      return applied;
    }).catch(mapConstraint);
  }

  async openIncidentForAlert(
    context: TenantContext,
    input: { alertId: string; severity: AlertSeverity; title: string }
  ): Promise<string> {
    return withTenant(this.database, context.tenantId, async (tx) => {
      const incidentId = randomUUID();
      await tx`insert into incidents (id, tenant_id, title, severity, status)
        values (${incidentId}, ${context.tenantId}, ${input.title}, ${input.severity}, 'open')`;
      // Only if the alert has none: a second incident on one alert is the thing the whole
      // dedup design exists to prevent, and a lost race here must not create one.
      const rows = await tx`update infra_alert_events set incident_id = ${incidentId}
        where tenant_id = ${context.tenantId} and id = ${input.alertId} and incident_id is null
        returning id`;
      if (rows.length === 0) throw new InfrastructureServiceError("ALERT_ALREADY_HAS_INCIDENT");
      return incidentId;
    }).catch(mapConstraint);
  }

  /**
   * Retention. No tenant, and no delete privilege either: the function fixes the predicate in the
   * schema and runs as its owner, so this call cannot become a delete of somebody's choosing.
   *
   * Only resolved rows. A firing alert has no age at which it stops mattering.
   */
  async purgeAlertEvents(input: { resolvedBefore: Date; batchLimit: number }): Promise<number> {
    const [row] = await this.database<{ purged: string }[]>`
      select purge_alert_events(${input.resolvedBefore}, ${input.batchLimit}) as purged`;
    return Number(row?.purged ?? 0);
  }

  /** Runs a statement that returns one id, then reads the row back through the listing's shape. */
  private async returnOne(
    context: TenantContext,
    alertId: string,
    statement: (tx: Parameters<Parameters<typeof withTenant>[2]>[0]) => Promise<readonly unknown[]>
  ): Promise<AlertEventRecord> {
    const alert = await withTenant(this.database, context.tenantId, async (tx) => {
      const changed = await statement(tx);
      if (changed.length === 0) return null;
      const [row] = await tx<AlertEventRecord[]>`
        select ${tx.unsafe(alertColumns)}
        from infra_alert_events e
        join infra_alert_rules r on r.tenant_id = e.tenant_id and r.id = e.rule_id
        where e.tenant_id = ${context.tenantId} and e.id = ${alertId}`;
      return row ?? null;
    }).catch(mapConstraint);

    if (!alert) throw new InfrastructureServiceError("ALERT_NOT_FOUND");
    return alert;
  }
}

/**
 * The inventory's own collisions, told apart before the generic mapper sees them.
 *
 * `hostname` is tested before `name` deliberately: one word contains the other, and the wrong
 * order would report a duplicate host name to somebody who reused a Prometheus label. A message
 * that names the wrong field costs an afternoon.
 */
function mapInventoryConstraint(error: unknown): never {
  const databaseError = error as DatabaseError;
  const constraint = databaseError.constraint_name ?? "";
  if (databaseError.code === "23505") {
    if (constraint.includes("hostname")) throw new InfrastructureServiceError("DUPLICATE_HOSTNAME");
    if (constraint.includes("match_key")) throw new InfrastructureServiceError("DUPLICATE_MATCH_KEY");
    if (constraint.includes("infra_services")) throw new InfrastructureServiceError("DUPLICATE_SERVICE_NAME");
    if (constraint.includes("name")) throw new InfrastructureServiceError("DUPLICATE_HOST_NAME");
  }
  return mapConstraint(error);
}

function mapConstraint(error: unknown): never {
  const databaseError = error as DatabaseError;
  if (databaseError.code === "23505" && databaseError.constraint_name?.includes("name")) {
    throw new InfrastructureServiceError("DUPLICATE_RULE_NAME");
  }
  if (databaseError.code === "23505") throw new InfrastructureServiceError("DUPLICATE_ENTRY");
  if (databaseError.code === "23503") throw new InfrastructureServiceError("REFERENCE_NOT_FOUND");
  if (databaseError.code === "23514") throw new InfrastructureServiceError("INVALID_INPUT");
  throw error;
}

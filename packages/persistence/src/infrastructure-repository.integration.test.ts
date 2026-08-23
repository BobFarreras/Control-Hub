import { randomUUID } from "node:crypto";
import type { ConnectorConfig } from "@control-hub/application";
import { createDatabaseClient, type DatabaseClient } from "@control-hub/database";
import type { AlertVerdict, TenantContext } from "@control-hub/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresConnectorRepository } from "./connector-repository.js";
import { PostgresInfrastructureRepository } from "./infrastructure-repository.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const adminUrl = process.env.TEST_DATABASE_ADMIN_URL;
// Skipping locally is a convenience; skipping in CI would mean these guarantees ship unproven.
if (process.env.CI && !(databaseUrl && adminUrl))
  throw new Error("TEST_DATABASE_URL and TEST_DATABASE_ADMIN_URL are required in CI");
const suite = databaseUrl && adminUrl ? describe : describe.skip;

suite("PostgresInfrastructureRepository", () => {
  let database: DatabaseClient;
  let admin: DatabaseClient;
  let repository: PostgresInfrastructureRepository;
  let connectors: PostgresConnectorRepository;

  const tenantA = randomUUID();
  const tenantB = randomUUID();
  // A tenant nothing else in this file writes to, for the assertions about what is *not* read.
  // Those cannot share a tenant with the rest: a rule another test created would make them true
  // or false depending on the order the tests happened to run in.
  const tenantC = randomUUID();
  const userId = randomUUID();
  const membershipA = randomUUID();
  const membershipB = randomUUID();
  const membershipC = randomUUID();
  const now = new Date("2026-08-13T12:00:00.000Z");

  const context = (tenantId: string, membershipId: string): TenantContext => ({
    tenantId,
    membershipId,
    userId,
    roles: ["owner"],
    permissions: ["infrastructure:read", "infrastructure:operate", "integrations:read", "integrations:manage"],
    mfaEnabled: true
  });

  const asA = () => context(tenantA, membershipA);
  const asB = () => context(tenantB, membershipB);
  const asC = () => context(tenantC, membershipC);

  const newInstance = async (tenantId: string, membershipId: string) =>
    connectors.createInstance(context(tenantId, membershipId), {
      connectorType: "generic-webhook",
      name: `instance ${randomUUID()}`,
      config: { eventIdPath: "id" }
    });

  /** A pulled record, written through the same port the worker writes one through. */
  const putRecord = async (
    tenantId: string,
    membershipId: string,
    instanceId: string,
    operation: "pull_workflows" | "pull_executions" | "pull_host_metrics" | "pull_container_state" | "pull_probe_state",
    externalId: string,
    data: ConnectorConfig
  ) =>
    connectors.upsertRecords(context(tenantId, membershipId), {
      instanceId,
      operation,
      // Only executions are events. Everything else is the provider's current answer, overwritten.
      shape: operation === "pull_executions" ? "event" : "state",
      records: [{ externalId, data }],
      seenAt: now
    });

  const newCustomer = async (tenantId: string, name: string) => {
    const id = randomUUID();
    await admin`insert into customers (id, tenant_id, display_name, normalized_name)
      values (${id}, ${tenantId}, ${name}, ${name.toLowerCase()})`;
    return id;
  };

  const newRule = async (instanceId: string, overrides: Record<string, unknown> = {}) =>
    repository.createRule(asA(), {
      name: `rule ${randomUUID()}`,
      kind: "workflow_failed",
      instanceId,
      targetType: "instance",
      targetId: null,
      severity: "high",
      params: {},
      freshnessSeconds: 900,
      opensIncident: false,
      ...overrides
    });

  const firing = (ruleId: string, dedupKey: string): AlertVerdict => ({
    ruleId,
    status: "firing",
    dedupKey,
    severity: "high",
    summary: { workflowId: dedupKey.slice("workflow:".length), failures: "2" }
  });

  const resolution = (ruleId: string, dedupKey: string): AlertVerdict => ({
    ruleId,
    status: "resolved",
    dedupKey,
    severity: "high",
    summary: {}
  });

  beforeAll(async () => {
    database = createDatabaseClient(databaseUrl!);
    admin = createDatabaseClient(adminUrl!);
    repository = new PostgresInfrastructureRepository(database);
    connectors = new PostgresConnectorRepository(database);

    await admin`insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
      values (${userId}, 'Infra Test', ${`${userId}@test.local`}, true, now(), now())`;
    await admin`insert into tenants (id, slug, name) values
      (${tenantA}, ${`infra-a-${tenantA}`}, 'Infra A'), (${tenantB}, ${`infra-b-${tenantB}`}, 'Infra B'),
      (${tenantC}, ${`infra-c-${tenantC}`}, 'Infra C')`;
    await admin`insert into memberships (id, tenant_id, user_id) values
      (${membershipA}, ${tenantA}, ${userId}), (${membershipB}, ${tenantB}, ${userId}),
      (${membershipC}, ${tenantC}, ${userId})`;
  });

  afterAll(async () => {
    // Everything under a tenant cascades from the tenant row, the infrastructure tables included.
    await admin`delete from tenants where id in (${tenantA}, ${tenantB}, ${tenantC})`;
    await admin`delete from "user" where id = ${userId}`;
    await database.end({ timeout: 5 });
    await admin.end({ timeout: 5 });
  });

  const automationsOf = async (instanceId: string) =>
    (await repository.listAutomations(asA())).filter((item) => item.instanceId === instanceId);

  const alertsOf = async (ruleId: string, status?: "firing" | "resolved") =>
    (await repository.listAlerts(asA(), status ? { status } : {})).filter((alert) => alert.ruleId === ruleId);

  describe("automations", () => {
    it("lists what the provider says exists, with what we decided hung off it", async () => {
      const instance = await newInstance(tenantA, membershipA);
      await putRecord(tenantA, membershipA, instance.id, "pull_workflows", "workflow:wf-a", {
        name: "Invoicing",
        active: true,
        archived: false,
        tags: ["billing", "urgent"]
      });
      const customerId = await newCustomer(tenantA, `Client ${randomUUID()}`);

      await repository.linkAutomation(asA(), {
        instanceId: instance.id,
        externalId: "workflow:wf-a",
        customerId,
        notes: "les factures"
      });

      const [automation] = await automationsOf(instance.id);
      expect(automation).toMatchObject({
        externalId: "workflow:wf-a",
        name: "Invoicing",
        active: true,
        archived: false,
        tags: ["billing", "urgent"],
        customerId,
        notes: "les factures"
      });
      expect(automation?.observedAt).toBeInstanceOf(Date);
    });

    it("shows an automation nobody has associated with anybody", async () => {
      const instance = await newInstance(tenantA, membershipA);
      await putRecord(tenantA, membershipA, instance.id, "pull_workflows", "workflow:orphan", {
        name: "Orphan",
        active: false
      });

      const [automation] = await automationsOf(instance.id);
      expect(automation).toMatchObject({
        externalId: "workflow:orphan",
        name: "Orphan",
        tags: [],
        customerId: null,
        notes: null
      });
    });

    it("keeps the notes when the association is withdrawn", async () => {
      const instance = await newInstance(tenantA, membershipA);
      await putRecord(tenantA, membershipA, instance.id, "pull_workflows", "workflow:wf-b", { name: "Second" });
      const customerId = await newCustomer(tenantA, `Client ${randomUUID()}`);

      const link = { instanceId: instance.id, externalId: "workflow:wf-b", customerId, notes: "ojo" };
      await repository.linkAutomation(asA(), link);
      await repository.linkAutomation(asA(), { ...link, customerId: null });

      const [automation] = await automationsOf(instance.id);
      expect(automation).toMatchObject({ customerId: null, notes: "ojo" });
    });

    it("shows one tenant nothing of another's", async () => {
      const instance = await newInstance(tenantB, membershipB);
      await putRecord(tenantB, membershipB, instance.id, "pull_workflows", "workflow:secret", { name: "Theirs" });

      const mine = await repository.listAutomations(asA());
      expect(mine.some((item) => item.externalId === "workflow:secret")).toBe(false);
      const theirs = await repository.listAutomations(asB());
      expect(theirs.some((item) => item.externalId === "workflow:secret")).toBe(true);
    });
  });

  describe("rules", () => {
    it("stores a rule and reads it back with its defaults", async () => {
      const instance = await newInstance(tenantA, membershipA);
      const rule = await newRule(instance.id, { params: { withinMinutes: 30 } });

      expect(rule).toMatchObject({ kind: "workflow_failed", enabled: true, params: { withinMinutes: 30 } });
      expect((await repository.listRules(asA())).some((item) => item.id === rule.id)).toBe(true);
    });

    it("refuses two rules of one tenant sharing a name, and allows it across tenants", async () => {
      const instance = await newInstance(tenantA, membershipA);
      const rule = await newRule(instance.id);

      await expect(newRule(instance.id, { name: rule.name })).rejects.toThrow("DUPLICATE_RULE_NAME");

      const theirInstance = await newInstance(tenantB, membershipB);
      const mirrored = await repository.createRule(asB(), {
        name: rule.name,
        kind: "workflow_failed",
        instanceId: theirInstance.id,
        targetType: "instance",
        targetId: null,
        severity: "high",
        params: {},
        freshnessSeconds: 900,
        opensIncident: false
      });
      expect(mirrored.name).toBe(rule.name);
    });

    it("changes only what the patch mentions", async () => {
      const instance = await newInstance(tenantA, membershipA);
      const rule = await newRule(instance.id, { params: { withinMinutes: 30 }, severity: "critical" });

      const updated = await repository.updateRule(asA(), rule.id, { enabled: false });

      expect(updated).toMatchObject({
        enabled: false,
        severity: "critical",
        params: { withinMinutes: 30 },
        name: rule.name,
        freshnessSeconds: 900
      });
    });

    it("moves the target and its id together", async () => {
      const instance = await newInstance(tenantA, membershipA);
      const rule = await newRule(instance.id);

      const narrowed = await repository.updateRule(asA(), rule.id, {
        targetType: "automation",
        targetId: "workflow:wf-a"
      });
      expect(narrowed).toMatchObject({ targetType: "automation", targetId: "workflow:wf-a" });

      const widened = await repository.updateRule(asA(), rule.id, { targetType: "instance", targetId: null });
      expect(widened).toMatchObject({ targetType: "instance", targetId: null });
    });

    it("refuses a freshness the column will not take", async () => {
      const instance = await newInstance(tenantA, membershipA);
      await expect(newRule(instance.id, { freshnessSeconds: 10 })).rejects.toThrow("INVALID_INPUT");
    });

    it("says so rather than silently doing nothing when the rule is not this tenant's", async () => {
      const instance = await newInstance(tenantB, membershipB);
      const theirs = await repository.createRule(asB(), {
        name: `rule ${randomUUID()}`,
        kind: "workflow_failed",
        instanceId: instance.id,
        targetType: "instance",
        targetId: null,
        severity: "low",
        params: {},
        freshnessSeconds: 900,
        opensIncident: false
      });

      await expect(repository.updateRule(asA(), theirs.id, { enabled: false })).rejects.toThrow("RULE_NOT_FOUND");
      await expect(repository.deleteRule(asA(), theirs.id)).rejects.toThrow("RULE_NOT_FOUND");
    });
  });

  describe("writing down a verdict", () => {
    it("creates the alert the first time and counts it up after that", async () => {
      const instance = await newInstance(tenantA, membershipA);
      const rule = await newRule(instance.id);

      const [first] = await repository.applyVerdicts(asA(), [firing(rule.id, "workflow:wf-a")], now);
      expect(first).toMatchObject({ created: true });

      const later = new Date(now.getTime() + 120_000);
      const [second] = await repository.applyVerdicts(asA(), [firing(rule.id, "workflow:wf-a")], later);
      expect(second).toMatchObject({ created: false, alertId: first!.alertId });

      const [alert] = await alertsOf(rule.id, "firing");
      expect(alert).toMatchObject({ occurrences: 2, ruleName: rule.name, dedupKey: "workflow:wf-a" });
      expect(alert?.startedAt.toISOString()).toBe(now.toISOString());
      expect(alert?.lastSeenAt.toISOString()).toBe(later.toISOString());
    });

    it("keeps one live alert per key however many passes run", async () => {
      const instance = await newInstance(tenantA, membershipA);
      const rule = await newRule(instance.id);
      const verdicts = [firing(rule.id, "workflow:repeated")];

      await repository.applyVerdicts(asA(), verdicts, now);
      await repository.applyVerdicts(asA(), verdicts, now);
      await repository.applyVerdicts(asA(), verdicts, now);

      const live = await alertsOf(rule.id, "firing");
      expect(live).toHaveLength(1);
      expect(live[0]?.occurrences).toBe(3);
    });

    it("resolves what a later pass no longer claims, and lets the next firing start a new row", async () => {
      const instance = await newInstance(tenantA, membershipA);
      const rule = await newRule(instance.id);
      await repository.applyVerdicts(asA(), [firing(rule.id, "workflow:wf-c")], now);

      const resolvedAt = new Date(now.getTime() + 300_000);
      const applied = await repository.applyVerdicts(asA(), [resolution(rule.id, "workflow:wf-c")], resolvedAt);
      expect(applied).toHaveLength(1);

      const again = await repository.applyVerdicts(asA(), [firing(rule.id, "workflow:wf-c")], resolvedAt);
      expect(again[0]).toMatchObject({ created: true });

      const rows = await alertsOf(rule.id);
      expect(rows.map((alert) => alert.status).sort()).toEqual(["firing", "resolved"]);
    });

    it("resolves nothing when nothing was firing, without inventing a row to close", async () => {
      const instance = await newInstance(tenantA, membershipA);
      const rule = await newRule(instance.id);

      const applied = await repository.applyVerdicts(asA(), [resolution(rule.id, "workflow:never")], now);

      expect(applied).toEqual([]);
      expect(await alertsOf(rule.id)).toEqual([]);
    });

    it("writes nothing at all for a starved rule", async () => {
      const instance = await newInstance(tenantA, membershipA);
      const rule = await newRule(instance.id);

      const applied = await repository.applyVerdicts(
        asA(),
        [{ ruleId: rule.id, status: "starved", dedupKey: `rule:${rule.id}`, severity: "high", summary: {} }],
        now
      );

      expect(applied).toEqual([]);
      expect(await alertsOf(rule.id)).toEqual([]);
    });
  });

  describe("the incident an alert opens", () => {
    it("opens one, ties it to the alert, and refuses a second", async () => {
      const instance = await newInstance(tenantA, membershipA);
      const rule = await newRule(instance.id, { opensIncident: true, severity: "critical" });
      const [applied] = await repository.applyVerdicts(asA(), [firing(rule.id, "workflow:wf-d")], now);

      const incidentId = await repository.openIncidentForAlert(asA(), {
        alertId: applied!.alertId,
        severity: "critical",
        title: "Invoicing failures: workflow:wf-d"
      });

      const [alert] = await alertsOf(rule.id, "firing");
      expect(alert?.incidentId).toBe(incidentId);

      await expect(
        repository.openIncidentForAlert(asA(), {
          alertId: applied!.alertId,
          severity: "critical",
          title: "Invoicing failures: workflow:wf-d"
        })
      ).rejects.toThrow("ALERT_ALREADY_HAS_INCIDENT");
    });

    it("puts the incident under observation when the alert resolves, and never closes it itself", async () => {
      const instance = await newInstance(tenantA, membershipA);
      const rule = await newRule(instance.id, { opensIncident: true });
      const [applied] = await repository.applyVerdicts(asA(), [firing(rule.id, "workflow:wf-e")], now);
      const incidentId = await repository.openIncidentForAlert(asA(), {
        alertId: applied!.alertId,
        severity: "high",
        title: "Invoicing failures: workflow:wf-e"
      });

      await repository.applyVerdicts(asA(), [resolution(rule.id, "workflow:wf-e")], new Date(now.getTime() + 60_000));

      const [incident] = await admin<{ status: string }[]>`select status from incidents where id = ${incidentId}`;
      // Closing an incident is a person's decision, which is why this is not `resolved`.
      expect(incident?.status).toBe("monitoring");
    });
  });

  describe("acknowledging and resolving by hand", () => {
    it("records the first person who saw it and does not overwrite them", async () => {
      const instance = await newInstance(tenantA, membershipA);
      const rule = await newRule(instance.id);
      const [applied] = await repository.applyVerdicts(asA(), [firing(rule.id, "workflow:wf-f")], now);

      const acknowledged = await repository.acknowledgeAlert(asA(), applied!.alertId, membershipA);
      expect(acknowledged).toMatchObject({ status: "firing", acknowledgedByMembershipId: membershipA });

      const again = await repository.acknowledgeAlert(asA(), applied!.alertId, membershipA);
      expect(again.acknowledgedAt?.toISOString()).toBe(acknowledged.acknowledgedAt?.toISOString());
    });

    it("returns the closed alert even though it opened no incident", async () => {
      const instance = await newInstance(tenantA, membershipA);
      const rule = await newRule(instance.id);
      const [applied] = await repository.applyVerdicts(asA(), [firing(rule.id, "workflow:wf-g")], now);

      const resolved = await repository.resolveAlert(asA(), applied!.alertId, new Date(now.getTime() + 60_000));

      expect(resolved).toMatchObject({ id: applied!.alertId, status: "resolved", incidentId: null });
      expect(resolved.resolvedAt).toBeInstanceOf(Date);
    });

    it("refuses to touch an alert that is not this tenant's", async () => {
      const instance = await newInstance(tenantB, membershipB);
      const rule = await repository.createRule(asB(), {
        name: `rule ${randomUUID()}`,
        kind: "workflow_failed",
        instanceId: instance.id,
        targetType: "instance",
        targetId: null,
        severity: "high",
        params: {},
        freshnessSeconds: 900,
        opensIncident: false
      });
      const [applied] = await repository.applyVerdicts(asB(), [firing(rule.id, "workflow:theirs")], now);

      await expect(repository.acknowledgeAlert(asA(), applied!.alertId, membershipA)).rejects.toThrow(
        "ALERT_NOT_FOUND"
      );
      await expect(repository.resolveAlert(asA(), applied!.alertId, now)).rejects.toThrow("ALERT_NOT_FOUND");
    });
  });

  describe("what one pass reads", () => {
    it("gathers the rules, the executions of their instances, the live alerts and the freshness", async () => {
      const instance = await newInstance(tenantA, membershipA);
      const rule = await newRule(instance.id);
      await putRecord(tenantA, membershipA, instance.id, "pull_executions", "execution:1", {
        workflowId: "wf-a",
        status: "error",
        startedAt: now.toISOString()
      });
      await putRecord(tenantA, membershipA, instance.id, "pull_workflows", "workflow:wf-a", { name: "Invoicing" });
      await connectors.saveOperationState(asA(), {
        instanceId: instance.id,
        operation: "pull_executions",
        cursor: null,
        ranAt: now,
        succeeded: true
      });
      await repository.applyVerdicts(asA(), [firing(rule.id, "workflow:wf-a")], now);

      const state = await repository.readEvaluationState(asA());

      expect(state.rules.some((item) => item.id === rule.id)).toBe(true);
      expect(state.records.some((item) => item.externalId === "execution:1")).toBe(true);
      // The inventory is not what a rule of this kind reads, so it is not carried into the pass.
      expect(state.records.every((item) => item.operation === "pull_executions")).toBe(true);
      expect(state.liveAlerts).toEqual(expect.arrayContaining([{ ruleId: rule.id, dedupKey: "workflow:wf-a" }]));
      expect(
        state.freshness.some(
          (item) =>
            item.instanceId === instance.id &&
            item.operation === "pull_executions" &&
            item.lastSuccessAt?.toISOString() === now.toISOString()
        )
      ).toBe(true);
    });

    it("reads nothing of another tenant's, which is what makes a sweep safe to run per tenant", async () => {
      const instance = await newInstance(tenantB, membershipB);
      await putRecord(tenantB, membershipB, instance.id, "pull_executions", "execution:theirs", {
        workflowId: "wf-theirs",
        status: "error",
        startedAt: now.toISOString()
      });

      const state = await repository.readEvaluationState(asA());
      expect(state.records.some((item) => item.externalId === "execution:theirs")).toBe(false);
    });

    /** The declared inventory, and the reading of each declared thing whatever pass wrote it. */
    const declaredService = async (matchKey: string) => {
      const host = await repository.declareHost(asA(), {
        name: `VPS ${randomUUID()}`,
        hostname: `node-${randomUUID()}:9100`,
        environment: "production",
        notes: null
      });
      const service = await repository.declareService(asA(), {
        hostId: host.id,
        name: `Servei ${randomUUID()}`,
        kind: "container",
        matchKey,
        expectedState: "up",
        customerId: null
      });
      return { host, service };
    };

    it("carries the inventory, with the name of the machine each service sits on", async () => {
      const instance = await newInstance(tenantA, membershipA);
      await newRule(instance.id, { kind: "service_down" });
      const matchKey = `container:supabase-${randomUUID()}`;
      const { host, service } = await declaredService(matchKey);

      const state = await repository.readEvaluationState(asA());

      expect(state.services).toEqual(
        expect.arrayContaining([{ name: service.name, hostName: host.name, matchKey, expectedState: "up" }])
      );
    });

    it("leaves the inventory unread when no rule would judge it", async () => {
      const instance = await newInstance(tenantC, membershipC);
      await repository.createRule(asC(), {
        name: `rule ${randomUUID()}`,
        kind: "workflow_failed",
        instanceId: instance.id,
        targetType: "instance",
        targetId: null,
        severity: "high",
        params: {},
        freshnessSeconds: 900,
        opensIncident: false
      });
      const host = await repository.declareHost(asC(), {
        name: `VPS ${randomUUID()}`,
        hostname: `node-${randomUUID()}:9100`,
        environment: "production",
        notes: null
      });
      await repository.declareService(asC(), {
        hostId: host.id,
        name: "Sense vigilancia",
        kind: "container",
        matchKey: `container:unwatched-${randomUUID()}`,
        expectedState: "up",
        customerId: null
      });

      expect((await repository.readEvaluationState(asC())).services).toEqual([]);
    });

    it("never carries a service somebody deliberately ignored", async () => {
      const instance = await newInstance(tenantA, membershipA);
      await newRule(instance.id, { kind: "service_down" });
      const matchKey = `container:retired-${randomUUID()}`;
      const { service } = await declaredService(matchKey);
      await repository.updateService(asA(), service.id, { expectedState: "ignored" });

      const state = await repository.readEvaluationState(asA());
      expect(state.services.some((item) => item.matchKey === matchKey)).toBe(false);
    });

    it("fetches a declared service's own reading, whichever pass wrote it", async () => {
      const instance = await newInstance(tenantA, membershipA);
      await newRule(instance.id, { kind: "service_down" });
      const matchKey = `container:n8n-${randomUUID()}`;
      await declaredService(matchKey);
      await putRecord(tenantA, membershipA, instance.id, "pull_container_state", matchKey, { memoryBytes: 1 });

      const state = await repository.readEvaluationState(asA());
      expect(state.records.some((item) => item.externalId === matchKey)).toBe(true);
    });

    it("reads the probe pass for a backup rule, which is where the heartbeat lives", async () => {
      const instance = await newInstance(tenantA, membershipA);
      await newRule(instance.id, { kind: "backup_stale" });
      const externalId = `backup:daily-${randomUUID()}`;
      await putRecord(tenantA, membershipA, instance.id, "pull_probe_state", externalId, {
        lastSuccessAt: now.toISOString()
      });

      const state = await repository.readEvaluationState(asA());
      expect(state.records.some((item) => item.externalId === externalId)).toBe(true);
    });

    /**
     * Two reads want the same probe reading -- one because a certificate lives in it, one because
     * a service was declared against it. A duplicate would become two verdicts sharing a dedup
     * key, and the partial unique index would refuse the second.
     */
    it("returns a reading once even when two rules both want it", async () => {
      const instance = await newInstance(tenantA, membershipA);
      await newRule(instance.id, { kind: "service_down" });
      await newRule(instance.id, { kind: "certificate_expiring" });
      const matchKey = `probe:https://${randomUUID()}.example.com`;
      await declaredService(matchKey);
      await putRecord(tenantA, membershipA, instance.id, "pull_probe_state", matchKey, { success: true });

      const state = await repository.readEvaluationState(asA());
      expect(state.records.filter((item) => item.externalId === matchKey)).toHaveLength(1);
    });

    it("reads no inventory of another tenant's", async () => {
      const instance = await newInstance(tenantA, membershipA);
      await newRule(instance.id, { kind: "service_down" });
      const theirs = await newInstance(tenantB, membershipB);
      const theirHost = await repository.declareHost(asB(), {
        name: `VPS ${randomUUID()}`,
        hostname: `node-${randomUUID()}:9100`,
        environment: "production",
        notes: null
      });
      await repository.declareService(asB(), {
        hostId: theirHost.id,
        name: "Seu",
        kind: "container",
        matchKey: `container:theirs-${randomUUID()}`,
        expectedState: "up",
        customerId: null
      });
      expect(theirs.id).toBeTruthy();

      const state = await repository.readEvaluationState(asA());
      expect(state.services.every((item) => item.hostName !== theirHost.name)).toBe(true);
    });
  });

  describe("what the dashboard reads", () => {
    const declaredMachine = async (tenantId: string, membershipId: string) => {
      const at = context(tenantId, membershipId);
      const hostname = `node-${randomUUID()}:9100`;
      const host = await repository.declareHost(at, {
        name: `VPS ${randomUUID()}`,
        hostname,
        environment: "production",
        notes: null
      });
      const service = await repository.declareService(at, {
        hostId: host.id,
        name: `Servei ${randomUUID()}`,
        kind: "container",
        matchKey: `container:n8n-${randomUUID()}`,
        expectedState: "up",
        customerId: null
      });
      return { host, service, hostname };
    };

    it("gathers the inventory, the reading of every line of it, and the freshness of each pass", async () => {
      const instance = await newInstance(tenantA, membershipA);
      const { host, service, hostname } = await declaredMachine(tenantA, membershipA);
      await putRecord(tenantA, membershipA, instance.id, "pull_host_metrics", `host:${hostname}`, {
        cpuBusyRatio: 0.2
      });
      await putRecord(tenantA, membershipA, instance.id, "pull_container_state", service.matchKey, {
        memoryBytes: 512
      });
      await connectors.saveOperationState(asA(), {
        instanceId: instance.id,
        operation: "pull_host_metrics",
        cursor: null,
        ranAt: now,
        succeeded: true
      });

      const state = await repository.readInventoryState(asA());

      expect(state.hosts.some((item) => item.id === host.id)).toBe(true);
      expect(state.services.some((item) => item.id === service.id)).toBe(true);
      expect(state.records.map((item) => item.externalId)).toEqual(
        expect.arrayContaining([`host:${hostname}`, service.matchKey])
      );
      expect(
        state.freshness.some((item) => item.instanceId === instance.id && item.operation === "pull_host_metrics")
      ).toBe(true);
    });

    /**
     * The read is driven by what was declared, not by what the collectors happen to see. A tenant
     * watching four containers must not pay for every container its Prometheus can enumerate.
     */
    it("asks for the identifiers it declared and for nothing else", async () => {
      const instance = await newInstance(tenantA, membershipA);
      const undeclared = `container:stranger-${randomUUID()}`;
      await putRecord(tenantA, membershipA, instance.id, "pull_container_state", undeclared, { memoryBytes: 1 });

      const state = await repository.readInventoryState(asA());

      expect(state.records.some((item) => item.externalId === undeclared)).toBe(false);
    });

    it("reads no host, no service and no reading of another tenant", async () => {
      const instance = await newInstance(tenantB, membershipB);
      const theirs = await declaredMachine(tenantB, membershipB);
      await putRecord(tenantB, membershipB, instance.id, "pull_container_state", theirs.service.matchKey, {
        memoryBytes: 1
      });

      const state = await repository.readInventoryState(asA());

      expect(state.hosts.some((item) => item.id === theirs.host.id)).toBe(false);
      expect(state.services.some((item) => item.id === theirs.service.id)).toBe(false);
      expect(state.records.some((item) => item.externalId === theirs.service.matchKey)).toBe(false);
    });

    it("reads nothing at all for a tenant that declared nothing", async () => {
      const instance = await newInstance(tenantC, membershipC);
      await putRecord(tenantC, membershipC, instance.id, "pull_container_state", `container:${randomUUID()}`, {});

      expect((await repository.readInventoryState(asC())).records).toEqual([]);
    });
  });

  describe("the inventory somebody declares", () => {
    const declareHost = async (overrides: Record<string, unknown> = {}) =>
      repository.declareHost(asA(), {
        name: `VPS ${randomUUID()}`,
        hostname: `node-${randomUUID()}:9100`,
        environment: "production",
        notes: null,
        ...overrides
      });

    it("keeps a host and the services hung off it, and gives back what it stored", async () => {
      const host = await declareHost({ notes: "La de produccio" });
      const customerId = await newCustomer(tenantA, `Client ${randomUUID()}`);
      const service = await repository.declareService(asA(), {
        hostId: host.id,
        name: "Automatitzacions",
        kind: "container",
        matchKey: `container:n8n-${randomUUID()}`,
        expectedState: "up",
        customerId
      });

      expect(await repository.findHost(asA(), host.id)).toMatchObject({ name: host.name, notes: "La de produccio" });
      expect(service).toMatchObject({ hostId: host.id, kind: "container", expectedState: "up", customerId });
    });

    it("filters services by host, so a machine's page is one read", async () => {
      const [one, two] = [await declareHost(), await declareHost()];
      const onService = async (hostId: string) =>
        repository.declareService(asA(), {
          hostId,
          name: `Servei ${randomUUID()}`,
          kind: "http",
          matchKey: `probe:https://${randomUUID()}.example.com/healthz`,
          expectedState: "up",
          customerId: null
        });
      await onService(one.id);
      await onService(two.id);

      const listed = await repository.listServices(asA(), { hostId: one.id });
      expect(listed.map((item) => item.hostId)).toEqual([one.id]);
    });

    it("tells a duplicate label from a duplicate name, which one word contains the other", async () => {
      const host = await declareHost();

      await expect(declareHost({ name: host.name })).rejects.toMatchObject({ code: "DUPLICATE_HOST_NAME" });
      await expect(declareHost({ hostname: host.hostname })).rejects.toMatchObject({ code: "DUPLICATE_HOSTNAME" });
    });

    it("refuses two services watching the same observed thing", async () => {
      const host = await declareHost();
      const matchKey = `container:supabase-db-${randomUUID()}`;
      const service = {
        hostId: host.id,
        name: `Servei ${randomUUID()}`,
        kind: "database" as const,
        matchKey,
        expectedState: "up" as const,
        customerId: null
      };
      await repository.declareService(asA(), service);

      // Same key, different kind: what makes them the same is what is watched, not how it was
      // classified, so the kind is deliberately not part of the key.
      await expect(
        repository.declareService(asA(), { ...service, name: `Servei ${randomUUID()}`, kind: "container" })
      ).rejects.toMatchObject({ code: "DUPLICATE_MATCH_KEY" });
    });

    it("clears a note and a client when asked to, and leaves them alone when not", async () => {
      const host = await declareHost({ notes: "provisional" });
      const customerId = await newCustomer(tenantA, `Client ${randomUUID()}`);
      const service = await repository.declareService(asA(), {
        hostId: host.id,
        name: `Servei ${randomUUID()}`,
        kind: "container",
        matchKey: `container:${randomUUID()}`,
        expectedState: "up",
        customerId
      });

      expect(await repository.updateHost(asA(), host.id, { environment: "staging" })).toMatchObject({
        environment: "staging",
        notes: "provisional"
      });
      expect(await repository.updateHost(asA(), host.id, { notes: null })).toMatchObject({ notes: null });
      expect(await repository.updateService(asA(), service.id, { expectedState: "ignored" })).toMatchObject({
        expectedState: "ignored",
        customerId
      });
      expect(await repository.updateService(asA(), service.id, { customerId: null })).toMatchObject({
        customerId: null
      });
    });

    it("refuses a state and an environment nobody evaluates", async () => {
      const host = await declareHost();

      await expect(declareHost({ environment: "produccio" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
      await expect(
        repository.declareService(asA(), {
          hostId: host.id,
          name: `Servei ${randomUUID()}`,
          kind: "container",
          matchKey: `container:${randomUUID()}`,
          expectedState: "maybe" as never,
          customerId: null
        })
      ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    });

    it("says so rather than pretending, when the row asked for is not there", async () => {
      expect(await repository.findHost(asA(), randomUUID())).toBeNull();
      await expect(repository.updateHost(asA(), randomUUID(), { notes: null })).rejects.toMatchObject({
        code: "HOST_NOT_FOUND"
      });
      await expect(repository.deleteService(asA(), randomUUID())).rejects.toMatchObject({
        code: "SERVICE_NOT_FOUND"
      });
    });

    it("withdraws a service, and holds no privilege to withdraw a host", async () => {
      const host = await declareHost();
      const service = await repository.declareService(asA(), {
        hostId: host.id,
        name: `Servei ${randomUUID()}`,
        kind: "container",
        matchKey: `container:${randomUUID()}`,
        expectedState: "up",
        customerId: null
      });

      await repository.deleteService(asA(), service.id);
      expect(await repository.listServices(asA(), { hostId: host.id })).toEqual([]);

      // Acceptance criterion 9 is a grant, not a missing route: the application role cannot
      // delete a host even when somebody writes the statement by hand.
      await expect(database`delete from infra_hosts where id = ${host.id}`).rejects.toMatchObject({ code: "42501" });
    });

    it("shows one tenant nothing of the other, hosts and services alike", async () => {
      const host = await declareHost();
      await repository.declareService(asA(), {
        hostId: host.id,
        name: `Servei ${randomUUID()}`,
        kind: "container",
        matchKey: `container:${randomUUID()}`,
        expectedState: "up",
        customerId: null
      });

      expect((await repository.listHosts(asB())).map((item) => item.id)).not.toContain(host.id);
      expect(await repository.findHost(asB(), host.id)).toBeNull();
      expect((await repository.listServices(asB(), {})).map((item) => item.hostId)).not.toContain(host.id);
      // Reaching across with a known id is refused by the policy, not by a missing filter.
      await expect(repository.updateHost(asB(), host.id, { notes: "meu" })).rejects.toMatchObject({
        code: "HOST_NOT_FOUND"
      });
    });
  });

  describe("the guided check", () => {
    const promInstance = async (tenantId: string, membershipId: string) =>
      connectors.createInstance(context(tenantId, membershipId), {
        connectorType: "prometheus",
        name: `prometheus ${randomUUID()}`,
        config: { baseUrl: "http://127.0.0.1:9090" }
      });

    const later = new Date(now.getTime() + 60_000);

    it("finds nothing missing when every migration the module needs has run", async () => {
      const instance = await promInstance(tenantA, membershipA);

      const state = await repository.readDiagnosisState(asA(), instance.id);

      expect(state.missingMigrations).toEqual([]);
      expect(state.instance).toMatchObject({
        id: instance.id,
        connectorType: "prometheus",
        baseUrl: "http://127.0.0.1:9090"
      });
    });

    it("gives back no instance for an id this tenant does not have, without saying whose it is", async () => {
      const foreign = await promInstance(tenantB, membershipB);

      expect(await repository.readDiagnosisState(asC(), foreign.id)).toMatchObject({
        instance: null,
        missingMigrations: []
      });
    });

    it("reports no attempt at all on an instance nobody has run or checked", async () => {
      const instance = await promInstance(tenantA, membershipA);

      expect((await repository.readDiagnosisState(asA(), instance.id)).instance?.lastAttempt).toBeNull();
    });

    /**
     * Why this reads two tables rather than one. A pass that succeeds writes no health at all, so
     * reading `connector_instances` alone would report an installation that has been polling for a
     * week as one nobody has ever asked anything of, and the check would answer "we do not know"
     * about a connector that is plainly working.
     */
    it("counts a successful pass as an attempt, though it wrote down no health", async () => {
      const instance = await promInstance(tenantA, membershipA);
      await connectors.saveOperationState(asA(), {
        instanceId: instance.id,
        operation: "pull_host_metrics",
        cursor: null,
        ranAt: now,
        succeeded: true
      });

      expect((await repository.readDiagnosisState(asA(), instance.id)).instance?.lastAttempt).toEqual({
        ok: true,
        code: null
      });
    });

    it("carries the code of the failure when the failure is the newer of the two", async () => {
      const instance = await promInstance(tenantA, membershipA);
      await connectors.saveOperationState(asA(), {
        instanceId: instance.id,
        operation: "pull_host_metrics",
        cursor: null,
        ranAt: now,
        succeeded: true
      });
      await connectors.recordHealth(asA(), instance.id, {
        status: "failing",
        checkedAt: later,
        errorCode: "CONNECT_TIMEOUT"
      });

      expect((await repository.readDiagnosisState(asA(), instance.id)).instance?.lastAttempt).toEqual({
        ok: false,
        code: "CONNECT_TIMEOUT"
      });
    });

    /** The stale `last_error_code` of a failure that has since been fixed is not evidence. */
    it("stops carrying it once a later pass has worked", async () => {
      const instance = await promInstance(tenantA, membershipA);
      await connectors.recordHealth(asA(), instance.id, {
        status: "failing",
        checkedAt: now,
        errorCode: "CONNECT_TIMEOUT"
      });
      await connectors.saveOperationState(asA(), {
        instanceId: instance.id,
        operation: "pull_host_metrics",
        cursor: null,
        ranAt: later,
        succeeded: true
      });

      expect((await repository.readDiagnosisState(asA(), instance.id)).instance?.lastAttempt).toEqual({
        ok: true,
        code: null
      });
    });

    /**
     * The labels that travel are the ones that could name a machine: a host reading, and a probe
     * reading of an address on a network.
     *
     * **The probed URL here carries `scrapeUp`, and that is the point.** This test used to seed it
     * without one, which quietly agreed with the belief that a blackbox target has no scrape state
     * of its own. It has: Prometheus relabels a blackbox scrape so its `up` line carries the
     * probed URL. With the record shaped the way the connector really writes it, only the rule in
     * the domain keeps the URL out -- and an address is the one thing acceptance criterion 5 says
     * may never leave this process.
     */
    it("reads the labels of stored readings and leaves a probed address out of them", async () => {
      const instance = await promInstance(tenantA, membershipA);
      const label = `vps-${randomUUID()}:9100`;
      await putRecord(tenantA, membershipA, instance.id, "pull_host_metrics", `host:${label}`, { cpuBusyRatio: 0.1 });
      await putRecord(tenantA, membershipA, instance.id, "pull_probe_state", `probe:${label}`, { scrapeUp: true });
      await putRecord(tenantA, membershipA, instance.id, "pull_probe_state", "probe:https://secret.example.test", {
        scrapeUp: true,
        success: true
      });
      await putRecord(tenantA, membershipA, instance.id, "pull_container_state", "container:n8n", { state: "running" });

      const state = await repository.readDiagnosisState(asA(), instance.id);

      expect(state.seenInstances).toEqual([label]);
    });

    it("reads the readings of this instance only, so two collectors are diagnosed apart", async () => {
      const [one, two] = [await promInstance(tenantA, membershipA), await promInstance(tenantA, membershipA)];
      await putRecord(tenantA, membershipA, one.id, "pull_host_metrics", `host:vps-${randomUUID()}:9100`, {
        cpuBusyRatio: 0.1
      });

      expect((await repository.readDiagnosisState(asA(), two.id)).seenInstances).toEqual([]);
    });

    it("lists what this tenant declared, and nothing another tenant did", async () => {
      const declare = async (asTenant: () => TenantContext) =>
        repository.declareHost(asTenant(), {
          name: `VPS ${randomUUID()}`,
          hostname: `node-${randomUUID()}:9100`,
          environment: "production",
          notes: null
        });
      const instance = await promInstance(tenantC, membershipC);
      const [mine, theirs] = [await declare(asC), await declare(asA)];

      const { declaredHostnames } = await repository.readDiagnosisState(asC(), instance.id);

      expect(declaredHostnames).toContain(mine.hostname);
      expect(declaredHostnames).not.toContain(theirs.hostname);
    });
  });

  /**
   * The discovery reads the same two things the guided check's last rung reads, through the same
   * helpers, so what is worth proving here is only what differs: a declared machine arrives with
   * its id and its name, because the screen has to offer a button that opens the right record, and
   * a connector belonging to somebody else is simply not there.
   */
  describe("the discovery", () => {
    const promInstance = async (tenantId: string, membershipId: string) =>
      connectors.createInstance(context(tenantId, membershipId), {
        connectorType: "prometheus",
        name: `prometheus ${randomUUID()}`,
        config: { baseUrl: "http://127.0.0.1:9090" }
      });

    it("reads the labels seen and the machines declared, each with the record it is", async () => {
      const instance = await promInstance(tenantA, membershipA);
      const label = `vps-${randomUUID()}:9100`;
      await putRecord(tenantA, membershipA, instance.id, "pull_host_metrics", `host:${label}`, { cpuBusyRatio: 0.1 });
      const host = await repository.declareHost(asA(), {
        name: `VPS ${randomUUID()}`,
        hostname: label,
        environment: "production",
        notes: null
      });

      const state = await repository.readDiscoveryState(asA(), instance.id);

      expect(state).toMatchObject({ instanceExists: true, missingMigrations: [], seenInstances: [label] });
      expect(state.declaredMachines).toContainEqual({ hostId: host.id, name: host.name, hostname: label });
    });

    it("says the instance is not there for one another tenant owns, and reads nothing of it", async () => {
      const foreign = await promInstance(tenantB, membershipB);

      expect(await repository.readDiscoveryState(asC(), foreign.id)).toEqual({
        instanceExists: false,
        missingMigrations: [],
        seenInstances: [],
        declaredMachines: []
      });
    });

    it("offers this tenant's machines only, so a stranger's hostname cannot be matched against", async () => {
      const instance = await promInstance(tenantC, membershipC);
      const theirs = await repository.declareHost(asA(), {
        name: `VPS ${randomUUID()}`,
        hostname: `node-${randomUUID()}:9100`,
        environment: "production",
        notes: null
      });

      const { declaredMachines } = await repository.readDiscoveryState(asC(), instance.id);

      expect(declaredMachines.map((machine) => machine.hostname)).not.toContain(theirs.hostname);
    });
  });

  describe("retention", () => {
    it("removes resolved alerts past the window and leaves the live ones alone", async () => {
      const instance = await newInstance(tenantA, membershipA);
      const rule = await newRule(instance.id);
      const old = new Date(now.getTime() - 200 * 24 * 60 * 60 * 1000);

      await repository.applyVerdicts(asA(), [firing(rule.id, "workflow:old")], old);
      await repository.applyVerdicts(asA(), [resolution(rule.id, "workflow:old")], old);
      await repository.applyVerdicts(asA(), [firing(rule.id, "workflow:live")], now);

      const cutoff = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000);
      const purged = await repository.purgeAlertEvents({ resolvedBefore: cutoff, batchLimit: 5000 });
      expect(purged).toBeGreaterThanOrEqual(1);

      const remaining = await alertsOf(rule.id);
      expect(remaining.map((alert) => alert.dedupKey)).toEqual(["workflow:live"]);
    });
  });
});

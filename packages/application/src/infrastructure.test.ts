import { connectorRegistry } from "@control-hub/connectors";
import type { AlertVerdict, JsonValue, TenantContext } from "@control-hub/domain";
import { beforeEach, describe, expect, it } from "vitest";
import {
  AlertEngine,
  InfrastructureService,
  InfrastructureServiceError,
  observationBudgets,
  type AlertEventRecord,
  type AlertRuleRecord,
  type AppliedVerdict,
  type AutomationRecord,
  type ConnectorDiagnosisState,
  type ConnectorDiscoveryState,
  type CreateAlertRuleInput,
  type DeclareHostInput,
  type DeclareServiceInput,
  type EvaluationState,
  type HostRecord,
  type InfrastructureRepository,
  type InventoryState,
  type LinkAutomationInput,
  type ServiceRecord,
  type UpdateAlertRuleInput,
  type UpdateHostInput,
  type UpdateServiceInput
} from "./infrastructure.js";

const now = new Date("2026-08-13T12:00:00.000Z");
const instanceId = "instance-1";

const contextWith = (permissions: TenantContext["permissions"]): TenantContext => ({
  tenantId: "tenant-1",
  membershipId: "membership-1",
  userId: "user-1",
  roles: [],
  permissions,
  mfaEnabled: true
});

const owner = contextWith(["infrastructure:read", "infrastructure:operate"]);
const administrator = contextWith(["infrastructure:read"]);
const stranger = contextWith([]);

const ruleRecord = (overrides: Partial<AlertRuleRecord> = {}): AlertRuleRecord => ({
  id: "rule-1",
  name: "Invoicing failures",
  kind: "workflow_failed",
  instanceId,
  targetType: "instance",
  targetId: null,
  severity: "high",
  params: {},
  freshnessSeconds: 900,
  opensIncident: false,
  enabled: true,
  createdAt: now,
  updatedAt: now,
  ...overrides
});

const newRule = (overrides: Partial<CreateAlertRuleInput> = {}): CreateAlertRuleInput => ({
  name: "Invoicing failures",
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

class FakeRepository implements InfrastructureRepository {
  automations: AutomationRecord[] = [];
  links: LinkAutomationInput[] = [];
  rules: AlertRuleRecord[] = [];
  alerts: AlertEventRecord[] = [];
  deleted: string[] = [];
  patches: { ruleId: string; patch: UpdateAlertRuleInput }[] = [];
  state: EvaluationState = { rules: [], records: [], services: [], liveAlerts: [], freshness: [] };
  applied: AppliedVerdict[] = [];
  appliedWith: AlertVerdict[] = [];
  incidents: { alertId: string; severity: string; title: string }[] = [];

  listAutomations = () => Promise.resolve(this.automations);
  linkAutomation = (_context: TenantContext, input: LinkAutomationInput) => {
    this.links.push(input);
    return Promise.resolve();
  };
  hosts: HostRecord[] = [];
  services: ServiceRecord[] = [];
  declaredHosts: DeclareHostInput[] = [];
  hostPatches: { hostId: string; patch: UpdateHostInput }[] = [];
  declaredServices: DeclareServiceInput[] = [];
  servicePatches: { serviceId: string; patch: UpdateServiceInput }[] = [];
  deletedServices: string[] = [];
  serviceFilters: { hostId?: string }[] = [];

  listHosts = () => Promise.resolve(this.hosts);
  findHost = (_context: TenantContext, hostId: string) =>
    Promise.resolve(this.hosts.find((host) => host.id === hostId) ?? null);
  declareHost = (_context: TenantContext, input: DeclareHostInput) => {
    this.declaredHosts.push(input);
    return Promise.resolve(hostRecord(input));
  };
  updateHost = (_context: TenantContext, hostId: string, patch: UpdateHostInput) => {
    this.hostPatches.push({ hostId, patch });
    return Promise.resolve(hostRecord({ id: hostId, ...patch }));
  };
  listServices = (_context: TenantContext, input: { hostId?: string }) => {
    this.serviceFilters.push(input);
    return Promise.resolve(this.services);
  };
  declareService = (_context: TenantContext, input: DeclareServiceInput) => {
    this.declaredServices.push(input);
    return Promise.resolve(serviceRecord(input));
  };
  updateService = (_context: TenantContext, serviceId: string, patch: UpdateServiceInput) => {
    this.servicePatches.push({ serviceId, patch });
    return Promise.resolve(serviceRecord({ id: serviceId, ...patch }));
  };
  deleteService = (_context: TenantContext, serviceId: string) => {
    this.deletedServices.push(serviceId);
    return Promise.resolve();
  };
  listRules = () => Promise.resolve(this.rules);
  createRule = (_context: TenantContext, input: CreateAlertRuleInput) => Promise.resolve(ruleRecord(input));
  updateRule = (_context: TenantContext, ruleId: string, patch: UpdateAlertRuleInput) => {
    this.patches.push({ ruleId, patch });
    return Promise.resolve(ruleRecord({ id: ruleId, ...patch }));
  };
  deleteRule = (_context: TenantContext, ruleId: string) => {
    this.deleted.push(ruleId);
    return Promise.resolve();
  };
  listAlerts = () => Promise.resolve(this.alerts);
  acknowledgeAlert = (_context: TenantContext, alertId: string, membershipId: string) =>
    Promise.resolve({ ...alertEvent(alertId), acknowledgedAt: now, acknowledgedByMembershipId: membershipId });
  resolveAlert = (_context: TenantContext, alertId: string, at: Date) =>
    Promise.resolve({ ...alertEvent(alertId), status: "resolved" as const, resolvedAt: at });
  inventoryState: InventoryState = { hosts: [], services: [], records: [], freshness: [] };
  readInventoryState = () => Promise.resolve(this.inventoryState);
  readEvaluationState = () => Promise.resolve(this.state);
  diagnosisState: ConnectorDiagnosisState = {
    instance: { id: instanceId, connectorType: "prometheus", baseUrl: "http://127.0.0.1:9090", lastAttempt: null },
    missingMigrations: [],
    seenInstances: [],
    declaredHostnames: []
  };
  discoveryState: ConnectorDiscoveryState = {
    instanceExists: true,
    missingMigrations: [],
    seenInstances: [],
    declaredMachines: []
  };
  discoveryAsked: string[] = [];
  readDiscoveryState = (_context: TenantContext, asked: string) => {
    this.discoveryAsked.push(asked);
    return Promise.resolve(this.discoveryState);
  };
  diagnosisAsked: string[] = [];
  readDiagnosisState = (_context: TenantContext, asked: string) => {
    this.diagnosisAsked.push(asked);
    return Promise.resolve(this.diagnosisState);
  };
  /** Retention has no tenant and no session, so nothing in this suite exercises it. */
  purgeAlertEvents = () => Promise.resolve(0);
  applyVerdicts = (_context: TenantContext, verdicts: readonly AlertVerdict[]) => {
    this.appliedWith = [...verdicts];
    return Promise.resolve(this.applied);
  };
  openIncidentForAlert = (_context: TenantContext, input: { alertId: string; severity: string; title: string }) => {
    this.incidents.push(input);
    return Promise.resolve(`incident-${this.incidents.length}`);
  };
}

const hostRecord = (overrides: Partial<HostRecord> = {}): HostRecord => ({
  id: "host-1",
  name: "VPS principal",
  hostname: "node-exporter:9100",
  environment: "production",
  notes: null,
  createdAt: now,
  updatedAt: now,
  ...overrides
});

const newHost = (overrides: Partial<DeclareHostInput> = {}): DeclareHostInput => ({
  name: "VPS principal",
  hostname: "node-exporter:9100",
  environment: "production",
  notes: null,
  ...overrides
});

const serviceRecord = (overrides: Partial<ServiceRecord> = {}): ServiceRecord => ({
  id: "service-1",
  hostId: "host-1",
  name: "Automatitzacions",
  kind: "container",
  matchKey: "container:n8n",
  expectedState: "up",
  customerId: null,
  createdAt: now,
  updatedAt: now,
  ...overrides
});

const newService = (overrides: Partial<DeclareServiceInput> = {}): DeclareServiceInput => ({
  hostId: "host-1",
  name: "Automatitzacions",
  kind: "container",
  matchKey: "container:n8n",
  expectedState: "up",
  customerId: null,
  ...overrides
});

const alertEvent = (id: string): AlertEventRecord => ({
  id,
  ruleId: "rule-1",
  ruleName: "Invoicing failures",
  dedupKey: "workflow:wf-a",
  status: "firing",
  severity: "high",
  summary: {},
  startedAt: now,
  lastSeenAt: now,
  occurrences: 1,
  resolvedAt: null,
  acknowledgedAt: null,
  acknowledgedByMembershipId: null,
  incidentId: null
});

/** Three passes of the cadences the Prometheus connector declares: 2 min, 5 min and 2 min. */
const budgets = { pull_host_metrics: 360, pull_container_state: 900, pull_probe_state: 360 };

let repository: FakeRepository;
let service: InfrastructureService;
/** The deployment's allowlist, already reduced to the question the service is allowed to ask. */
let allowlisted: Set<string>;
beforeEach(() => {
  repository = new FakeRepository();
  allowlisted = new Set(["http://127.0.0.1:9090"]);
  service = new InfrastructureService(repository, budgets, (baseUrl) => allowlisted.has(baseUrl));
});

const refused = (code: string): unknown => expect.objectContaining({ code });

describe("who may do what", () => {
  it("lets Administrator read everything the module holds", async () => {
    await expect(service.listAutomations(administrator)).resolves.toEqual([]);
    await expect(service.listRules(administrator)).resolves.toEqual([]);
    await expect(service.listAlerts(administrator)).resolves.toEqual([]);
    await expect(service.listHosts(administrator)).resolves.toEqual([]);
    await expect(service.listServices(administrator)).resolves.toEqual([]);
  });

  it("refuses Administrator everything that changes something", async () => {
    const link = { instanceId, externalId: "workflow:wf-a", customerId: "customer-1", notes: null };

    await expect(service.linkAutomation(administrator, link)).rejects.toEqual(refused("FORBIDDEN"));
    await expect(service.createRule(administrator, newRule())).rejects.toEqual(refused("FORBIDDEN"));
    await expect(service.updateRule(administrator, "rule-1", { enabled: false })).rejects.toEqual(refused("FORBIDDEN"));
    await expect(service.deleteRule(administrator, "rule-1")).rejects.toEqual(refused("FORBIDDEN"));
    await expect(service.acknowledgeAlert(administrator, "alert-1")).rejects.toEqual(refused("FORBIDDEN"));
    await expect(service.resolveAlert(administrator, "alert-1", now)).rejects.toEqual(refused("FORBIDDEN"));
    await expect(service.declareHost(administrator, newHost())).rejects.toEqual(refused("FORBIDDEN"));
    await expect(service.updateHost(administrator, "host-1", { notes: "x" })).rejects.toEqual(refused("FORBIDDEN"));
    await expect(service.declareService(administrator, newService())).rejects.toEqual(refused("FORBIDDEN"));
    await expect(service.updateService(administrator, "service-1", { name: "Altre" })).rejects.toEqual(
      refused("FORBIDDEN")
    );
    await expect(service.deleteService(administrator, "service-1")).rejects.toEqual(refused("FORBIDDEN"));

    // Nothing reached the repository, so a refusal cannot half-happen.
    expect(
      [
        repository.links,
        repository.deleted,
        repository.patches,
        repository.declaredHosts,
        repository.hostPatches,
        repository.declaredServices,
        repository.servicePatches,
        repository.deletedServices
      ].every((list) => list.length === 0)
    ).toBe(true);
  });

  it("refuses somebody holding neither permission even the read", async () => {
    await expect(service.listAutomations(stranger)).rejects.toEqual(refused("FORBIDDEN"));
  });
});

describe("associating an automation with a client", () => {
  it("passes the association through, trimmed", async () => {
    await service.linkAutomation(owner, {
      instanceId,
      externalId: "workflow:wf-a",
      customerId: "customer-1",
      notes: "  factures del client  "
    });

    expect(repository.links[0]).toEqual({
      instanceId,
      externalId: "workflow:wf-a",
      customerId: "customer-1",
      notes: "factures del client"
    });
  });

  it("keeps the row when the association is removed, because the notes are somebody's work", async () => {
    await service.linkAutomation(owner, { instanceId, externalId: "workflow:wf-a", customerId: null, notes: "ojo" });
    expect(repository.links[0]).toMatchObject({ customerId: null, notes: "ojo" });
  });

  it("refuses notes longer than the column takes, rather than letting the insert say so", async () => {
    const long = { instanceId, externalId: "workflow:wf-a", customerId: null, notes: "x".repeat(2001) };
    await expect(service.linkAutomation(owner, long)).rejects.toEqual(refused("NOTES_TOO_LONG"));
  });
});

describe("a rule that could not be evaluated is not stored", () => {
  it("refuses a freshness budget outside what a budget can mean", async () => {
    await expect(service.createRule(owner, newRule({ freshnessSeconds: 30 }))).rejects.toEqual(
      refused("INVALID_FRESHNESS")
    );
    await expect(service.createRule(owner, newRule({ freshnessSeconds: 86_401 }))).rejects.toEqual(
      refused("INVALID_FRESHNESS")
    );
    await expect(service.createRule(owner, newRule({ freshnessSeconds: 1.5 }))).rejects.toEqual(
      refused("INVALID_FRESHNESS")
    );
  });

  it("refuses a rule aimed at one automation that names none", async () => {
    await expect(service.createRule(owner, newRule({ targetType: "automation" }))).rejects.toEqual(
      refused("TARGET_REQUIRED")
    );
  });

  it("refuses a rule aimed at the instance that also names an automation", async () => {
    const confused = newRule({ targetType: "instance", targetId: "workflow:wf-a" });
    await expect(service.createRule(owner, confused)).rejects.toEqual(refused("TARGET_NOT_ALLOWED"));
  });

  it("refuses a name too short to mean anything on a screen", async () => {
    await expect(service.createRule(owner, newRule({ name: "  x  " }))).rejects.toEqual(refused("INVALID_NAME"));
  });

  it("applies the same rules to an edit as to a creation", async () => {
    await expect(service.updateRule(owner, "rule-1", { freshnessSeconds: 5 })).rejects.toEqual(
      refused("INVALID_FRESHNESS")
    );
    await expect(service.updateRule(owner, "rule-1", { name: "ok name" })).resolves.toMatchObject({
      name: "ok name"
    });
  });

  it("lets a partial edit through without demanding the fields it did not touch", async () => {
    await service.updateRule(owner, "rule-1", { enabled: false });
    expect(repository.patches[0]).toEqual({ ruleId: "rule-1", patch: { enabled: false } });
  });
});

describe("acknowledging is not resolving", () => {
  it("records who saw it and leaves it firing", async () => {
    const alert = await service.acknowledgeAlert(owner, "alert-1");
    expect(alert).toMatchObject({ status: "firing", acknowledgedByMembershipId: "membership-1" });
  });
});

describe("one pass of the engine", () => {
  beforeEach(() => {
    repository.state = {
      rules: [ruleRecord({ opensIncident: true })],
      records: [
        {
          instanceId,
          operation: "pull_executions",
          externalId: "execution:1",
          data: { workflowId: "wf-a", status: "error", startedAt: "2026-08-13T11:55:00.000Z" },
          firstSeenAt: now,
          lastSeenAt: now
        },
        {
          instanceId,
          operation: "pull_executions",
          externalId: "execution:2",
          data: { workflowId: "wf-a", status: "error", startedAt: "2026-08-13T11:57:00.000Z" },
          firstSeenAt: now,
          lastSeenAt: now
        }
      ],
      services: [],
      liveAlerts: [],
      freshness: [{ instanceId, operation: "pull_executions", lastSuccessAt: new Date(now.getTime() - 60_000) }]
    };
  });

  it("writes down what the domain decided, and counts it", async () => {
    repository.applied = [{ ruleId: "rule-1", dedupKey: "workflow:wf-a", alertId: "alert-1", created: true }];

    const result = await new AlertEngine(repository).sweep(owner, now);

    expect(repository.appliedWith).toEqual([expect.objectContaining({ status: "firing", dedupKey: "workflow:wf-a" })]);
    expect(result).toEqual({ firing: 1, resolved: 0, starved: 0, incidentsOpened: 1 });
  });

  it("opens the incident on the first firing and never again", async () => {
    repository.applied = [{ ruleId: "rule-1", dedupKey: "workflow:wf-a", alertId: "alert-1", created: true }];
    await new AlertEngine(repository).sweep(owner, now);
    expect(repository.incidents).toEqual([
      { alertId: "alert-1", severity: "high", title: "Invoicing failures: workflow:wf-a" }
    ]);

    // The second pass finds the alert already there, which is what `created: false` means.
    repository.applied = [{ ruleId: "rule-1", dedupKey: "workflow:wf-a", alertId: "alert-1", created: false }];
    const second = await new AlertEngine(repository).sweep(owner, now);
    expect(repository.incidents).toHaveLength(1);
    expect(second.incidentsOpened).toBe(0);
  });

  it("opens no incident for a rule that was not told to", async () => {
    repository.state = { ...repository.state, rules: [ruleRecord({ opensIncident: false })] };
    repository.applied = [{ ruleId: "rule-1", dedupKey: "workflow:wf-a", alertId: "alert-1", created: true }];

    await new AlertEngine(repository).sweep(owner, now);

    expect(repository.incidents).toEqual([]);
  });

  it("runs with no session behind it, so a job needs no permission it should not have", async () => {
    repository.applied = [];
    const automated = contextWith([]);
    await expect(new AlertEngine(repository).sweep(automated, now)).resolves.toMatchObject({ firing: 1 });
  });

  it("reports a starved rule without touching what was already firing", async () => {
    repository.state = {
      ...repository.state,
      liveAlerts: [{ ruleId: "rule-1", dedupKey: "workflow:wf-a" }],
      freshness: [{ instanceId, operation: "pull_executions", lastSuccessAt: null }]
    };

    const result = await new AlertEngine(repository).sweep(owner, now);

    expect(result).toMatchObject({ firing: 0, resolved: 0, starved: 1 });
    expect(repository.appliedWith.map((verdict) => verdict.status)).toEqual(["starved"]);
  });

  it("does not invent an incident for a verdict the write did not report back", async () => {
    // The write says something was created that this pass never decided. Trusting it would open
    // an incident with no verdict behind it, which is a row nobody could explain afterwards.
    repository.applied = [{ ruleId: "rule-9", dedupKey: "workflow:ghost", alertId: "alert-9", created: true }];

    await new AlertEngine(repository).sweep(owner, now);

    expect(repository.incidents).toEqual([]);
  });

  it("changes nothing when there is nothing to say", async () => {
    repository.state = { rules: [], records: [], services: [], liveAlerts: [], freshness: [] };

    const result = await new AlertEngine(repository).sweep(owner, now);

    expect(result).toEqual({ firing: 0, resolved: 0, starved: 0, incidentsOpened: 0 });
    expect(repository.appliedWith).toEqual([]);
  });

  it("throws away nothing on a second identical pass, because the verdicts are the same", async () => {
    repository.applied = [{ ruleId: "rule-1", dedupKey: "workflow:wf-a", alertId: "alert-1", created: true }];
    const first = await new AlertEngine(repository).sweep(owner, now);
    const firstVerdicts = [...repository.appliedWith];

    repository.applied = [{ ruleId: "rule-1", dedupKey: "workflow:wf-a", alertId: "alert-1", created: false }];
    const second = await new AlertEngine(repository).sweep(owner, now);

    expect(repository.appliedWith).toEqual(firstVerdicts);
    expect(second.firing).toBe(first.firing);
  });
});

describe("declaring what we look after", () => {
  it("keeps the label a reading will be matched by, trimmed", async () => {
    await service.declareHost(owner, newHost({ hostname: "  node-exporter:9100  ", name: "  VPS principal  " }));

    expect(repository.declaredHosts[0]).toMatchObject({ name: "VPS principal", hostname: "node-exporter:9100" });
  });

  it("refuses a label with a space in it, which would never match anything", async () => {
    await expect(service.declareHost(owner, newHost({ hostname: "node exporter" }))).rejects.toEqual(
      refused("INVALID_HOSTNAME")
    );
    await expect(service.declareHost(owner, newHost({ hostname: "" }))).rejects.toEqual(refused("INVALID_HOSTNAME"));
    expect(repository.declaredHosts).toEqual([]);
  });

  it("refuses a label longer than an external id can carry once prefixed", async () => {
    await expect(service.declareHost(owner, newHost({ hostname: "n".repeat(191) }))).rejects.toEqual(
      refused("INVALID_HOSTNAME")
    );
    await expect(service.declareHost(owner, newHost({ hostname: "n".repeat(190) }))).resolves.toBeDefined();
  });

  it("refuses a host whose name says nothing", async () => {
    await expect(service.declareHost(owner, newHost({ name: "no" }))).rejects.toEqual(refused("INVALID_NAME"));
    await expect(service.declareHost(owner, newHost({ name: "n".repeat(121) }))).rejects.toEqual(
      refused("INVALID_NAME")
    );
  });

  it("refuses a note nobody could have meant to write", async () => {
    await expect(service.declareHost(owner, newHost({ notes: "n".repeat(2001) }))).rejects.toEqual(
      refused("NOTES_TOO_LONG")
    );
  });

  it("says so when the host asked for is not there, rather than answering null", async () => {
    await expect(service.getHost(owner, "host-9")).rejects.toEqual(refused("HOST_NOT_FOUND"));

    repository.hosts = [hostRecord()];
    await expect(service.getHost(administrator, "host-1")).resolves.toMatchObject({ id: "host-1" });
  });

  it("validates only what a patch actually carries", async () => {
    await service.updateHost(owner, "host-1", { notes: "  vigilada des del 7.2  " });

    expect(repository.hostPatches[0]).toEqual({ hostId: "host-1", patch: { notes: "vigilada des del 7.2" } });
  });

  it("holds a patched label to the same rule as a declared one", async () => {
    await expect(service.updateHost(owner, "host-1", { hostname: "node exporter" })).rejects.toEqual(
      refused("INVALID_HOSTNAME")
    );
    expect(repository.hostPatches).toEqual([]);
  });
});

describe("declaring a service, and how it is recognised", () => {
  it("keeps the whole external id as the match key, prefix included", async () => {
    await service.declareService(owner, newService({ matchKey: "  container:supabase-db  ", kind: "database" }));

    // The kind says what it is; the key says how it is seen. A database observed by cAdvisor is
    // both, and deriving one from the other would leave `database` with no data behind it.
    expect(repository.declaredServices[0]).toMatchObject({ kind: "database", matchKey: "container:supabase-db" });
  });

  it("refuses a match key that could not be an identifier", async () => {
    await expect(service.declareService(owner, newService({ matchKey: "container: n8n" }))).rejects.toEqual(
      refused("INVALID_MATCH_KEY")
    );
    await expect(service.declareService(owner, newService({ matchKey: "   " }))).rejects.toEqual(
      refused("INVALID_MATCH_KEY")
    );
    await expect(service.declareService(owner, newService({ matchKey: "c".repeat(201) }))).rejects.toEqual(
      refused("INVALID_MATCH_KEY")
    );
    expect(repository.declaredServices).toEqual([]);
  });

  it("takes a probe target as a match key, which is a url and still one word", async () => {
    await service.declareService(
      owner,
      newService({ kind: "http", matchKey: "probe:https://ssn8n.example.com/healthz" })
    );

    expect(repository.declaredServices[0]?.matchKey).toBe("probe:https://ssn8n.example.com/healthz");
  });

  it("carries the host filter through to the repository", async () => {
    await service.listServices(owner, { hostId: "host-1" });
    await service.listServices(owner);

    expect(repository.serviceFilters).toEqual([{ hostId: "host-1" }, {}]);
  });

  it("lets a service be withdrawn, which a host cannot be", async () => {
    await service.deleteService(owner, "service-1");

    expect(repository.deletedServices).toEqual(["service-1"]);
    // There is no `deleteHost` to call, and the grant in `0037` says the same thing.
    expect("deleteHost" in service).toBe(false);
  });
});

describe("the error the service speaks", () => {
  it("is one type with a code, so a route maps it without reading a message", async () => {
    const failure = await service.listAutomations(stranger).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(InfrastructureServiceError);
    expect((failure as InfrastructureServiceError).code).toBe("FORBIDDEN");
  });
});

describe("an infrastructure rule", () => {
  /**
   * The three kinds of 7.2 read one instance's whole inventory and say something per service, so
   * there is nothing for a target to name. Refusing it here rather than storing it keeps the rule
   * out of the table; the same invariant is a check constraint, because a patch never carries the
   * kind and only the row knows it.
   */
  it("is refused when it names a target, because it watches the whole instance", async () => {
    await expect(
      service.createRule(owner, {
        ...newRule(),
        kind: "service_down",
        targetType: "automation",
        targetId: "container:supabase-db"
      })
    ).rejects.toMatchObject({ code: "TARGET_NOT_ALLOWED" });
  });

  it("is accepted instance-wide, for each of the three kinds", async () => {
    for (const kind of ["service_down", "certificate_expiring", "backup_stale"] as const) {
      await expect(service.createRule(owner, { ...newRule(), kind })).resolves.toBeTruthy();
    }
  });

  it("hands the declared inventory to the engine, so a service can be judged at all", async () => {
    repository.state = {
      rules: [ruleRecord({ kind: "service_down", opensIncident: false })],
      records: [],
      services: [
        { name: "Supabase database", hostName: "VPS principal", matchKey: "container:supabase-db", expectedState: "up" }
      ],
      liveAlerts: [],
      freshness: [{ instanceId, operation: "pull_container_state", lastSuccessAt: new Date(now.getTime() - 60_000) }]
    };
    repository.applied = [{ ruleId: "rule-1", dedupKey: "container:supabase-db", alertId: "alert-1", created: true }];

    const result = await new AlertEngine(repository).sweep(owner, now);

    expect(repository.appliedWith).toEqual([
      expect.objectContaining({ status: "firing", dedupKey: "container:supabase-db" })
    ]);
    expect(result.firing).toBe(1);
  });

  it("is starved rather than green when the inventory it would judge is empty", async () => {
    repository.state = {
      rules: [ruleRecord({ kind: "service_down" })],
      records: [],
      services: [],
      liveAlerts: [],
      freshness: [{ instanceId, operation: "pull_container_state", lastSuccessAt: now }]
    };

    const result = await new AlertEngine(repository).sweep(owner, now);

    expect(result).toEqual({ firing: 0, resolved: 0, starved: 1, incidentsOpened: 0 });
  });
});

describe("the budgets a dashboard is allowed to use", () => {
  it("gives every scheduled operation three of its own passes", () => {
    const connectors = [{ capabilities: { operations: { pull_host_metrics: { everySeconds: 120 } } } }];

    expect(observationBudgets(connectors)).toEqual({ pull_host_metrics: 360 });
  });

  /** An operation nobody schedules never runs, so nothing it would observe can be called current. */
  it("gives no budget to an operation with no cadence", () => {
    const connectors = [{ capabilities: { operations: { check_health: {} } } }];

    expect(observationBudgets(connectors)).toEqual({});
  });

  it("keeps the slowest cadence when two connectors name one operation", () => {
    const connectors = [
      { capabilities: { operations: { pull_probe_state: { everySeconds: 120 } } } },
      { capabilities: { operations: { pull_probe_state: { everySeconds: 600 } } } }
    ];

    expect(observationBudgets(connectors)).toEqual({ pull_probe_state: 1800 });
  });

  it("agrees with what the Prometheus connector actually declares", () => {
    expect(observationBudgets([connectorRegistry.require("prometheus")])).toMatchObject(budgets);
  });
});

describe("the inventory a dashboard reads", () => {
  const host = hostRecord({ id: "host-1", hostname: "node-exporter:9100" });
  const container = serviceRecord({ id: "service-1", hostId: "host-1", matchKey: "container:n8n" });

  const seen = (operation: string, externalId: string, secondsAgo: number, data: Record<string, JsonValue> = {}) => ({
    instanceId,
    operation,
    externalId,
    data,
    firstSeenAt: new Date(now.getTime() - 86_400_000),
    lastSeenAt: new Date(now.getTime() - secondsAgo * 1000)
  });

  const passed = (operation: string, secondsAgo: number) => ({
    instanceId,
    operation,
    lastSuccessAt: new Date(now.getTime() - secondsAgo * 1000)
  });

  beforeEach(() => {
    repository.inventoryState = {
      hosts: [host],
      services: [container],
      records: [
        seen("pull_host_metrics", "host:node-exporter:9100", 60, { cpuBusyRatio: 0.2 }),
        seen("pull_container_state", "container:n8n", 120, { memoryBytes: 512 })
      ],
      freshness: [passed("pull_host_metrics", 30), passed("pull_container_state", 60)]
    };
  });

  it("hangs each service under the host it was declared on, with what is known of both", async () => {
    const inventory = await service.readInventory(owner, now);

    expect(inventory.hosts).toHaveLength(1);
    expect(inventory.hosts[0]).toMatchObject({
      id: "host-1",
      hostname: "node-exporter:9100",
      reading: { state: "up", data: { cpuBusyRatio: 0.2 } }
    });
    expect(inventory.hosts[0]!.services).toMatchObject([
      { id: "service-1", reading: { state: "up", data: { memoryBytes: 512 } } }
    ]);
  });

  /**
   * A host is matched by exactly the identifier a reading carries, which is the whole reason
   * `hostname` is required at declaration. A machine nobody can match reads as down rather than
   * as a row with no opinion.
   */
  it("looks a host up by the identifier its reading would carry", async () => {
    repository.inventoryState = { ...repository.inventoryState, hosts: [hostRecord({ hostname: "elsewhere:9100" })] };

    expect((await service.readInventory(owner, now)).hosts[0]!.reading).toMatchObject({ state: "down" });
  });

  it("reports the oldest reading behind it, not the newest", async () => {
    const inventory = await service.readInventory(owner, now);

    expect(inventory.observedFrom).toEqual(new Date(now.getTime() - 120_000));
  });

  it("has no age at all when nothing has been read", async () => {
    repository.inventoryState = { ...repository.inventoryState, records: [], freshness: [] };

    const inventory = await service.readInventory(owner, now);

    expect(inventory.observedFrom).toBeNull();
    expect(inventory.hosts[0]!.reading).toMatchObject({ state: "unknown" });
  });

  it("keeps a host with nothing declared on it, because an empty machine is still watched", async () => {
    repository.inventoryState = { ...repository.inventoryState, services: [] };

    expect((await service.readInventory(owner, now)).hosts[0]!.services).toEqual([]);
  });

  /**
   * The figure at the top of the screen and the rows below it are one claim counted twice. It is
   * counted here, from the same readings the rows are drawn from, so that a screen cannot arrive
   * at a different number of machines being down than the machines it is listing.
   */
  it("counts the machines and the services by the state each of them is in", async () => {
    const inventory = await service.readInventory(owner, now);

    expect(inventory.summary).toEqual({
      hosts: { total: 1, up: 1, down: 0, unknown: 0 },
      services: { total: 1, up: 1, down: 0, unknown: 0 }
    });
  });

  it("counts a collector nobody has heard from as unknown and never as down", async () => {
    repository.inventoryState = { ...repository.inventoryState, records: [], freshness: [] };

    const inventory = await service.readInventory(owner, now);

    expect(inventory.summary.hosts).toEqual({ total: 1, up: 0, down: 0, unknown: 1 });
    expect(inventory.summary.services).toEqual({ total: 1, up: 0, down: 0, unknown: 1 });
  });

  it("counts an empty inventory as zeroes rather than leaving the summary out", async () => {
    repository.inventoryState = { ...repository.inventoryState, hosts: [], services: [] };

    expect((await service.readInventory(owner, now)).summary).toEqual({
      hosts: { total: 0, up: 0, down: 0, unknown: 0 },
      services: { total: 0, up: 0, down: 0, unknown: 0 }
    });
  });

  /** Which collector read a line is what the fleet is filtered by, so it has to survive the trip. */
  it("carries the connector instance each reading came from", async () => {
    const inventory = await service.readInventory(owner, now);

    expect(inventory.hosts[0]!.reading.instanceId).toBe(instanceId);
    expect(inventory.hosts[0]!.services[0]!.reading.instanceId).toBe(instanceId);
  });

  it("lets Administrator read it and refuses somebody with no infrastructure permission", async () => {
    const asAdministrator = await service.readInventory(administrator, now);
    expect(asAdministrator.hosts.map((item) => item.id)).toEqual(["host-1"]);
    await expect(service.readInventory(stranger, now)).rejects.toEqual(refused("FORBIDDEN"));
  });
});

/**
 * The guided check, as the use case assembles it.
 *
 * What is worth proving here rather than in the domain is the coordination: that reading is
 * enough to ask, that the address is compared against the deployment's allowlist and then goes no
 * further, and that the chain really does stop at the first rung that does not hold when the
 * facts come from a repository instead of from a literal.
 *
 * Specification: `docs/specifications/connector-onboarding.md`, "C1 -- La comprovacio guiada".
 */
describe("the guided check", () => {
  const seeing = (overrides: Partial<ConnectorDiagnosisState> = {}) => {
    repository.diagnosisState = {
      instance: { id: instanceId, connectorType: "prometheus", baseUrl: "http://127.0.0.1:9090", lastAttempt: null },
      missingMigrations: [],
      seenInstances: ["node-exporter:9100"],
      declaredHostnames: ["node-exporter:9100"],
      ...overrides
    };
  };

  const statuses = async (context = administrator) =>
    Object.fromEntries((await service.diagnose(context, instanceId)).findings.map((f) => [f.step, f.status]));

  it("is a read, so Administrator may ask for it", async () => {
    seeing({
      instance: {
        id: instanceId,
        connectorType: "prometheus",
        baseUrl: "http://127.0.0.1:9090",
        lastAttempt: { ok: true, code: null }
      }
    });

    await expect(service.diagnose(administrator, instanceId)).resolves.toMatchObject({ problem: null });
    expect(repository.diagnosisAsked).toEqual([instanceId]);
  });

  it("refuses somebody with no infrastructure permission at all", async () => {
    seeing();
    await expect(service.diagnose(stranger, instanceId)).rejects.toEqual(refused("FORBIDDEN"));
  });

  it("says so when this tenant has no such integration", async () => {
    seeing({ instance: null });
    await expect(service.diagnose(owner, instanceId)).rejects.toEqual(refused("INSTANCE_NOT_FOUND"));
  });

  /**
   * The failure this whole increment is named after. With the tables absent there is nowhere for
   * the instance to be, and answering "no such integration" would send somebody looking for a row
   * on a database that has no table to hold it.
   */
  it("answers the migration rung rather than 404 when the schema is not there at all", async () => {
    seeing({ instance: null, missingMigrations: ["0037_infrastructure_hosts.sql"] });
    await expect(service.diagnose(owner, instanceId)).resolves.toMatchObject({ problem: "migrations" });
  });

  /** Acceptance criterion 1: what would have saved the afternoon. */
  it("names the migration that is missing before it judges anything else", async () => {
    seeing({ missingMigrations: ["0037_infrastructure_hosts.sql"] });
    const diagnosis = await service.diagnose(owner, instanceId);

    expect(diagnosis.problem).toBe("migrations");
    expect(diagnosis.findings[0]?.evidence).toEqual({ migrations: ["0037_infrastructure_hosts.sql"] });
  });

  /** Acceptance criterion 2, with the comparison made where the address is. */
  it("fails the origin rung when this deployment's allowlist does not name it", async () => {
    seeing();
    allowlisted.clear();
    await expect(statuses(owner)).resolves.toMatchObject({ allowlist: "failed" });
  });

  it("treats an instance with no base configured as an origin nothing can reach", async () => {
    seeing({
      instance: { id: instanceId, connectorType: "generic-webhook", baseUrl: null, lastAttempt: null }
    });
    await expect(statuses(owner)).resolves.toMatchObject({ allowlist: "failed" });
  });

  /**
   * Acceptance criterion 5, at the boundary that holds the address. The service is the last place
   * that sees a `baseUrl`; what it hands back has no field one could travel in, whatever the
   * repository put on the row.
   */
  it("hands back nothing that carries the address it just compared", async () => {
    seeing({
      instance: {
        id: instanceId,
        connectorType: "prometheus",
        baseUrl: "http://prometheus.internal.example:9090",
        lastAttempt: null
      }
    });
    allowlisted.add("http://prometheus.internal.example:9090");

    expect(JSON.stringify(await service.diagnose(owner, instanceId))).not.toContain("prometheus.internal.example");
  });

  it("says it does not know about the far end until a health check has run", async () => {
    seeing();
    await expect(statuses(owner)).resolves.toMatchObject({ reachable: "unknown", answers_prometheus: "unchecked" });
  });

  /** Acceptance criterion 4: the answer that separates a dead machine from a typo. */
  it("puts what it sees beside what was declared when none of them meet", async () => {
    seeing({
      instance: {
        id: instanceId,
        connectorType: "prometheus",
        baseUrl: "http://127.0.0.1:9090",
        lastAttempt: { ok: true, code: null }
      },
      seenInstances: ["node-exporter:9100"],
      declaredHostnames: ["hub-vps"]
    });

    const diagnosis = await service.diagnose(owner, instanceId);
    expect(diagnosis.problem).toBe("matching");
    expect(diagnosis.findings.at(-1)?.evidence).toEqual({ seen: ["node-exporter:9100"], declared: ["hub-vps"] });
  });
});

/**
 * The discovery, as the use case assembles it.
 *
 * What matters here rather than in the domain is that reading is enough to ask, that a missing
 * schema is reported as such instead of as "no such integration", and that an instance nobody
 * has is refused -- the same three coordination questions the guided check answers, asked of the
 * other read.
 *
 * Specification: `docs/specifications/connector-onboarding.md`, "C3 -- El descobriment".
 */
describe("what a collector is looking at", () => {
  const looking = (overrides: Partial<ConnectorDiscoveryState> = {}) => {
    repository.discoveryState = {
      instanceExists: true,
      missingMigrations: [],
      seenInstances: ["vps-1", "web-2"],
      declaredMachines: [{ hostId: "host-1", name: "VPS principal", hostname: "vps-1" }],
      ...overrides
    };
  };

  it("says which labels are already declared and which are not", async () => {
    looking();

    expect(await service.discover(owner, instanceId)).toEqual([
      { label: "vps-1", declaredAs: { hostId: "host-1", name: "VPS principal" } },
      { label: "web-2", declaredAs: null }
    ]);
  });

  it("is a read, so Administrator may ask for it and a stranger may not", async () => {
    looking();

    expect(await service.discover(administrator, instanceId)).toHaveLength(2);
    await expect(service.discover(stranger, instanceId)).rejects.toEqual(refused("FORBIDDEN"));
  });

  it("asks about the instance it was given", async () => {
    looking();
    await service.discover(owner, instanceId);

    expect(repository.discoveryAsked).toEqual([instanceId]);
  });

  it("refuses an instance this tenant does not have", async () => {
    looking({ instanceExists: false });

    await expect(service.discover(owner, instanceId)).rejects.toEqual(refused("INSTANCE_NOT_FOUND"));
  });

  /**
   * With the schema incomplete there is no `connector_instances` to look in, so "no such
   * integration" would send somebody hunting for a row on a database with no table to hold it.
   * The same reasoning the guided check makes, and the same answer: say the migration is missing.
   */
  it("says the schema is incomplete rather than that the integration is missing", async () => {
    looking({ instanceExists: false, missingMigrations: ["0037_infrastructure_hosts"] });

    await expect(service.discover(owner, instanceId)).rejects.toEqual(refused("MIGRATION_REQUIRED"));
  });
});

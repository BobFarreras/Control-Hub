import {
  currentReading,
  diagnoseConnector,
  discoverInstances,
  discoverServices,
  servicesSeenOnHost,
  evaluateAlertRules,
  hasPermission,
  hostMatchKey,
  incidentFor,
  observedTally,
  type AlertRule,
  type ConnectorDiagnosis,
  type AlertSeverity,
  type AlertVerdict,
  type AlertRuleKind,
  type DeclaredMachine,
  type DeclaredService,
  type DiscoveredInstance,
  type DiscoveredService,
  type ServiceKind,
  type AlertRuleTargetType,
  type JsonValue,
  type LiveAlert,
  type CurrentReading,
  type ObservedRecord,
  type ObservedTally,
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

/**
 * A service the collector reads, with what is currently known of it.
 *
 * The proposal and the state travel together because the screen that shows them is not a form: it
 * is the machine at a glance, and a container listed without saying whether it is running is the
 * list that made somebody open a terminal anyway.
 */
export type ObservedDiscoveredService = DiscoveredService & { reading: CurrentReading };

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

/**
 * A Vercel project as a screen sees it: what is served, what last failed, and our own link.
 *
 * The production state and the last failure are two fields and not one, which is decision 1 of the
 * connector carried up to here: a project can be serving perfectly and have had a build fail ten
 * minutes ago. Both are true at once and the screen has to be able to say so.
 */
export type DeployedProjectRecord = {
  instanceId: string;
  externalId: string;
  name: string;
  /** What it is built with, as the provider names it: `nextjs`, `vite`. Null when it says nothing. */
  framework: string | null;
  /** When the project was created. Context rather than a reading: it does not go stale. */
  createdAt: Date | null;
  /** The domain production serves, or null for a project that has never shipped. */
  domain: string | null;
  /** True when production is serving, false when it is broken, null when nothing shipped yet. */
  productionReady: boolean | null;
  /** What the provider calls it -- `READY`, `ERROR`, `BUILDING`. Null when there is no production. */
  productionState: string | null;
  /**
   * When the deployment production currently points at was created.
   *
   * Which, whenever `productionReady` is true, is the last build that came out well -- production
   * only points at a deployment that finished. That is why the connector keeps no record of
   * successful builds: the useful one is already here, and the rest would be somebody's history.
   */
  productionDeployedAt: Date | null;
  /** The most recent failed build still inside the collector's window, if there is one. */
  lastFailureAt: Date | null;
  lastFailureRef: string | null;
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

/** The same four fields as an automation's link, and a different table: see the migration. */
export type LinkDeployedProjectInput = {
  instanceId: string;
  externalId: string;
  customerId: string | null;
  notes: string | null;
};

export type HostEnvironment = "production" | "staging" | "development";
export type { ServiceKind };
export type ServiceExpectedState = "up" | "stopped" | "ignored";

/** A machine somebody declared, and the label the readings will be matched to it by. */
export type HostRecord = {
  id: string;
  name: string;
  hostname: string;
  environment: HostEnvironment;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type DeclareHostInput = {
  name: string;
  hostname: string;
  environment: HostEnvironment;
  notes: string | null;
};

export type UpdateHostInput = Partial<DeclareHostInput>;

/**
 * Something on a host worth being told about.
 *
 * `kind` says what the service is; `matchKey` says how it is seen. The Postgres of a self-hosted
 * Supabase is a database and is observed as a container, so deriving one from the other would
 * leave a whole kind with no data behind it.
 */
export type ServiceRecord = {
  id: string;
  hostId: string;
  name: string;
  kind: ServiceKind;
  matchKey: string;
  expectedState: ServiceExpectedState;
  customerId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type DeclareServiceInput = {
  hostId: string;
  name: string;
  kind: ServiceKind;
  matchKey: string;
  expectedState: ServiceExpectedState;
  customerId: string | null;
};

/**
 * `hostId` is not patchable. A service that moved machine is watching something else, and letting
 * it move would also let it collide with a name already taken on the host it arrives at.
 */
export type UpdateServiceInput = Partial<Omit<DeclareServiceInput, "hostId">>;

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
  /** The declared inventory, which is what makes a missing reading mean an outage. */
  services: readonly DeclaredService[];
  liveAlerts: readonly LiveAlert[];
  freshness: readonly OperationFreshness[];
};

/**
 * How stale a reading of each operation may be before the dashboard stops calling it current.
 *
 * Keyed by operation because a screen must not invent a threshold of its own: the number comes
 * from the cadence the connector itself declares, so a pass that runs every two minutes and one
 * that runs every five are not held to the same budget. An operation nobody schedules has no
 * cadence and therefore no entry, and everything it would observe reads as unknown.
 */
export type OperationBudgets = Readonly<Record<string, number>>;

/**
 * Passes that could have happened and did not before a reading stops being current.
 *
 * The same three the screen already applies to an automation's age. One missed pass is a slow
 * provider, and holding a reading to a single cadence would paint the dashboard red every time a
 * scrape ran late.
 */
export const observationPasses = 3;

/**
 * The budget of every operation the installed connectors schedule.
 *
 * The longest cadence wins when two connectors declare an operation of the same name: holding a
 * slow collector to a fast one's budget would report its readings as gone while they are merely
 * younger than its next pass.
 */
export function observationBudgets(
  connectors: readonly { capabilities: { operations: Readonly<Record<string, { everySeconds?: number }>> } }[]
): OperationBudgets {
  const budgets: Record<string, number> = {};
  for (const connector of connectors) {
    for (const [operation, declaration] of Object.entries(connector.capabilities.operations)) {
      const every = declaration.everySeconds;
      if (every === undefined) continue;
      budgets[operation] = Math.max(budgets[operation] ?? 0, every * observationPasses);
    }
  }
  return budgets;
}

/** Everything the technical dashboard reads, in one pass so the whole screen agrees on one view. */
export type InventoryState = {
  hosts: readonly HostRecord[];
  services: readonly ServiceRecord[];
  /**
   * Every reading a line of this inventory could be built from.
   *
   * The declared keys and, since C8, everything carrying a discoverable prefix: a container
   * nobody has declared is drawn on the machine that claims the label it was seen on, and it can
   * only be drawn from its own record. One set rather than two, so the state of a container is
   * decided by one function over one pile whether or not somebody has declared it.
   */
  records: readonly ObservedRecord[];
  freshness: readonly OperationFreshness[];
  /** The other labels each machine answers to. Its `hostname` is not repeated here. */
  labels: readonly HostLabel[];
};

/** One collector label a machine has claimed. */
export type HostLabel = { hostId: string; label: string };

export type ObservedService = ServiceRecord & { reading: CurrentReading };

export type ObservedHost = HostRecord & {
  reading: CurrentReading;
  services: readonly ObservedService[];
  /** The other labels this machine answers to, so a screen can offer to withdraw one. */
  labels: readonly string[];
  /**
   * What the collectors see on this machine that nobody has declared.
   *
   * Beside the declared services and not instead of them, because they are two different
   * questions and the product used to answer only one: declaring means "alert me about this", and
   * a machine's page that showed nothing until somebody had declared something was answering
   * "what do you want alerts about" to somebody asking "what is running here".
   */
  observed: readonly ObservedDiscoveredService[];
};

/**
 * The declared inventory with what is currently known about each line of it.
 *
 * `observedFrom` is the oldest reading behind it and not the newest, exactly as in the overview: a
 * dashboard is only as fresh as the stalest thing on it, and the freshest would hide the machine
 * that stopped answering yesterday.
 */
/**
 * How many machines and services there are, and how many of each are up, down or out of sight.
 *
 * It rides on the inventory rather than on the overview route because it is counted from the
 * readings the inventory already computed. Asking the overview for it would mean reading the whole
 * fleet twice per screen, and the second read could disagree with the first.
 */
export type InventorySummary = { hosts: ObservedTally; services: ObservedTally };

export type Inventory = {
  hosts: readonly ObservedHost[];
  summary: InventorySummary;
  observedFrom: Date | null;
};

/**
 * Everything the guided check reads, gathered in one pass so the answer describes one moment.
 *
 * `baseUrl` is here and travels no further than the service: it exists so the origin can be
 * compared against this deployment's allowlist, and the comparison is reduced to a yes or no
 * before the domain -- and therefore before any response -- ever sees it. Acceptance criterion 5
 * is that nothing downstream is even given the address.
 */
export type ConnectorDiagnosisState = {
  /** Null when this tenant has no such connector instance. */
  instance: {
    id: string;
    connectorType: string;
    /** The configured base, or null for an instance that has none. Never leaves this process. */
    baseUrl: string | null;
    /**
     * The last call that went out for this instance and what came of it, or null when none ever
     * has. A pass that succeeded is evidence as good as a health check that did -- an installation
     * whose collector has been polling happily for a week has often never been health-checked at
     * all, and reporting that as "nobody has looked" would be false about the one thing we know.
     */
    lastAttempt: { ok: boolean; code: string | null } | null;
  } | null;
  /**
   * The module's migrations whose objects are not in the database.
   *
   * Answered first and on its own, because when it is not empty the rest of this state cannot be
   * read at all: the tables the other fields come from are the tables that are missing.
   */
  missingMigrations: readonly string[];
  /**
   * Every `instance` label this connector has stored a reading for, prefix already removed.
   *
   * Read from records that are already there. Opening a screen must not be able to make a request
   * go out, so nothing here asks Prometheus anything -- see the specification's C3 decision, which
   * this check shares.
   */
  seenInstances: readonly string[];
  declaredHostnames: readonly string[];
};

/**
 * What the discovery reads: the labels a collector has stored, and the machines already declared.
 *
 * Deliberately not `ConnectorDiagnosisState`, even though the two overlap. The check needs the
 * origin and the last attempt, which the discovery has no use for and should therefore never be
 * handed; the discovery needs each declared machine's name and id, which the check reduces to a
 * list of hostnames because all it asks is whether one matches. Reading exactly what is answered
 * is what keeps an address out of a state object that has no business carrying one.
 *
 * `instanceExists` and not the instance itself, for the same reason: whether this tenant has such
 * a connector is the whole question, and a row would bring its configuration along with the answer.
 */
/**
 * What the service discovery is answered with, which is not what the machine discovery gets.
 *
 * Readings rather than labels, because a service proposal carries the collector that saw it, and
 * declared *keys* rather than declared services, because all this asks of the inventory is
 * whether a key is already spoken for. Neither the instance's configuration nor a service's name
 * has any business here.
 */
export type ConnectorServiceDiscoveryState = {
  instanceExists: boolean;
  /** Answered first and on its own, exactly as in the guided check: see `discover`. */
  missingMigrations: readonly string[];
  /**
   * Every reading this collector wrote about something declarable, whole.
   *
   * Whole, and not the two fields the proposal needs, because the state of a container is decided
   * from the record itself and the alternative was to read the records a second time through the
   * inventory -- which selects by declared key and therefore returns nothing at all for the very
   * services being discovered. Every one of them then had no record, and no record with a fresh
   * pass behind it means `down`: twenty running containers drawn as twenty dead ones.
   */
  records: readonly ObservedRecord[];
  /** When each operation last passed, without which no reading can be told apart from silence. */
  freshness: readonly OperationFreshness[];
  declaredMatchKeys: readonly string[];
};

/**
 * Several services declared in one go, on one machine.
 *
 * A batch and not a loop over the single-service call: somebody ticking eight boxes means the
 * eight, and half of them saved with an error on the screen is a worse state than none of them.
 * The repository puts them in one transaction.
 */
export type DeclareServicesInput = {
  hostId: string;
  services: readonly Omit<DeclareServiceInput, "hostId">[];
};

/**
 * How many a single request may declare.
 *
 * Not a guess about screens: it is above anything a collector realistically offers -- the first
 * real VPS came to twenty-six -- and it keeps one request from turning into an unbounded write.
 */
export const mostServicesPerDeclaration = 100;

export type ConnectorDiscoveryState = {
  instanceExists: boolean;
  /** Answered first and on its own, exactly as in the guided check: see `discover`. */
  missingMigrations: readonly string[];
  seenInstances: readonly string[];
  declaredMachines: readonly DeclaredMachine[];
};

/**
 * Whether this deployment's allowlist names an origin.
 *
 * Injected rather than read here, so the application layer neither touches the environment nor
 * learns what an allowlist is: `CONNECTOR_INTERNAL_ALLOWLIST` is administrative and belongs to
 * the composition root, and a service that could see it is one step from a screen that could
 * write it.
 */
export type OriginAllowlistCheck = (baseUrl: string) => boolean;

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
  listDeployedProjects(context: TenantContext): Promise<readonly DeployedProjectRecord[]>;
  linkDeployedProject(context: TenantContext, input: LinkDeployedProjectInput): Promise<void>;

  listHosts(context: TenantContext): Promise<readonly HostRecord[]>;
  findHost(context: TenantContext, hostId: string): Promise<HostRecord | null>;
  declareHost(context: TenantContext, input: DeclareHostInput): Promise<HostRecord>;
  updateHost(context: TenantContext, hostId: string, patch: UpdateHostInput): Promise<HostRecord>;

  listServices(context: TenantContext, input: { hostId?: string }): Promise<readonly ServiceRecord[]>;
  declareService(context: TenantContext, input: DeclareServiceInput): Promise<ServiceRecord>;
  updateService(context: TenantContext, serviceId: string, patch: UpdateServiceInput): Promise<ServiceRecord>;
  deleteService(context: TenantContext, serviceId: string): Promise<void>;

  listRules(context: TenantContext): Promise<readonly AlertRuleRecord[]>;
  createRule(context: TenantContext, input: CreateAlertRuleInput): Promise<AlertRuleRecord>;
  updateRule(context: TenantContext, ruleId: string, patch: UpdateAlertRuleInput): Promise<AlertRuleRecord>;
  deleteRule(context: TenantContext, ruleId: string): Promise<void>;

  listAlerts(context: TenantContext, input: { status?: "firing" | "resolved" }): Promise<readonly AlertEventRecord[]>;
  acknowledgeAlert(context: TenantContext, alertId: string, membershipId: string): Promise<AlertEventRecord>;
  resolveAlert(context: TenantContext, alertId: string, at: Date): Promise<AlertEventRecord>;

  readInventoryState(context: TenantContext): Promise<InventoryState>;
  addHostLabel(context: TenantContext, hostId: string, label: string): Promise<void>;
  removeHostLabel(context: TenantContext, hostId: string, label: string): Promise<void>;
  readEvaluationState(context: TenantContext): Promise<EvaluationState>;
  readDiagnosisState(context: TenantContext, instanceId: string): Promise<ConnectorDiagnosisState>;
  readDiscoveryState(context: TenantContext, instanceId: string): Promise<ConnectorDiscoveryState>;
  readServiceDiscoveryState(context: TenantContext, instanceId: string): Promise<ConnectorServiceDiscoveryState>;
  declareServices(context: TenantContext, input: DeclareServicesInput): Promise<readonly ServiceRecord[]>;
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
/** The connector caps a host label here so that `host:<label>` still fits an `external_id`. */
const longestHostname = 190;
const longestMatchKey = 200;
const longestNotes = 2_000;

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

  // The three kinds of 7.2 read one instance's whole inventory and speak per service, so there is
  // nothing a target could name. A patch never carries the kind, which is why the same invariant
  // is also a check constraint: only the stored row knows what it is.
  const kind = "kind" in input ? input.kind : undefined;
  if (kind !== undefined && kind !== "workflow_failed" && input.targetType !== "instance") {
    throw new InfrastructureServiceError("TARGET_NOT_ALLOWED");
  }
}

/**
 * Neither a hostname nor a match key may carry a space or a control character.
 *
 * Both are compared with an identifier a provider produced -- a Prometheus label, a container
 * name, a probe target -- and none of those has ever contained one. What a space really means
 * here is a value somebody pasted with something else stuck to it, and stored as typed it would
 * simply never match, which reads on a screen as a service that is fine.
 */
// eslint-disable-next-line no-control-regex -- a control character is exactly what this rejects
const illegible = /[\s\u0000-\u001f\u007f]/;

function checkHostname(hostname: string) {
  const trimmed = hostname.trim();
  if (trimmed.length === 0 || trimmed.length > longestHostname || illegible.test(trimmed)) {
    throw new InfrastructureServiceError("INVALID_HOSTNAME");
  }
  return trimmed;
}

function checkMatchKey(matchKey: string) {
  const trimmed = matchKey.trim();
  if (trimmed.length === 0 || trimmed.length > longestMatchKey || illegible.test(trimmed)) {
    throw new InfrastructureServiceError("INVALID_MATCH_KEY");
  }
  return trimmed;
}

function checkNotes(notes: string | null) {
  if (notes === null) return null;
  if (notes.length > longestNotes) throw new InfrastructureServiceError("NOTES_TOO_LONG");
  return notes.trim() || null;
}

export class InfrastructureService {
  /**
   * The budgets come from outside because they are a property of the deployment's connectors, not
   * of this service: an installation that ships a collector with a different cadence must not need
   * a change here for its dashboard to read correctly.
   */
  constructor(
    private readonly repository: InfrastructureRepository,
    private readonly budgets: OperationBudgets,
    private readonly isOriginAllowlisted: OriginAllowlistCheck
  ) {}

  /**
   * Why a collector is not telling us anything, answered as the first rung of the chain that does
   * not hold.
   *
   * A read, and audited nowhere, because it changes nothing and asks nobody anything: every fact
   * it reasons from is already in our own tables. In particular it opens no connection -- the
   * evidence about the far end is whatever the connector's own health check last reported, which
   * is why the screen offers that check rather than this route performing one.
   *
   * The address never gets past this method. It is compared against the deployment's allowlist
   * here and reduced to a boolean, so what the domain judges, and therefore what any response can
   * carry, has no field an address would fit in.
   */
  async diagnose(context: TenantContext, instanceId: string): Promise<ConnectorDiagnosis> {
    requireRead(context);
    const state = await this.repository.readDiagnosisState(context, instanceId);
    // Only when the schema is whole. With a migration missing there is no `connector_instances`
    // to look in, and answering "no such integration" would send somebody hunting for a row on a
    // database that has no table to hold it -- which is the exact confusion this check exists to
    // end. The migration rung fails first and says what to run.
    if (!state.instance && state.missingMigrations.length === 0) {
      throw new InfrastructureServiceError("INSTANCE_NOT_FOUND");
    }

    const baseUrl = state.instance?.baseUrl ?? null;
    return diagnoseConnector({
      missingMigrations: state.missingMigrations,
      // An instance with no base configured has no origin to be on the list, which fails the same
      // rung for the same reason: nothing can go out.
      originAllowlisted: baseUrl !== null && this.isOriginAllowlisted(baseUrl),
      lastAttempt: state.instance?.lastAttempt ?? null,
      seenInstances: state.seenInstances,
      declaredHostnames: state.declaredHostnames
    });
  }

  /**
   * What a collector can see, said label by label, with each one's declaration when it has one.
   *
   * The same reading the guided check's last rung makes, laid out as a list instead of reduced to
   * a yes or no, and computed by the same domain file so the two cannot come to differ about what
   * counts as a match. A read, audited nowhere, and it sends nothing anywhere: the labels come
   * from readings already stored, which is what makes opening this screen incapable of causing a
   * request to go out.
   *
   * The migration rung fails first, as it does in the check. With the schema incomplete there is
   * no `connector_instances` to look in, and "no such integration" would be a false answer about
   * a table that is not there.
   */
  async discover(context: TenantContext, instanceId: string): Promise<readonly DiscoveredInstance[]> {
    requireRead(context);
    const state = await this.repository.readDiscoveryState(context, instanceId);
    if (state.missingMigrations.length > 0) throw new InfrastructureServiceError("MIGRATION_REQUIRED");
    if (!state.instanceExists) throw new InfrastructureServiceError("INSTANCE_NOT_FOUND");

    return discoverInstances({ seenInstances: state.seenInstances, declaredMachines: state.declaredMachines });
  }

  /**
   * What this collector has seen that could be declared, and what already has been.
   *
   * The sibling of `discover`, and the same three refusals in the same order: the migration rung
   * first, because with the schema incomplete there is no table to look in and "no such
   * integration" would be a false answer about something that is not there.
   *
   * Like the machine discovery, this reads what is already stored. Opening the screen cannot
   * cause a request to leave the process.
   */
  async discoverServices(
    context: TenantContext,
    instanceId: string,
    now: Date
  ): Promise<readonly ObservedDiscoveredService[]> {
    requireRead(context);
    const state = await this.repository.readServiceDiscoveryState(context, instanceId);
    if (state.missingMigrations.length > 0) throw new InfrastructureServiceError("MIGRATION_REQUIRED");
    if (!state.instanceExists) throw new InfrastructureServiceError("INSTANCE_NOT_FOUND");

    // `host` is the label of whoever saw the thing and only container readings carry one. Pulled
    // out here rather than asked of the database twice: the records were already read, and the
    // proposal wants two of their fields.
    const seenRecords = state.records.map((record) => ({
      externalId: record.externalId,
      seenOn: typeof record.data.host === "string" ? record.data.host : null
    }));

    const found = discoverServices({ seenRecords, declaredMatchKeys: state.declaredMatchKeys });
    if (found.length === 0) return [];

    // The very same judgement the inventory makes, over the very same records: a container that
    // somebody declared and the same container still undeclared cannot end up drawn two different
    // ways, because there is one function deciding it and it does not know which of the two it is
    // looking at.
    return found.map((service) => ({
      ...service,
      reading: currentReading({
        matchKey: service.matchKey,
        records: state.records,
        freshness: state.freshness,
        budgets: this.budgets,
        now
      })
    }));
  }

  /**
   * Declares several services on one machine, or none of them.
   *
   * Every name and key goes through the same two checks as a service declared by hand, and it
   * happens here rather than in the repository so that a batch cannot become the way to store a
   * value the single-service path refuses. An empty batch is a caller mistake and not an
   * expensive no-op, so it is refused rather than answered with an empty list.
   */
  async declareServices(context: TenantContext, input: DeclareServicesInput): Promise<readonly ServiceRecord[]> {
    requireOperate(context);
    if (input.services.length === 0 || input.services.length > mostServicesPerDeclaration) {
      throw new InfrastructureServiceError("INVALID_INPUT");
    }

    return await this.repository.declareServices(context, {
      hostId: input.hostId,
      services: input.services.map((service) => ({
        ...service,
        name: checkName(service.name),
        matchKey: checkMatchKey(service.matchKey)
      }))
    });
  }

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
    await this.repository.linkAutomation(context, { ...input, notes: checkNotes(input.notes) });
  }

  async listDeployedProjects(context: TenantContext): Promise<readonly DeployedProjectRecord[]> {
    requireRead(context);
    return await this.repository.listDeployedProjects(context);
  }

  /**
   * Associates a Vercel project with a client, or takes the association away.
   *
   * A null customer is the removal: the row stays, because the notes on it are somebody's work.
   */
  async linkDeployedProject(context: TenantContext, input: LinkDeployedProjectInput): Promise<void> {
    requireOperate(context);
    await this.repository.linkDeployedProject(context, { ...input, notes: checkNotes(input.notes) });
  }

  async listHosts(context: TenantContext): Promise<readonly HostRecord[]> {
    requireRead(context);
    return await this.repository.listHosts(context);
  }

  async getHost(context: TenantContext, hostId: string): Promise<HostRecord> {
    requireRead(context);
    const host = await this.repository.findHost(context, hostId);
    if (!host) throw new InfrastructureServiceError("HOST_NOT_FOUND");
    return host;
  }

  /**
   * Declares a machine we look after.
   *
   * `hostname` is required and is the whole reason the row is worth having: it is what a reading
   * is matched to a host by. A host nothing can be matched to is a name on a screen that the data
   * is never able to contradict.
   */
  async declareHost(context: TenantContext, input: DeclareHostInput): Promise<HostRecord> {
    requireOperate(context);
    return await this.repository.declareHost(context, {
      ...input,
      name: checkName(input.name),
      hostname: checkHostname(input.hostname),
      notes: checkNotes(input.notes)
    });
  }

  async updateHost(context: TenantContext, hostId: string, patch: UpdateHostInput): Promise<HostRecord> {
    requireOperate(context);
    return await this.repository.updateHost(context, hostId, {
      ...patch,
      ...(patch.name === undefined ? {} : { name: checkName(patch.name) }),
      ...(patch.hostname === undefined ? {} : { hostname: checkHostname(patch.hostname) }),
      ...(patch.notes === undefined ? {} : { notes: checkNotes(patch.notes) })
    });
  }

  async listServices(context: TenantContext, input: { hostId?: string } = {}): Promise<readonly ServiceRecord[]> {
    requireRead(context);
    return await this.repository.listServices(context, input);
  }

  async declareService(context: TenantContext, input: DeclareServiceInput): Promise<ServiceRecord> {
    requireOperate(context);
    return await this.repository.declareService(context, {
      ...input,
      name: checkName(input.name),
      matchKey: checkMatchKey(input.matchKey)
    });
  }

  async updateService(context: TenantContext, serviceId: string, patch: UpdateServiceInput): Promise<ServiceRecord> {
    requireOperate(context);
    return await this.repository.updateService(context, serviceId, {
      ...patch,
      ...(patch.name === undefined ? {} : { name: checkName(patch.name) }),
      ...(patch.matchKey === undefined ? {} : { matchKey: checkMatchKey(patch.matchKey) })
    });
  }

  /**
   * Another name one machine answers to.
   *
   * The same validation a `hostname` gets, because it is the same kind of thing: a label the
   * collector will be compared against. A label already taken -- by this table or by another
   * machine's `hostname` -- comes back as `DUPLICATE_HOSTNAME`, and both halves are decided in
   * the repository's transaction: one is a primary key, the other a query, and doing the second
   * one here would leave a window where two machines can claim the same label at once.
   */
  async addHostLabel(context: TenantContext, hostId: string, label: string): Promise<void> {
    requireOperate(context);
    await this.repository.addHostLabel(context, hostId, checkHostname(label));
  }

  /**
   * Withdrawing one loses nothing: no service, no alert and no history hangs off a label, and the
   * readings it matched stay exactly where they are. That is why this exists and `deleteHost`
   * does not.
   */
  async removeHostLabel(context: TenantContext, hostId: string, label: string): Promise<void> {
    requireOperate(context);
    await this.repository.removeHostLabel(context, hostId, label);
  }

  /**
   * Deciding a service no longer matters is ordinary and audited, which is why this exists and
   * `deleteHost` does not: the privilege on the table says the same thing.
   */
  async deleteService(context: TenantContext, serviceId: string): Promise<void> {
    requireOperate(context);
    await this.repository.deleteService(context, serviceId);
  }

  /**
   * The declared inventory with what is currently known about each line of it.
   *
   * Judged by the same reading the `service_down` rule uses, so the dashboard and the alerts
   * cannot disagree about what "down" means. What the dashboard adds is the third answer: a
   * collector we have lost sight of leaves every line `unknown`, never down.
   *
   * A host is looked up by exactly the identifier a reading would carry, which is what makes
   * `hostname` required at declaration: a host nothing can be matched to is a name the data is
   * never able to contradict.
   */
  async readInventory(context: TenantContext, now: Date): Promise<Inventory> {
    requireRead(context);
    const state = await this.repository.readInventoryState(context);
    const read = (matchKey: string) =>
      currentReading({ matchKey, records: state.records, freshness: state.freshness, budgets: this.budgets, now });

    const observed: Date[] = [];
    const remember = (reading: CurrentReading) => {
      if (reading.observedAt) observed.push(reading.observedAt);
      return reading;
    };

    // Every declared key of the tenant, not this machine's: a key is unique across the inventory,
    // so one already spoken for elsewhere must not be offered here as undeclared either.
    const declaredMatchKeys = state.services.map((service) => service.matchKey);
    const seen = state.records.map((record) => ({
      externalId: record.externalId,
      seenOn: typeof record.data.host === "string" ? record.data.host : null
    }));

    const hosts = state.hosts.map<ObservedHost>((host) => {
      const labels = state.labels.filter((entry) => entry.hostId === host.id).map((entry) => entry.label);
      return {
        ...host,
        reading: remember(read(hostMatchKey(host.hostname))),
        services: state.services
          .filter((service) => service.hostId === host.id)
          .map<ObservedService>((service) => ({ ...service, reading: remember(read(service.matchKey)) })),
        labels,
        // Not remembered into `observed`: the freshness at the top of the screen is about the
        // inventory somebody keeps, and a container nobody declared should not be able to make a
        // dashboard look stale. It carries its own age on its own row.
        observed: servicesSeenOnHost({
          labels: [host.hostname, ...labels],
          records: seen,
          declaredMatchKeys
        }).map((service) => ({ ...service, reading: read(service.matchKey) }))
      };
    });

    return {
      hosts,
      // Counted from the very readings the rows were built from, by the domain rather than here,
      // so the figure at the top of the screen cannot drift from the list underneath it.
      summary: {
        hosts: observedTally(hosts.map((host) => host.reading.state)),
        services: observedTally(hosts.flatMap((host) => host.services.map((service) => service.reading.state)))
      },
      observedFrom: observed.length > 0 ? new Date(Math.min(...observed.map((at) => at.getTime()))) : null
    };
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
      services: state.services,
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

/**
 * Why a collector is not telling us anything, answered one rung at a time.
 *
 * Connecting the first real VPS cost an afternoon, and none of the three obstacles was a defect
 * in the code: a migration that had not been applied, an origin nobody knew had to be named in
 * `CONNECTOR_INTERNAL_ALLOWLIST`, and a host label that did not match the one the metrics carry.
 * All three came out of the panel as the same sentence -- "the operation could not be completed"
 * -- and the cost was never the typing. It was not knowing which of them it was.
 *
 * Three properties shape what is here, and each is a rule from the specification rather than a
 * preference.
 *
 * **It is a chain, and it stops.** Every rung is only meaningful if the one below it is true, so
 * the first one that does not hold is the answer and the rest are reported unchecked. Judging
 * them anyway would manufacture findings: "no readings" says nothing about a machine when the
 * reason is that no request has ever left the process.
 *
 * **Absence of evidence is its own answer.** A connector nobody has ever asked anything of is
 * `unknown`, never `failed`. It is the same distinction `currentReading` draws between a machine
 * that is down and a collector we have lost sight of, and for the same reason: the moment somebody
 * needs this screen to be honest is the moment a confident wrong answer costs most.
 *
 * **It is never given an address.** No parameter here can hold a `baseUrl`, a credential or a
 * provider hostname, so no arrangement of inputs can produce a response carrying one -- which is
 * acceptance criterion 5 held by construction rather than by review. Where a sentence needs the
 * address, the screen composes it from what the person just typed into the form.
 *
 * Specification: `docs/specifications/connector-onboarding.md`, "C1 -- La comprovacio guiada".
 */

import type { ServiceKind } from "./infrastructure.js";

/**
 * The rungs, in the order they are climbed.
 *
 * The specification lists seven and the first is missing here on purpose: with the
 * `infrastructure` flag closed there is no route to ask, so "the flag is open" is answered by the
 * 404 rather than by a finding. What is left is what a running module can still get wrong.
 */
export const connectorDiagnosisSteps = [
  "migrations",
  "allowlist",
  "reachable",
  "answers_prometheus",
  "scraping",
  "matching"
] as const;

export type ConnectorDiagnosisStep = (typeof connectorDiagnosisSteps)[number];

/**
 * `unknown` is a rung nobody has gathered evidence for yet; `unchecked` is one the chain never
 * reached. Keeping them apart is what lets the screen say "ask for a health check" instead of
 * reporting a tunnel as shut when nobody has knocked on it.
 */
export type DiagnosisStatus = "passed" | "failed" | "unknown" | "unchecked";

export type DiagnosisFinding = {
  step: ConnectorDiagnosisStep;
  status: DiagnosisStatus;
  /** The failed check's own code, from the closed vocabulary a screen already translates. */
  code: string | null;
  /**
   * The names the sentence needs, and only those: migration file names and `instance` labels,
   * both of which a reader already sees elsewhere in the product. There is no key here an address
   * or a secret could travel under.
   */
  evidence: Readonly<Record<string, readonly string[]>>;
};

export type ConnectorDiagnosis = {
  findings: readonly DiagnosisFinding[];
  /** The first rung that does not hold, or null when the whole chain does. */
  problem: ConnectorDiagnosisStep | null;
};

/**
 * The facts a diagnosis reasons from, each already reduced to something that cannot carry an
 * address.
 *
 * `originAllowlisted` is a boolean rather than the list and the URL, deliberately: the comparison
 * belongs to the process that holds both, and reducing it to a yes or no before it arrives here
 * is what keeps the configured base out of this file entirely.
 */
export type ConnectorDiagnosisFacts = {
  /** The module's migrations whose objects are not in the database, in any order. */
  missingMigrations: readonly string[];
  /** Whether this deployment's allowlist names the instance's own origin. */
  originAllowlisted: boolean;
  /**
   * The last time we tried to reach the provider and what came of it, or null when nothing ever
   * has. A successful pass counts as much as a health check: both are a call that got there.
   */
  lastAttempt: { ok: boolean; code: string | null } | null;
  /** Every `instance` label the connector has stored a reading for. */
  seenInstances: readonly string[];
  /** The `hostname` of every machine declared in this tenant. */
  declaredHostnames: readonly string[];
};

/**
 * What the egress guard refuses before anything leaves the process.
 *
 * They answer at the allowlist rung because that is the question they are all about: whether this
 * deployment lets a call go to that address at all. The code travels with the finding, so the
 * screen still says which of them it was rather than collapsing five causes into one sentence.
 */
const guardCodes: ReadonlySet<string> = new Set([
  "DESTINATION_NOT_ALLOWLISTED",
  "DESTINATION_OUTSIDE_BASE_URL",
  "SCHEME_NOT_ALLOWED",
  "URL_NOT_PARSEABLE",
  "URL_HAS_CREDENTIALS",
  "NO_BASE_URL_CONFIGURED"
]);

/** The call left the process and nothing at the other end took it, or took it and let go. */
const unreachableCodes: ReadonlySet<string> = new Set([
  "ADDRESS_NOT_ROUTABLE",
  "DNS_RESOLUTION_FAILED",
  "CONNECT_TIMEOUT",
  "CONNECTION_FAILED",
  "CONNECTION_RESET",
  "HEADERS_TIMEOUT",
  "TIMEOUT",
  "TOTAL_TIMEOUT",
  "BUDGET_EXHAUSTED",
  "RESPONSE_FAILED",
  "TOO_MANY_REDIRECTS"
]);

/**
 * Which rung a failed check answers at.
 *
 * Anything unrecognised lands on `answers_prometheus`, which is the safe rung rather than an
 * arbitrary one: everything below it is then reported as evidence we genuinely have, and the
 * sentence is about the far end -- which is what a code from a connector newer than this screen
 * most likely means. A code that landed nowhere would leave the whole chain unchecked and say
 * less than the generic sentence this file exists to replace.
 */
function rungFor(code: string): ConnectorDiagnosisStep {
  if (guardCodes.has(code)) return "allowlist";
  if (unreachableCodes.has(code)) return "reachable";
  return "answers_prometheus";
}

/** One copy of each, in a stable order, so the same state always reads the same way. */
function distinct(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort();
}

/**
 * The chain, climbed once.
 *
 * The three rungs the health check answers for are decided together, because they read one piece
 * of evidence: a check that succeeded proves all three, and a check that failed proves the ones
 * below whichever it failed at. Splitting them would mean asking the same fact three questions
 * and getting three chances to disagree with itself.
 */
export function diagnoseConnector(facts: ConnectorDiagnosisFacts): ConnectorDiagnosis {
  const findings: DiagnosisFinding[] = [];
  let stopped = false;

  const rung = (
    step: ConnectorDiagnosisStep,
    verdict: { status: DiagnosisStatus; code?: string | null; evidence?: Record<string, readonly string[]> }
  ) => {
    if (stopped) {
      findings.push({ step, status: "unchecked", code: null, evidence: {} });
      return;
    }
    if (verdict.status !== "passed") stopped = true;
    findings.push({
      step,
      status: verdict.status,
      code: verdict.code ?? null,
      evidence: verdict.status === "passed" ? {} : (verdict.evidence ?? {})
    });
  };

  const missing = distinct(facts.missingMigrations);
  rung(
    "migrations",
    missing.length === 0 ? { status: "passed" } : { status: "failed", evidence: { migrations: missing } }
  );

  // A check that failed at a rung proves the ones under it: the call reached the far end, so
  // whatever the guard and the network would have said about it, they said yes.
  const failedAt = facts.lastAttempt && !facts.lastAttempt.ok ? facts.lastAttempt : null;
  const failedRung = failedAt?.code ? rungFor(failedAt.code) : null;
  const checkVerdict = (step: ConnectorDiagnosisStep): { status: DiagnosisStatus; code?: string | null } => {
    if (facts.lastAttempt?.ok) return { status: "passed" };
    // Never asked, or asked and told only that it went wrong: either way nobody has evidence
    // about the network, and the rung above it is not reached rather than presumed.
    if (!failedAt?.code) return step === "reachable" ? { status: "unknown" } : { status: "passed" };
    return failedRung === step ? { status: "failed", code: failedAt.code } : { status: "passed" };
  };

  // Our own copy of the list answers even with no check at all, because that comparison needs no
  // far end. A run that went out and was refused overrules it: the process that tried is right,
  // and the two disagreeing is itself the finding -- the API and the worker read their own copy
  // of the environment, and a deployment can hand them different ones. The code travels only when
  // the guard is what spoke, so a timeout never arrives labelled as an allowlist problem.
  const guardFailed = failedRung === "allowlist";
  rung(
    "allowlist",
    facts.originAllowlisted && !guardFailed
      ? { status: "passed" }
      : { status: "failed", code: guardFailed ? (failedAt?.code ?? null) : null }
  );

  rung("reachable", checkVerdict("reachable"));
  rung("answers_prometheus", checkVerdict("answers_prometheus"));

  const seen = distinct(facts.seenInstances);
  const declared = distinct(facts.declaredHostnames);

  rung("scraping", seen.length > 0 ? { status: "passed" } : { status: "failed" });

  // Character for character, because that is exactly how a reading is joined to a machine. A
  // label that is nearly right matches nothing and reads on the screen as "no readings", which is
  // indistinguishable from a machine that died -- and that is the confusion this rung removes.
  const matched = seen.some((label) => declared.includes(label));
  rung("matching", matched ? { status: "passed" } : { status: "failed", evidence: { seen, declared } });

  return { findings, problem: findings.find((finding) => finding.status !== "passed")?.step ?? null };
}

/** A machine somebody has declared, reduced to what the discovery needs to name it. */
export type DeclaredMachine = { hostId: string; name: string; hostname: string };

/**
 * One `instance` label a collector has stored a reading for, and whether anybody claimed it.
 *
 * `declaredAs` names the machine rather than merely saying yes, because "already declared" and
 * "already declared, as this" are different answers to somebody looking at a list of labels they
 * half recognise.
 */
export type DiscoveredInstance = {
  label: string;
  declaredAs: { hostId: string; name: string } | null;
};

/**
 * Whether a label a collector reads could ever name a machine.
 *
 * A machine's figures come from `pull_host_metrics`, which stores them under `host:<label>`.
 * Anything else the collector scrapes is a door it knocks on, and a URL among those doors is a
 * service, never a machine. Declared as one it can never light up: no host reading will ever
 * carry that label, so the screen says "no readings" for ever and looks exactly like a machine
 * that died.
 *
 * This existed as an assumption before it existed as a rule, and the assumption was wrong: the
 * discovery believed a blackbox target had no scrape state of its own and could be told apart
 * that way. It has one -- Prometheus relabels a blackbox scrape so `up` carries the probed URL as
 * its `instance` -- so the panel offered `https://.../version` as a machine and somebody declared
 * it. The test that does work is the scheme: a machine is named by an address on a network,
 * `node-exporter:9100`, and never by a URL.
 */
export function couldNameMachine(label: string): boolean {
  return label.trim().length > 0 && !label.includes("://");
}

/**
 * What the collector sees, set against what somebody declared.
 *
 * This is the `matching` rung turned into a list. The rung answers whether anything matched and
 * this answers which, and both live here so that the two can never come to different conclusions
 * about the same pair of strings: the equality is character for character, exactly as a reading
 * is joined to a machine, because a label that is nearly right matches nothing and reads on the
 * screen as "no readings" -- indistinguishable from a machine that died.
 *
 * It is keyed on what was seen and not on what was declared. A machine nobody has a reading for
 * is a question for the inventory; this list answers the other one, which is what a collector is
 * looking at that nobody has claimed yet.
 *
 * Specification: `docs/specifications/connector-onboarding.md`, "C3 -- El descobriment".
 */
export function discoverInstances(facts: {
  seenInstances: readonly string[];
  declaredMachines: readonly DeclaredMachine[];
}): readonly DiscoveredInstance[] {
  // One entry per name a machine answers to, its `hostname` and its claimed labels alike -- the
  // question here is only whose a label is. No pair to choose between: a label belongs to one
  // machine and cannot be another's `hostname`, which the schema and the repository enforce
  // between them.
  const declared = new Map(facts.declaredMachines.map((machine) => [machine.hostname, machine]));

  return distinct(facts.seenInstances).map((label) => {
    const machine = declared.get(label);
    return { label, declaredAs: machine ? { hostId: machine.hostId, name: machine.name } : null };
  });
}

/**
 * The record prefixes that can become a declared service, and what each one usually is.
 *
 * `host:` is a machine, which is the C3's question, and `workflow:` is not infrastructure at all.
 * Offering either here would put something on the screen the declaring dialog cannot store.
 */
const serviceKindForPrefix: Readonly<Record<string, ServiceKind>> = {
  container: "container",
  probe: "http",
  backup: "backup"
};

/**
 * The same prefixes, for whoever has to ask the store for them.
 *
 * Derived rather than written twice: a query that looked for one set while the proposal read
 * another would drop a service silently, and silently is the only way this list can be wrong.
 */
export const discoverableServicePrefixes: readonly string[] = Object.keys(serviceKindForPrefix);

/** What `infra_services.name` accepts, so a proposal is never one the table would refuse. */
const nameLimits = { min: 3, max: 120 } as const;

/** One thing a collector has stored, reduced to what a proposal needs. */
export type DiscoverableRecord = {
  externalId: string;
  /**
   * The label of whoever saw it, or null.
   *
   * Context for a person until a machine claims that label, and a join key once one does: see
   * `servicesSeenOnHost`. What it is never is an inferred correspondence -- a container seen on
   * `cadvisor:8080` belongs to a machine because somebody said that machine is also that label,
   * not because the two happen to run on the same computer.
   */
  seenOn: string | null;
};

export type DiscoveredService = {
  /** The whole `externalId`, prefix included: it is what the matching compares. */
  matchKey: string;
  kind: ServiceKind;
  /** A proposal, meant to be edited. The key is not. */
  name: string;
  seenOn: string | null;
  declared: boolean;
};

/**
 * The name to put in front of somebody, given the key a reading arrived under.
 *
 * The bare identifier is what a person recognises -- `container:n8n` is "n8n" to everybody who
 * runs it -- but the column takes between 3 and 120 characters, and a proposal that cannot be
 * saved is worse than a clumsy one. So a name that would come out too short falls back to the
 * whole key, which is always long enough because it carries a prefix and a colon.
 */
function proposedName(matchKey: string, identifier: string): string {
  if (identifier.length < nameLimits.min) return matchKey.slice(0, nameLimits.max);
  return identifier.slice(0, nameLimits.max);
}

/**
 * What the collector has seen that could be declared, set against what already has been.
 *
 * The sibling of `discoverInstances`, one level down, and deliberately the same shape: it is
 * keyed on what was seen, it compares character for character, and it decides nothing. A service
 * nobody claimed is noise until a person claims it -- decision 1 of the specification -- so this
 * proposes and the screen lets somebody tick.
 *
 * What it does not do is guess which machine a container belongs to. A container record carries
 * the label of the cAdvisor that saw it, and a machine is declared by its `node_exporter` label;
 * nothing in the data joins the two. `seenOn` carries that label through so a person with two
 * machines can tell them apart, and every service the instance sees is offered. Filtering on an
 * invented correspondence would hide real services without saying why, and a hidden service costs
 * more than a spare one.
 *
 * Specification: `docs/specifications/connector-onboarding.md`, "C4 -- El selector de serveis".
 */
export function discoverServices(facts: {
  seenRecords: readonly DiscoverableRecord[];
  declaredMatchKeys: readonly string[];
}): readonly DiscoveredService[] {
  const declared = new Set(facts.declaredMatchKeys);

  // First seen wins, so a duplicate key cannot make the same service appear twice with two
  // different labels behind it.
  const unique = new Map<string, DiscoverableRecord>();
  for (const record of facts.seenRecords) {
    const colon = record.externalId.indexOf(":");
    if (colon === -1) continue;
    if (serviceKindForPrefix[record.externalId.slice(0, colon)] === undefined) continue;
    if (!unique.has(record.externalId)) unique.set(record.externalId, record);
  }

  return [...unique.values()]
    .sort((left, right) => (left.externalId < right.externalId ? -1 : left.externalId > right.externalId ? 1 : 0))
    .map((record) => {
      const colon = record.externalId.indexOf(":");
      return {
        matchKey: record.externalId,
        kind: serviceKindForPrefix[record.externalId.slice(0, colon)]!,
        name: proposedName(record.externalId, record.externalId.slice(colon + 1)),
        seenOn: record.seenOn,
        declared: declared.has(record.externalId)
      };
    });
}

/**
 * What the collectors have seen on one machine, whether or not anybody declared it.
 *
 * The join is the label and nothing else. A Prometheus aggregates by `instance`, which is the
 * scrape target that reported a figure and not the computer it came from, so one ordinary VPS is
 * several of them: the machine gets declared with `node-exporter:9100` and its containers arrive
 * with `cadvisor:8080`. `labels` is what the machine has said it also answers to, and a reading
 * belongs to it when the label it was seen on is one of those. Nothing is inferred: two exporters
 * that happen to run on the same computer say nothing to us about being the same computer.
 *
 * Only what carries a label can be attributed, and that is containers. It is not a gap in this
 * function but what the other kinds are: a probe of an address is about the address, and a backup
 * is about a job -- for neither of them is "which machine" a property of the fact observed. Those
 * reach a machine by being declared services of it, which is exactly what declaring says.
 *
 * `discoverServices` does the naming and the kinds, so a thing shown here and the same thing shown
 * in the collector's own panel cannot end up with two different names.
 *
 * Specification: `docs/specifications/connector-onboarding.md`, increment C8.
 */
export function servicesSeenOnHost(facts: {
  /** Every label the machine answers to, its `hostname` included. */
  labels: readonly string[];
  records: readonly DiscoverableRecord[];
  declaredMatchKeys: readonly string[];
}): readonly DiscoveredService[] {
  const mine = new Set(facts.labels);
  return discoverServices({
    seenRecords: facts.records.filter((record) => record.seenOn !== null && mine.has(record.seenOn)),
    declaredMatchKeys: facts.declaredMatchKeys
  });
}

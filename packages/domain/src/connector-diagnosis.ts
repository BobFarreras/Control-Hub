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

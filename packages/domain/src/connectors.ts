/**
 * The rules a connector runtime needs and that nothing outside this file should re-decide:
 * what a connector's health is, whether a failed call is worth trying again, when a failing
 * destination stops being called at all, and what may reach a log.
 *
 * Nothing here does I/O or reads a clock. The runtime that does both lives in `apps/worker`,
 * and the API asks the same questions when it renders an integration's state — keeping the
 * answers here is what makes them identical in both processes and testable without a network.
 *
 * Specification: `docs/specifications/connectors.md`.
 */

export const connectorHealthStatuses = ["unknown", "healthy", "degraded", "failing", "disabled"] as const;
export type ConnectorHealth = (typeof connectorHealthStatuses)[number];

export const connectorFailureKinds = [
  "timeout",
  "connection_reset",
  "rate_limited",
  "server_error",
  "unauthorized",
  "forbidden",
  "not_found",
  "invalid_config",
  "invalid_response",
  "response_too_large",
  "blocked_destination"
] as const;
export type ConnectorFailureKind = (typeof connectorFailureKinds)[number];

/**
 * Every code a failed run may store, and the whole of it.
 *
 * A run that fails writes a code, and a screen turns that code into a sentence in the reader's
 * language. Three places produce one — the egress guard when it refuses or gives up on an
 * address, the runtime when the run cannot even be attempted, and a connector reporting about the
 * provider, which contributes the kinds of failure above uppercased. Nothing that reads them can
 * see all three, so the agreement lives here.

 * Being a closed list is the point. A code invented at a throw site is a code with no sentence,
 * and the failure is silent: the screen falls back to "the operation could not be completed",
 * which is what an operator was told when the real answer was that the address was not on the
 * allowlist — a minute's work, had anybody said so. With the list here, `apps/worker` cannot
 * throw a code that is not a member, and `packages/i18n` is asked in a test to have words for
 * every member in every language.
 *
 * The provider's own words are never among them. What comes back from a far end is
 * attacker-influenced text, and it would end up in a log, in a ticket and in a translation key.
 */
export const connectorErrorCodes = [
  // What a connector reported about the provider: the kinds above, uppercased.
  "TIMEOUT",
  "CONNECTION_RESET",
  "RATE_LIMITED",
  "SERVER_ERROR",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "INVALID_CONFIG",
  "INVALID_RESPONSE",
  "RESPONSE_TOO_LARGE",
  "BLOCKED_DESTINATION",
  // What the egress guard refused, before anything left the process.
  "SCHEME_NOT_ALLOWED",
  "URL_NOT_PARSEABLE",
  "URL_HAS_CREDENTIALS",
  "DESTINATION_NOT_ALLOWLISTED",
  "DESTINATION_OUTSIDE_BASE_URL",
  "NO_BASE_URL_CONFIGURED",
  "ADDRESS_NOT_ROUTABLE",
  "DNS_RESOLUTION_FAILED",
  // What the egress guard gave up on, once the call was under way.
  "CONNECT_TIMEOUT",
  "HEADERS_TIMEOUT",
  "TOTAL_TIMEOUT",
  "BUDGET_EXHAUSTED",
  "CONNECTION_FAILED",
  "RESPONSE_FAILED",
  "TOO_MANY_REDIRECTS",
  // What the runtime found missing before it could ask the connector to do anything.
  "CREDENTIAL_MISSING",
  "OPERATION_NOT_DECLARED"
] as const;
export type ConnectorErrorCode = (typeof connectorErrorCodes)[number];

/**
 * The code for a kind of failure. Uppercasing, and a test that the result is in the vocabulary.
 *
 * The assertion is what `toUpperCase` costs: it is typed as returning `string`, so without it the
 * call site would widen and a code with no sentence would stop being a compile error.
 */
export function failureCode(kind: ConnectorFailureKind): ConnectorErrorCode {
  return kind.toUpperCase() as ConnectorErrorCode;
}

const transientKinds = new Set<ConnectorFailureKind>(["timeout", "connection_reset", "rate_limited", "server_error"]);

/**
 * Whether a failure could plausibly succeed if we asked again.
 *
 * `blocked_destination` is deliberately permanent. The egress guard refused the address, and
 * asking again neither changes the answer nor looks, from the far end, like anything other than
 * somebody probing the network. `response_too_large` is permanent for the same reason: the
 * response will be exactly as large next time.
 */
export function isTransientFailure(kind: ConnectorFailureKind): boolean {
  return transientKinds.has(kind);
}

export type BackoffPolicy = {
  /** The delay ceiling for the first retry, doubled on every further attempt. */
  baseMs: number;
  /** The ceiling the doubling never passes. */
  maxMs: number;
  /** How many retries the budget allows before a run is dead-lettered. */
  maxAttempts: number;
};

export const defaultBackoff: BackoffPolicy = { baseMs: 1_000, maxMs: 60_000, maxAttempts: 5 };

function assertBackoff(policy: BackoffPolicy) {
  const sane =
    Number.isSafeInteger(policy.baseMs) &&
    policy.baseMs >= 1 &&
    Number.isSafeInteger(policy.maxMs) &&
    policy.maxMs >= policy.baseMs &&
    Number.isSafeInteger(policy.maxAttempts) &&
    policy.maxAttempts >= 0;
  if (!sane) throw new Error("INVALID_BACKOFF");
}

/**
 * How long to wait before retry `attempt`, or null once the budget is spent and the run is dead.
 *
 * Full jitter, not a fixed delay with a little noise added: the wait is drawn from the whole
 * window between zero and the ceiling. Ten workers that failed against the same provider in the
 * same second have to come back spread out, and a fixed delay brings them back as a pack that
 * knocks the provider over again.
 *
 * `random` is a parameter so the choice is observable in a test. Nothing else about this
 * function is allowed to be non-deterministic.
 */
export function backoffDelayMs(
  policy: BackoffPolicy,
  attempt: number,
  random: () => number = Math.random
): number | null {
  if (!Number.isSafeInteger(attempt) || attempt < 1) throw new Error("INVALID_ATTEMPT");
  assertBackoff(policy);
  if (attempt > policy.maxAttempts) return null;
  const ceiling = Math.min(policy.maxMs, policy.baseMs * 2 ** (attempt - 1));
  return Math.floor(random() * ceiling);
}

export const circuitStates = ["closed", "open", "half_open"] as const;
export type CircuitState = (typeof circuitStates)[number];

export type CircuitPolicy = {
  /** Consecutive failures that open the circuit. */
  failureThreshold: number;
  /** How long it stays open before one call is allowed through to probe. */
  openMs: number;
  /** Consecutive successful probes that close it again. */
  successThreshold: number;
};

export const defaultCircuitPolicy: CircuitPolicy = {
  failureThreshold: 5,
  openMs: 30_000,
  successThreshold: 2
};

export type Circuit = {
  state: CircuitState;
  /** Consecutive failures. Reset by any success the breaker allowed. */
  failures: number;
  /** Consecutive successful probes since the circuit started half-open. */
  successes: number;
  openedAt: Date | null;
};

export function closedCircuit(): Circuit {
  return { state: "closed", failures: 0, successes: 0, openedAt: null };
}

function assertCircuitPolicy(policy: CircuitPolicy) {
  const sane =
    Number.isSafeInteger(policy.failureThreshold) &&
    policy.failureThreshold >= 1 &&
    Number.isSafeInteger(policy.successThreshold) &&
    policy.successThreshold >= 1 &&
    Number.isSafeInteger(policy.openMs) &&
    policy.openMs >= 1;
  if (!sane) throw new Error("INVALID_CIRCUIT_POLICY");
}

/**
 * Moves an open circuit to half-open once its window has elapsed.
 *
 * Separate from `circuitAllows` on purpose: the clock belongs to the caller, and a predicate
 * that silently rewrote the state it was handed would make the transition impossible to record.
 * The caller advances, then asks, then stores whatever it got.
 */
export function advanceCircuit(circuit: Circuit, policy: CircuitPolicy, now: Date): Circuit {
  assertCircuitPolicy(policy);
  if (circuit.state !== "open" || !circuit.openedAt) return circuit;
  if (now.getTime() - circuit.openedAt.getTime() < policy.openMs) return circuit;
  return { state: "half_open", failures: circuit.failures, successes: 0, openedAt: circuit.openedAt };
}

/** Whether a call may go out. Half-open allows it: that call is the probe. */
export function circuitAllows(circuit: Circuit): boolean {
  return circuit.state !== "open";
}

/**
 * A success while open changes nothing.
 *
 * It means a caller went out without asking the breaker, and treating it as evidence would let
 * one stray call reopen the flood the breaker exists to hold back.
 */
export function recordCircuitSuccess(circuit: Circuit, policy: CircuitPolicy): Circuit {
  assertCircuitPolicy(policy);
  if (circuit.state === "open") return circuit;
  if (circuit.state === "closed") return closedCircuit();

  const successes = circuit.successes + 1;
  if (successes >= policy.successThreshold) return closedCircuit();
  return { state: "half_open", failures: 0, successes, openedAt: circuit.openedAt };
}

/**
 * A failed probe reopens immediately rather than spending the threshold again: the probe was
 * the whole question, and it was answered.
 */
export function recordCircuitFailure(circuit: Circuit, policy: CircuitPolicy, now: Date): Circuit {
  assertCircuitPolicy(policy);
  if (circuit.state === "open") return circuit;
  if (circuit.state === "half_open") {
    return { state: "open", failures: circuit.failures + 1, successes: 0, openedAt: now };
  }

  const failures = circuit.failures + 1;
  if (failures >= policy.failureThreshold) return { state: "open", failures, successes: 0, openedAt: now };
  return { state: "closed", failures, successes: 0, openedAt: null };
}

/** How old a health check may be before it stops counting as evidence of anything. */
export const healthCheckStaleAfterMs = 30 * 60 * 1_000;

export type ConnectorHealthSignal = {
  enabled: boolean;
  circuit: CircuitState;
  /** The last health check, if one has ever run. */
  lastCheck: { ok: boolean; at: Date } | null;
  /** Recent runs. The caller chooses the window; this only reads the outcomes. */
  recentRuns: readonly { ok: boolean }[];
  now: Date;
  staleAfterMs?: number;
};

/**
 * What to tell somebody looking at the integrations screen.
 *
 * Health checks and real runs are weighed as the same kind of thing — evidence — rather than
 * ranked, because a connector whose check passes while its work fails is exactly the case
 * somebody has to look at, and ranking the check above the work would report it as healthy.
 *
 * Absence of evidence is `unknown`, never `healthy`. A connector nobody has exercised is a
 * connector nobody knows about, and saying otherwise is how a broken integration stays green
 * until a customer notices.
 */
export function connectorHealth(signal: ConnectorHealthSignal): ConnectorHealth {
  if (!signal.enabled) return "disabled";
  if (signal.circuit === "open") return "failing";

  const staleAfter = signal.staleAfterMs ?? healthCheckStaleAfterMs;
  const evidence: boolean[] = [];
  if (signal.lastCheck && signal.now.getTime() - signal.lastCheck.at.getTime() <= staleAfter) {
    evidence.push(signal.lastCheck.ok);
  }
  for (const run of signal.recentRuns) evidence.push(run.ok);

  if (evidence.length === 0) return "unknown";
  if (evidence.every((ok) => !ok)) return "failing";
  return evidence.every((ok) => ok) ? "healthy" : "degraded";
}

/**
 * The censor `packages/observability` already uses, so a redacted value looks the same wherever
 * it surfaces.
 */
const CENSOR = "[REDACTED]";

/**
 * Below this length a value is not searched for in a message.
 *
 * A four-character secret would censor ordinary words everywhere they appeared and leave the log
 * unreadable, which costs more than it protects — and a secret that short is a configuration
 * defect to fix, not a value to hide.
 */
const shortestRedactableSecret = 8;

const authorizationPattern = /\b(bearer|basic)\s+\S+/gi;
const urlCredentialPattern = /:\/\/[^\s@/]+:[^\s@/]+@/g;

/**
 * Removes known secrets and anything shaped like a credential from a message.
 *
 * This complements the logger's redaction rather than repeating it: `packages/observability`
 * censors by key path, which cannot reach a token sitting inside a sentence a provider sent
 * back to us. That sentence is the most common way a credential ends up in a log.
 *
 * Known values are removed by splitting rather than by regular expression, so a secret full of
 * `.` or `+` needs no escaping and cannot be turned into a pattern that matches the whole line.
 */
export function redact(message: string, secrets: readonly string[] = []): string {
  let result = message;
  for (const secret of secrets) {
    if (secret.length < shortestRedactableSecret) continue;
    result = result.split(secret).join(CENSOR);
  }
  return result.replace(authorizationPattern, `$1 ${CENSOR}`).replace(urlCredentialPattern, `://${CENSOR}@`);
}

/**
 * A URL reduced to what helps diagnosis: scheme, host, port and path.
 *
 * The query string goes because providers routinely accept tokens there, and the whole point of
 * a log line is that it can be read by somebody who is not allowed to see the credential.
 *
 * Anything unparseable is censored rather than echoed. A string that is not a URL, in a field
 * that should hold one, is attacker-controlled text, and a log is a place people paste from.
 */
export function safeUrlForLog(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return CENSOR;
  }
  const port = url.port ? `:${url.port}` : "";
  return `${url.protocol}//${url.hostname}${port}${url.pathname}`;
}

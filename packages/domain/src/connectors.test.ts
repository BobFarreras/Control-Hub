import { describe, expect, it } from "vitest";
import {
  advanceCircuit,
  backoffDelayMs,
  circuitAllows,
  closedCircuit,
  connectorHealth,
  defaultBackoff,
  defaultCircuitPolicy,
  isTransientFailure,
  recordCircuitFailure,
  recordCircuitSuccess,
  redact,
  safeUrlForLog,
  type Circuit,
  type ConnectorHealthSignal
} from "./connectors.js";

const now = new Date("2026-08-11T10:00:00.000Z");
const minutesAgo = (minutes: number) => new Date(now.getTime() - minutes * 60_000);

const signal = (overrides: Partial<ConnectorHealthSignal> = {}): ConnectorHealthSignal => ({
  enabled: true,
  circuit: "closed",
  lastCheck: null,
  recentRuns: [],
  now,
  ...overrides
});

describe("connector health", () => {
  it("reports a disabled instance as disabled whatever the evidence says", () => {
    const failing = signal({ enabled: false, circuit: "open", recentRuns: [{ ok: false }] });
    expect(connectorHealth(failing)).toBe("disabled");

    const working = signal({ enabled: false, lastCheck: { ok: true, at: now } });
    expect(connectorHealth(working)).toBe("disabled");
  });

  it("reports an open circuit as failing without weighing anything else", () => {
    const circuitOpen = signal({ circuit: "open", lastCheck: { ok: true, at: now } });
    expect(connectorHealth(circuitOpen)).toBe("failing");
  });

  it("says unknown rather than healthy when nothing has been observed", () => {
    expect(connectorHealth(signal())).toBe("unknown");
  });

  it("stops counting a health check once it is stale", () => {
    const fresh = signal({ lastCheck: { ok: true, at: minutesAgo(5) } });
    expect(connectorHealth(fresh)).toBe("healthy");

    const stale = signal({ lastCheck: { ok: true, at: minutesAgo(45) } });
    expect(connectorHealth(stale)).toBe("unknown");
  });

  it("trusts successful runs even when no check has ever run", () => {
    const worked = signal({ recentRuns: [{ ok: true }, { ok: true }] });
    expect(connectorHealth(worked)).toBe("healthy");
  });

  it("degrades on mixed evidence and fails only when everything failed", () => {
    const mixed = signal({ lastCheck: { ok: true, at: now }, recentRuns: [{ ok: false }, { ok: true }] });
    expect(connectorHealth(mixed)).toBe("degraded");

    const allBad = signal({ lastCheck: { ok: false, at: now }, recentRuns: [{ ok: false }] });
    expect(connectorHealth(allBad)).toBe("failing");

    // A passing check next to failing work is still a connector somebody has to look at.
    const checkPassesWorkDoesNot = signal({ lastCheck: { ok: true, at: now }, recentRuns: [{ ok: false }] });
    expect(connectorHealth(checkPassesWorkDoesNot)).toBe("degraded");
  });
});

describe("transient failures", () => {
  it("retries what can plausibly succeed next time", () => {
    expect(isTransientFailure("timeout")).toBe(true);
    expect(isTransientFailure("connection_reset")).toBe(true);
    expect(isTransientFailure("rate_limited")).toBe(true);
    expect(isTransientFailure("server_error")).toBe(true);
  });

  it("never retries a refused destination or an oversized response", () => {
    expect(isTransientFailure("blocked_destination")).toBe(false);
    expect(isTransientFailure("response_too_large")).toBe(false);
  });

  it("never retries a rejection the provider meant", () => {
    expect(isTransientFailure("unauthorized")).toBe(false);
    expect(isTransientFailure("forbidden")).toBe(false);
    expect(isTransientFailure("not_found")).toBe(false);
    expect(isTransientFailure("invalid_config")).toBe(false);
  });
});

describe("backoff", () => {
  const policy = { baseMs: 1_000, maxMs: 8_000, maxAttempts: 6 };
  const top = () => 1;
  const bottom = () => 0;

  it("doubles the window on each attempt", () => {
    expect(backoffDelayMs(policy, 1, top)).toBe(1_000);
    expect(backoffDelayMs(policy, 2, top)).toBe(2_000);
    expect(backoffDelayMs(policy, 3, top)).toBe(4_000);
  });

  it("never lets the window pass the cap", () => {
    expect(backoffDelayMs(policy, 4, top)).toBe(8_000);
    expect(backoffDelayMs(policy, 5, top)).toBe(8_000);
    expect(backoffDelayMs(policy, 6, top)).toBe(8_000);
  });

  it("draws from the whole window, so a pack of workers comes back spread out", () => {
    expect(backoffDelayMs(policy, 3, bottom)).toBe(0);
    expect(backoffDelayMs(policy, 3, () => 0.5)).toBe(2_000);
  });

  it("returns null once the attempt budget is spent", () => {
    expect(backoffDelayMs(policy, 7, top)).toBeNull();
    expect(backoffDelayMs({ ...policy, maxAttempts: 0 }, 1, top)).toBeNull();
  });

  it("refuses an attempt number that cannot mean anything", () => {
    expect(() => backoffDelayMs(policy, 0, top)).toThrow("INVALID_ATTEMPT");
    expect(() => backoffDelayMs(policy, -1, top)).toThrow("INVALID_ATTEMPT");
    expect(() => backoffDelayMs(policy, 1.5, top)).toThrow("INVALID_ATTEMPT");
  });

  it("refuses a policy that would never let anything through", () => {
    expect(() => backoffDelayMs({ baseMs: 0, maxMs: 10, maxAttempts: 1 }, 1, top)).toThrow("INVALID_BACKOFF");
    expect(() => backoffDelayMs({ baseMs: 100, maxMs: 10, maxAttempts: 1 }, 1, top)).toThrow("INVALID_BACKOFF");
  });

  it("ships a default that is not silently unbounded", () => {
    expect(backoffDelayMs(defaultBackoff, defaultBackoff.maxAttempts + 1, top)).toBeNull();
  });
});

describe("circuit breaker", () => {
  const policy = { failureThreshold: 3, openMs: 30_000, successThreshold: 2 };

  it("stays closed and keeps calling while failures are occasional", () => {
    let circuit = closedCircuit();
    circuit = recordCircuitFailure(circuit, policy, now);
    circuit = recordCircuitFailure(circuit, policy, now);
    expect(circuit.state).toBe("closed");
    expect(circuitAllows(circuit)).toBe(true);
  });

  it("forgets earlier failures as soon as one call succeeds", () => {
    let circuit = closedCircuit();
    circuit = recordCircuitFailure(circuit, policy, now);
    circuit = recordCircuitFailure(circuit, policy, now);
    circuit = recordCircuitSuccess(circuit, policy);
    circuit = recordCircuitFailure(circuit, policy, now);
    expect(circuit.state).toBe("closed");
  });

  it("opens on consecutive failures and refuses further calls", () => {
    let circuit = closedCircuit();
    for (let attempt = 0; attempt < policy.failureThreshold; attempt++) {
      circuit = recordCircuitFailure(circuit, policy, now);
    }
    expect(circuit.state).toBe("open");
    expect(circuitAllows(circuit)).toBe(false);
    expect(circuit.openedAt).toEqual(now);
  });

  it("keeps refusing until the window has actually elapsed", () => {
    let circuit = closedCircuit();
    for (let attempt = 0; attempt < policy.failureThreshold; attempt++) {
      circuit = recordCircuitFailure(circuit, policy, now);
    }

    const tooSoon = advanceCircuit(circuit, policy, new Date(now.getTime() + policy.openMs - 1));
    expect(tooSoon.state).toBe("open");
    expect(circuitAllows(tooSoon)).toBe(false);

    const probing = advanceCircuit(circuit, policy, new Date(now.getTime() + policy.openMs));
    expect(probing.state).toBe("half_open");
    expect(circuitAllows(probing)).toBe(true);
  });

  it("reopens on a failed probe instead of waiting for the threshold again", () => {
    const probing = { state: "half_open" as const, failures: 3, successes: 0, openedAt: now };
    const later = new Date(now.getTime() + 60_000);
    const reopened = recordCircuitFailure(probing, policy, later);
    expect(reopened.state).toBe("open");
    expect(reopened.openedAt).toEqual(later);
  });

  it("closes only after the probe has succeeded enough times", () => {
    const probing: Circuit = { state: "half_open", failures: 3, successes: 0, openedAt: now };
    const first = recordCircuitSuccess(probing, policy);
    expect(first.state).toBe("half_open");

    const second = recordCircuitSuccess(first, policy);
    expect(second.state).toBe("closed");
    expect(second.failures).toBe(0);
    expect(second.openedAt).toBeNull();
  });

  it("does not close on a success the breaker never allowed", () => {
    const open = { state: "open" as const, failures: 3, successes: 0, openedAt: now };
    expect(recordCircuitSuccess(open, policy).state).toBe("open");
  });

  it("refuses a policy that would open on nothing", () => {
    expect(() => recordCircuitFailure(closedCircuit(), { ...policy, failureThreshold: 0 }, now)).toThrow(
      "INVALID_CIRCUIT_POLICY"
    );
    expect(() => recordCircuitFailure(closedCircuit(), { ...policy, openMs: 0 }, now)).toThrow(
      "INVALID_CIRCUIT_POLICY"
    );
  });

  it("ships a usable default", () => {
    expect(defaultCircuitPolicy.failureThreshold).toBeGreaterThan(0);
    expect(defaultCircuitPolicy.successThreshold).toBeGreaterThan(0);
    expect(defaultCircuitPolicy.openMs).toBeGreaterThan(0);
  });
});

describe("redaction", () => {
  it("censors a secret a provider echoed back at us", () => {
    const message = "invalid api key: sk-live-9f2c8ab41d";
    expect(redact(message, ["sk-live-9f2c8ab41d"])).toBe("invalid api key: [REDACTED]");
  });

  it("censors every occurrence, not just the first", () => {
    const secret = "shhh-0123456789";
    expect(redact(`${secret} and again ${secret}`, [secret])).toBe("[REDACTED] and again [REDACTED]");
  });

  it("leaves a secret too short to be one alone, so logs stay readable", () => {
    expect(redact("the id is abcd and the row is fine", ["abcd"])).toBe("the id is abcd and the row is fine");
  });

  it("censors authorization values nobody remembered to strip", () => {
    expect(redact("sent with Bearer eyJhbGciOiJIUzI1NiJ9.abc")).toBe("sent with Bearer [REDACTED]");
    expect(redact("Basic dXNlcjpwYXNz was refused")).toBe("Basic [REDACTED] was refused");
  });

  it("censors credentials somebody put in a url", () => {
    expect(redact("calling https://alice:hunter2@example.com/hook failed")).toBe(
      "calling https://[REDACTED]@example.com/hook failed"
    );
  });

  it("survives a message with no secrets in it", () => {
    expect(redact("connection reset by peer")).toBe("connection reset by peer");
  });
});

describe("urls in logs", () => {
  it("keeps what identifies the call and drops what leaks", () => {
    expect(safeUrlForLog("https://api.example.com/v1/workflows?token=abc123#frag")).toBe(
      "https://api.example.com/v1/workflows"
    );
  });

  it("drops credentials embedded in the url", () => {
    expect(safeUrlForLog("https://alice:hunter2@api.example.com/hook")).toBe("https://api.example.com/hook");
  });

  it("keeps a non-default port, because that is diagnosis and not a secret", () => {
    expect(safeUrlForLog("http://127.0.0.1:5678/rest/workflows")).toBe("http://127.0.0.1:5678/rest/workflows");
  });

  it("censors anything it cannot parse rather than echoing it into the log", () => {
    expect(safeUrlForLog("not a url at all")).toBe("[REDACTED]");
    expect(safeUrlForLog("")).toBe("[REDACTED]");
  });
});

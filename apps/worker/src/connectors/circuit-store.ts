import {
  advanceCircuit,
  circuitAllows,
  closedCircuit,
  defaultCircuitPolicy,
  recordCircuitFailure,
  recordCircuitSuccess,
  type Circuit,
  type CircuitPolicy
} from "@control-hub/domain";

/**
 * Where the circuit breaker's state lives between jobs.
 *
 * The state machine itself is a pure function in the domain and is not repeated here. What this
 * adds is the one thing a pure function cannot have: memory shared by every worker replica. Two
 * workers that each kept their own count would each need the full threshold before opening, so a
 * provider that is down would be hammered twice as hard as configured — and three times with
 * three replicas.
 *
 * Valkey and not PostgreSQL because the state is ephemeral and worthless after an outage: losing
 * it costs one extra call to a provider, while writing it to the database would cost a row per
 * failed call on exactly the day the database is already busy.
 */

export type CircuitClient = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: "PX", ttlMs: number): Promise<unknown>;
};

/**
 * Long enough to survive a quiet gap between jobs, short enough that a connector fixed weeks ago
 * is not still remembered as failing. A circuit nobody has exercised since is not evidence.
 */
const stateTtlMs = 60 * 60 * 1_000;

type StoredCircuit = { state: Circuit["state"]; failures: number; successes: number; openedAt: string | null };

function keyFor(tenantId: string, instanceId: string, operation: string): string {
  return `connector:circuit:${tenantId}:${instanceId}:${operation}`;
}

function decode(raw: string | null): Circuit {
  if (!raw) return closedCircuit();
  try {
    const stored = JSON.parse(raw) as StoredCircuit;
    return {
      state: stored.state,
      failures: stored.failures,
      successes: stored.successes,
      openedAt: stored.openedAt ? new Date(stored.openedAt) : null
    };
  } catch {
    // A value we cannot read is a value we do not trust. Starting closed costs one call to a
    // provider that may be down; refusing to work because a cache entry is malformed costs the
    // whole connector.
    return closedCircuit();
  }
}

function encode(circuit: Circuit): string {
  return JSON.stringify({
    state: circuit.state,
    failures: circuit.failures,
    successes: circuit.successes,
    openedAt: circuit.openedAt?.toISOString() ?? null
  } satisfies StoredCircuit);
}

export type CircuitStoreOptions = {
  client: CircuitClient;
  policy?: CircuitPolicy;
  /** Injected so a test can move time without waiting for it. */
  now?: () => Date;
};

export class CircuitStore {
  private readonly policy: CircuitPolicy;
  private readonly now: () => Date;

  constructor(private readonly options: CircuitStoreOptions) {
    this.policy = options.policy ?? defaultCircuitPolicy;
    this.now = options.now ?? (() => new Date());
  }

  /**
   * Whether a call may go out, having first let an open circuit age into half-open.
   *
   * The advance is written back rather than kept in memory, so the one probe a half-open circuit
   * allows is one probe across every replica and not one each.
   */
  async allows(tenantId: string, instanceId: string, operation: string): Promise<boolean> {
    const key = keyFor(tenantId, instanceId, operation);
    const current = decode(await this.read(key));
    const advanced = advanceCircuit(current, this.policy, this.now());
    if (advanced !== current) await this.write(key, advanced);
    return circuitAllows(advanced);
  }

  async recordSuccess(tenantId: string, instanceId: string, operation: string): Promise<Circuit> {
    return this.update(tenantId, instanceId, operation, (circuit) => recordCircuitSuccess(circuit, this.policy));
  }

  async recordFailure(tenantId: string, instanceId: string, operation: string): Promise<Circuit> {
    return this.update(tenantId, instanceId, operation, (circuit) =>
      recordCircuitFailure(circuit, this.policy, this.now())
    );
  }

  async state(tenantId: string, instanceId: string, operation: string): Promise<Circuit> {
    return advanceCircuit(decode(await this.read(keyFor(tenantId, instanceId, operation))), this.policy, this.now());
  }

  private async update(
    tenantId: string,
    instanceId: string,
    operation: string,
    step: (circuit: Circuit) => Circuit
  ): Promise<Circuit> {
    const key = keyFor(tenantId, instanceId, operation);
    const current = advanceCircuit(decode(await this.read(key)), this.policy, this.now());
    const next = step(current);
    await this.write(key, next);
    return next;
  }

  /**
   * Valkey being unreachable must not stop the work.
   *
   * The breaker exists to protect a provider from us, not to gate our own operation. Reading it
   * as closed when the store is down means we call a failing provider a few more times than we
   * would have; refusing to run because a cache is down would turn one dependency's outage into
   * every connector's outage.
   */
  private async read(key: string): Promise<string | null> {
    try {
      return await this.options.client.get(key);
    } catch {
      return null;
    }
  }

  private async write(key: string, circuit: Circuit): Promise<void> {
    try {
      await this.options.client.set(key, encode(circuit), "PX", stateTtlMs);
    } catch {
      // Same reasoning as `read`. The next job starts from whatever the store does have.
    }
  }
}

import { beforeEach, describe, expect, it } from "vitest";
import { CircuitStore, type CircuitClient } from "./circuit-store.js";

class FakeValkey implements CircuitClient {
  readonly entries = new Map<string, string>();
  failing = false;

  get(key: string): Promise<string | null> {
    if (this.failing) return Promise.reject(new Error("ECONNREFUSED"));
    return Promise.resolve(this.entries.get(key) ?? null);
  }

  set(key: string, value: string): Promise<unknown> {
    if (this.failing) return Promise.reject(new Error("ECONNREFUSED"));
    this.entries.set(key, value);
    return Promise.resolve("OK");
  }
}

const tenant = "tenant-a";
const instance = "instance-1";
const operation = "sync";
const policy = { failureThreshold: 3, openMs: 30_000, successThreshold: 2 };

let client: FakeValkey;
let clock: Date;
let store: CircuitStore;

beforeEach(() => {
  client = new FakeValkey();
  clock = new Date("2026-08-11T10:00:00.000Z");
  store = new CircuitStore({ client, policy, now: () => clock });
});

const fail = () => store.recordFailure(tenant, instance, operation);
const succeed = () => store.recordSuccess(tenant, instance, operation);
const allows = () => store.allows(tenant, instance, operation);

describe("a circuit nobody has exercised", () => {
  it("lets a call through and remembers nothing yet", async () => {
    expect(await allows()).toBe(true);
    expect(client.entries.size).toBe(0);
  });
});

describe("opening", () => {
  it("stays closed until the threshold is actually reached", async () => {
    await fail();
    await fail();
    expect(await allows()).toBe(true);
    await fail();
    expect(await allows()).toBe(false);
  });

  it("is shared, so two workers do not each spend the whole threshold", async () => {
    const second = new CircuitStore({ client, policy, now: () => clock });
    await fail();
    await second.recordFailure(tenant, instance, operation);
    await fail();
    expect(await second.allows(tenant, instance, operation)).toBe(false);
  });

  it("forgets the count as soon as a call succeeds", async () => {
    await fail();
    await fail();
    await succeed();
    await fail();
    await fail();
    expect(await allows()).toBe(true);
  });
});

describe("recovering", () => {
  const open = async () => {
    await fail();
    await fail();
    await fail();
  };

  it("allows one probe once the window has passed, and not before", async () => {
    await open();
    clock = new Date(clock.getTime() + 29_000);
    expect(await allows()).toBe(false);
    clock = new Date(clock.getTime() + 2_000);
    expect(await allows()).toBe(true);
    expect((await store.state(tenant, instance, operation)).state).toBe("half_open");
  });

  it("closes after enough probes succeed", async () => {
    await open();
    clock = new Date(clock.getTime() + 31_000);
    await allows();
    await succeed();
    expect((await store.state(tenant, instance, operation)).state).toBe("half_open");
    await succeed();
    expect((await store.state(tenant, instance, operation)).state).toBe("closed");
  });

  it("reopens on the first failed probe rather than spending the threshold again", async () => {
    await open();
    clock = new Date(clock.getTime() + 31_000);
    await allows();
    await fail();
    expect(await allows()).toBe(false);
  });
});

describe("separation", () => {
  it("keeps one instance's failures away from another's", async () => {
    await fail();
    await fail();
    await fail();
    expect(await store.allows(tenant, "instance-2", operation)).toBe(true);
    expect(await store.allows("tenant-b", instance, operation)).toBe(true);
    expect(await store.allows(tenant, instance, "other")).toBe(true);
  });
});

describe("when Valkey is unreachable", () => {
  it("lets the work continue rather than turning a cache outage into a connector outage", async () => {
    await fail();
    await fail();
    await fail();
    client.failing = true;
    expect(await allows()).toBe(true);
    await expect(fail()).resolves.toBeDefined();
  });

  it("does the same with a value it cannot parse", async () => {
    client.entries.set(`connector:circuit:${tenant}:${instance}:${operation}`, "not json");
    expect(await allows()).toBe(true);
  });
});

import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  apiEnvironmentSchema,
  connectorKeyRingWarning,
  parseApiEnvironment,
  workerEnvironmentSchema
} from "./index.js";

const base = {
  DATABASE_URL: "postgres://localhost/db",
  REDIS_URL: "redis://localhost:6379",
  BETTER_AUTH_SECRET: "development-only-secret-with-32-chars"
};

const oneKey = JSON.stringify({
  activeKeyId: "2026-08",
  keys: { "2026-08": Buffer.alloc(32, 1).toString("base64") }
});

describe("the connector key ring at boot", () => {
  it("is absent when nothing supplied one, and connectors are off", () => {
    const environment = parseApiEnvironment(base);
    expect(environment.connectorKeyRing).toBeNull();
    expect(connectorKeyRingWarning(environment)).toBeNull();
  });

  it("is read when supplied, whether or not the flag is on", () => {
    const environment = parseApiEnvironment({ ...base, CONNECTOR_KEY_RING: oneKey });
    expect(environment.connectorKeyRing?.activeKeyId).toBe("2026-08");
    expect(connectorKeyRingWarning(environment)).toBeNull();
  });

  it("refuses a malformed ring on the day it is deployed, flag or no flag", () => {
    expect(() => parseApiEnvironment({ ...base, CONNECTOR_KEY_RING: "{ nope" })).toThrow("KEY_RING_NOT_JSON");
    expect(() =>
      parseApiEnvironment({ ...base, CONNECTOR_KEY_RING: oneKey, CONTROL_HUB_FLAGS: "connectors" })
    ).not.toThrow();
  });

  it("still starts with connectors on and no ring, and says why", () => {
    const environment = parseApiEnvironment({ ...base, CONTROL_HUB_FLAGS: "connectors" });
    expect(environment.connectorKeyRing).toBeNull();
    expect(connectorKeyRingWarning(environment)).toContain("CONNECTOR_KEY_RING");
  });

  it("treats a ring of only whitespace as no ring rather than as a broken one", () => {
    expect(parseApiEnvironment({ ...base, CONNECTOR_KEY_RING: "   " }).connectorKeyRing).toBeNull();
  });

  it("never lets the environment print the key material it holds", () => {
    const environment = parseApiEnvironment({ ...base, CONNECTOR_KEY_RING: oneKey });
    expect(JSON.stringify(environment)).not.toContain(Buffer.alloc(32, 1).toString("base64"));
  });
});

describe("parseApiEnvironment", () => {
  it("parses a valid local environment", () => {
    expect(
      parseApiEnvironment({
        DATABASE_URL: "postgres://localhost/db",
        REDIS_URL: "redis://localhost:6379",
        BETTER_AUTH_SECRET: "development-only-secret-with-32-chars"
      }).API_PORT
    ).toBe(4000);
  });

  it("rejects a non-postgres database URL", () => {
    expect(() =>
      parseApiEnvironment({
        DATABASE_URL: "https://example.com",
        REDIS_URL: "redis://localhost:6379",
        BETTER_AUTH_SECRET: "development-only-secret-with-32-chars"
      })
    ).toThrow();
  });
});

/**
 * Every variable this package reads has to survive the task runner.
 *
 * Turbo runs tasks in strict env mode: a variable it was not told about is not passed on, and the
 * process sees it as unset. Nothing fails — the schema simply takes the absent branch — so the
 * symptom is a feature that quietly does not exist in development while the deployment that
 * injects the same variable directly works fine. That is how `CONNECTOR_KEY_RING` went missing
 * long enough for a credential form to be impossible to reach.
 *
 * The schema is read at runtime rather than listed here again, so a variable added tomorrow is
 * covered by this test the moment it is declared.
 */
describe("the variables the task runner has to carry", () => {
  it("declares in turbo.json every variable the environment schemas read", async () => {
    const turbo = JSON.parse(await readFile(new URL("../../../turbo.json", import.meta.url), "utf8")) as {
      globalEnv: string[];
    };
    const declared = new Set(turbo.globalEnv);
    const read = [...Object.keys(apiEnvironmentSchema.shape), ...Object.keys(workerEnvironmentSchema.shape)];

    expect(read.filter((name) => !declared.has(name))).toEqual([]);
  });
});

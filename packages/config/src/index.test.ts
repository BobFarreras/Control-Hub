import { describe, expect, it } from "vitest";
import { connectorKeyRingWarning, parseApiEnvironment } from "./index.js";

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

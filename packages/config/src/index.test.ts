import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  apiEnvironmentSchema,
  connectorKeyRingWarning,
  mcpIssuerWarning,
  parseApiEnvironment,
  parseWorkerEnvironment,
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

  it("exposes provider identifiers to the API but never provider secrets", () => {
    const secret = "provider-secret-value";
    const environment = parseApiEnvironment({
      ...base,
      GOOGLE_OAUTH_CLIENT_ID: "google-client",
      GOOGLE_OAUTH_CLIENT_SECRET: secret
    });
    expect(environment.oauthClientIds.google).toBe("google-client");
    expect(JSON.stringify(environment)).not.toContain(secret);
  });

  it("requires complete provider credential pairs in the worker", () => {
    expect(() => parseWorkerEnvironment({ ...base, GOOGLE_OAUTH_CLIENT_ID: "google-client" })).toThrow(
      "GOOGLE_OAUTH_CLIENT_ID"
    );
    expect(
      parseWorkerEnvironment({
        ...base,
        MICROSOFT_OAUTH_CLIENT_ID: "microsoft-client",
        MICROSOFT_OAUTH_CLIENT_SECRET: "microsoft-secret"
      }).oauthClients.microsoft?.clientId
    ).toBe("microsoft-client");
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

describe("the MCP issuer at boot", () => {
  it("is absent when nothing supplied one, and MCP is off", () => {
    const environment = parseApiEnvironment(base);
    expect(environment.MCP_ISSUER).toBeUndefined();
    expect(mcpIssuerWarning(environment)).toBeNull();
  });

  it("says so when the flag is on and nobody said what this server is called", () => {
    // Without it the server cannot mint an audience, and the alternative -- reading the Host
    // header -- is precisely the confused-deputy hole the audience exists to close. Refusing to
    // start would take the whole API down over one optional capability, so it warns and the
    // routes are not declared.
    const environment = parseApiEnvironment({ ...base, CONTROL_HUB_FLAGS: "mcp" });
    expect(mcpIssuerWarning(environment)).toContain("MCP_ISSUER");
  });

  it("refuses an issuer that is not an absolute origin", () => {
    // RFC 8414 section 2: the issuer is what the metadata document is fetched from and what a
    // client compares its token against. A path or a bare host makes both comparisons ambiguous.
    for (const value of ["hub.example.com", "https://hub.example.com/mcp", "not a url"]) {
      expect(() => parseApiEnvironment({ ...base, MCP_ISSUER: value }), value).toThrow();
    }
  });

  it("accepts an origin and keeps no trailing slash, so the audience concatenates cleanly", () => {
    // `https://hub.example.com/` plus `/mcp` is `https://hub.example.com//mcp`, which is a
    // different string from the one in every token, and string equality is the whole check.
    const environment = parseApiEnvironment({ ...base, MCP_ISSUER: "https://hub.example.com/" });
    expect(environment.MCP_ISSUER).toBe("https://hub.example.com");
    expect(mcpIssuerWarning(environment)).toBeNull();
  });
});

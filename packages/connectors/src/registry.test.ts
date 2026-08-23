import { describe, expect, it } from "vitest";
import { z } from "zod";
import { connectorContractVersion, defineConnector, type RegisteredConnector } from "./contract.js";
import { createConnectorRegistry } from "./registry.js";
import { connectorRegistry } from "./index.js";

const stub = (type: string): RegisteredConnector =>
  defineConnector({
    type,
    contractVersion: connectorContractVersion,
    configSchema: z.strictObject({}),
    configFields: [],
    credentialKinds: [],
    capabilities: { egress: null, operations: {}, ingress: false },
    health: () => Promise.resolve({ status: "ok" }),
    operations: {}
  });

describe("the registry", () => {
  it("finds a connector by type and lists what it holds", () => {
    const registry = createConnectorRegistry([stub("beta"), stub("alpha")]);
    expect(registry.types()).toEqual(["alpha", "beta"]);
    expect(registry.find("alpha")?.type).toBe("alpha");
  });

  it("answers null for a type it does not have, so a caller has to decide", () => {
    expect(createConnectorRegistry([stub("alpha")]).find("nope")).toBeNull();
  });

  it("throws for a caller that already believed the type existed", () => {
    expect(() => createConnectorRegistry([stub("alpha")]).require("nope")).toThrow("UNKNOWN_CONNECTOR_TYPE");
  });

  it("refuses two connectors claiming the same type", () => {
    expect(() => createConnectorRegistry([stub("alpha"), stub("alpha")])).toThrow("DUPLICATE_CONNECTOR_TYPE");
  });
});

describe("what this installation ships", () => {
  it("carries the reviewed built-in connectors", () => {
    expect(connectorRegistry.types()).toEqual(["anthropic", "generic-webhook", "n8n", "openai", "prometheus"]);
  });

  it("resolves it at build time, with no door to register another at runtime", () => {
    expect(Object.keys(connectorRegistry)).toEqual(["types", "find", "require"]);
  });
});

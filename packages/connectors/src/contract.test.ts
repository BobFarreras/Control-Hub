import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  ConnectorError,
  connectorContractVersion,
  defineConnector,
  failureForStatus,
  minimumCadenceSeconds,
  type ConnectorContext,
  type ConnectorDefinition,
  type HttpResponse
} from "./contract.js";

const respond = (status: number, body = ""): HttpResponse => ({ status, headers: {}, body });

const contextWith = (config: unknown, status = 200): ConnectorContext<unknown> => ({
  instanceId: "instance-1",
  config,
  http: { send: () => Promise.resolve(respond(status)) },
  secrets: { open: () => Promise.resolve("opened-just-in-time") },
  logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
  clock: { now: () => new Date("2026-08-11T10:00:00.000Z") }
});

const echoSchema = z.strictObject({ label: z.string().min(1) });

const echo = defineConnector<z.infer<typeof echoSchema>>({
  type: "test-echo",
  contractVersion: connectorContractVersion,
  configSchema: echoSchema,
  credentialKinds: [],
  capabilities: { egress: null, operations: { pull: { shape: "event" } }, ingress: false },
  health: () => Promise.resolve({ status: "ok" }),
  operations: {
    pull: (context) => Promise.resolve({ records: [{ externalId: context.config.label, data: {} }], cursor: null })
  }
});

const emptySchema = z.strictObject({});
type EmptyConfig = z.infer<typeof emptySchema>;

describe("defining a connector", () => {
  const base = {
    type: "test-broken",
    contractVersion: connectorContractVersion,
    configSchema: emptySchema,
    credentialKinds: [],
    health: () => Promise.resolve({ status: "ok" as const })
  } satisfies Omit<ConnectorDefinition<EmptyConfig>, "capabilities" | "operations">;

  it("refuses a manifest that promises an operation nobody wrote", () => {
    expect(() =>
      defineConnector({
        ...base,
        capabilities: { egress: null, operations: { pull: { shape: "event" } }, ingress: false },
        operations: {}
      })
    ).toThrow("OPERATION_NOT_IMPLEMENTED");
  });

  it("refuses a handler the manifest never declared", () => {
    expect(() =>
      defineConnector({
        ...base,
        capabilities: { egress: null, operations: {}, ingress: false },
        operations: { pull: () => Promise.resolve({ records: [], cursor: null }) }
      })
    ).toThrow("OPERATION_NOT_DECLARED");
  });

  it("refuses a manifest that disagrees with itself about ingress", () => {
    expect(() =>
      defineConnector({
        ...base,
        capabilities: { egress: null, operations: {}, ingress: true },
        operations: {}
      })
    ).toThrow("INGRESS_MISDECLARED");
  });

  /**
   * The cadence is the connector's to declare and the platform's to bound. A connector that could
   * ask for a poll every second would be granting itself a share of every other tenant's worker
   * time, which is not a decision that belongs inside a connector.
   */
  it("refuses a cadence faster than the platform floor", () => {
    expect(() =>
      defineConnector({
        ...base,
        capabilities: {
          egress: null,
          operations: { pull: { shape: "event", everySeconds: minimumCadenceSeconds - 1 } },
          ingress: false
        },
        operations: { pull: () => Promise.resolve({ records: [], cursor: null }) }
      })
    ).toThrow("CADENCE_TOO_FREQUENT");
  });

  it("refuses a cadence that is not a whole number of seconds", () => {
    for (const everySeconds of [90.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        defineConnector({
          ...base,
          capabilities: { egress: null, operations: { pull: { shape: "event", everySeconds } }, ingress: false },
          operations: { pull: () => Promise.resolve({ records: [], cursor: null }) }
        })
      ).toThrow("CADENCE_NOT_A_WHOLE_SECOND");
    }
  });

  it("accepts an operation with no cadence, which is one nothing schedules", () => {
    const connector = defineConnector({
      ...base,
      capabilities: { egress: null, operations: { pull: { shape: "event" } }, ingress: false },
      operations: { pull: () => Promise.resolve({ records: [], cursor: null }) }
    });
    expect(connector.capabilities.operations["pull"]?.everySeconds).toBeUndefined();
  });
});

describe("the capability manifest limits what runs", () => {
  it("dispatches an operation the manifest declares", async () => {
    const result = await echo.run("pull", contextWith({ label: "hello" }), { cursor: null });
    expect(result.records[0]?.externalId).toBe("hello");
  });

  it("carries the shape of what an operation returns, because retention depends on it", () => {
    // `state` is overwritten by the next pass and expires from disuse; `event` never comes back
    // and expires by age. A purge that had to guess between them would either lose an execution
    // history or keep every metric sample forever.
    expect(echo.capabilities.operations["pull"]?.shape).toBe("event");
  });

  it("refuses an operation nobody declared, rather than looking for a handler", async () => {
    await expect(echo.run("push", contextWith({ label: "hello" }), { cursor: null })).rejects.toThrow(
      "UNKNOWN_OPERATION"
    );
  });

  it("refuses ingress on a connector that does not accept it", async () => {
    const request = { body: "{}", headers: {}, receivedAt: new Date() };
    await expect(echo.ingest(contextWith({ label: "hello" }), request)).rejects.toThrow("INGRESS_NOT_SUPPORTED");
  });

  it("reports no signature scheme when it accepts no ingress", () => {
    expect(echo.ingressSignature).toBeNull();
  });
});

describe("configuration", () => {
  it("rejects a key nobody allowlisted instead of quietly dropping it", () => {
    const result = echo.parseConfig({ label: "hello", sneaky: "value" });
    expect(result.ok).toBe(false);
  });

  it("reports where the problem is and what kind, and never what was sent", () => {
    const schema = z.strictObject({ token: z.string().min(20) });
    const connector = defineConnector<z.infer<typeof schema>>({
      type: "test-secretive",
      contractVersion: connectorContractVersion,
      configSchema: schema,
      credentialKinds: [],
      capabilities: { egress: null, operations: {}, ingress: false },
      health: () => Promise.resolve({ status: "ok" }),
      operations: {}
    });

    const result = connector.parseConfig({ token: "sk-live-9f2c8ab41" });
    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.issues[0]?.path).toBe("token");
    expect(result.issues[0]?.code).toBeTruthy();
    // The whole point: an invalid configuration travels to a response, a log and a screen.
    expect(JSON.stringify(result.issues)).not.toContain("sk-live");
  });

  it("revalidates before running, so a stored config cannot outlive its schema", async () => {
    await expect(echo.run("pull", contextWith({ label: "" }), { cursor: null })).rejects.toThrow("INVALID_CONFIG");
  });

  it("revalidates before a health check too", async () => {
    await expect(echo.health(contextWith({ nothing: "valid" }))).rejects.toThrow(ConnectorError);
  });
});

describe("failure for a response status", () => {
  it("calls a successful status no failure at all", () => {
    expect(failureForStatus(200)).toBeNull();
    expect(failureForStatus(204)).toBeNull();
    expect(failureForStatus(302)).toBeNull();
  });

  it("separates what is worth retrying from what the provider meant", () => {
    expect(failureForStatus(429)).toBe("rate_limited");
    expect(failureForStatus(500)).toBe("server_error");
    expect(failureForStatus(503)).toBe("server_error");
    expect(failureForStatus(401)).toBe("unauthorized");
    expect(failureForStatus(403)).toBe("forbidden");
    expect(failureForStatus(404)).toBe("not_found");
  });

  it("treats any other client error as a response we cannot use", () => {
    expect(failureForStatus(400)).toBe("invalid_response");
    expect(failureForStatus(418)).toBe("invalid_response");
  });
});

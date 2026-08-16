import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { EgressPolicy } from "@control-hub/connectors";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createGuardedHttp, type AddressResolver, type EgressError } from "./guarded-fetch.js";

/**
 * The suite the specification calls mandatory.
 *
 * Resolution is injected, so every SSRF case is a unit test: no test here depends on what a real
 * resolver answers for a name, which is what would otherwise make this file intermittent in CI.
 * The few tests that need real bytes on a socket talk to a loopback server and reach it through
 * an allowlist, which is exactly the mechanism an operator uses for a service on the same host.
 */

let server: Server;
let origin: string;
let lastRequest = { method: "", url: "", headers: {} as Record<string, string | string[] | undefined>, body: "" };

/**
 * What the handler does next, set per test.
 *
 * Headers may be given as a flat list rather than an object, because that is the only way to send
 * a header whose name an object literal would swallow -- `__proto__` sets a prototype instead of
 * a key, so an object could never express it.
 */
let respond: (path: string) => { status: number; headers?: Record<string, string> | string[]; body?: string } = () => ({
  status: 200
});

beforeAll(async () => {
  server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      lastRequest = {
        method: request.method ?? "",
        url: request.url ?? "",
        headers: request.headers,
        body: Buffer.concat(chunks).toString("utf8")
      };
      const reply = respond(request.url ?? "/");
      response.writeHead(reply.status, reply.headers ?? { "content-type": "application/json" });
      response.end(reply.body ?? "{}");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

const publicPolicy: EgressPolicy = { schemes: ["https"], destination: "configured_base_url" };

const resolvesTo =
  (address: string, family = 4): AddressResolver =>
  () =>
    Promise.resolve({ address, family });

const publicHttp = (resolve: AddressResolver, baseUrl = "https://provider.test/v1") =>
  createGuardedHttp({ policy: publicPolicy, baseUrl, allowlist: [], resolve });

const failureOf = async (call: Promise<unknown>) => {
  try {
    await call;
  } catch (error) {
    return error as EgressError;
  }
  throw new Error("the call was expected to be refused and was not");
};

describe("addresses a connector must never reach", () => {
  const forbidden = [
    ["loopback", "127.0.0.1"],
    ["the private range the database lives in", "10.0.0.5"],
    ["cloud metadata", "169.254.169.254"],
    ["an IPv4 address hidden inside IPv6", "::ffff:127.0.0.1"],
    ["unique local IPv6", "fd00::1"],
    ["carrier-grade NAT", "100.64.1.1"]
  ] as const;

  for (const [what, address] of forbidden) {
    it(`refuses ${what}`, async () => {
      const http = publicHttp(resolvesTo(address));
      const error = await failureOf(http.send({ method: "GET", url: "https://provider.test/v1/things" }));
      expect(error.code).toBe("ADDRESS_NOT_ROUTABLE");
      expect(error.failure).toBe("blocked_destination");
    });
  }

  it("refuses a name that resolves to nothing, without pretending it was blocked", async () => {
    const http = createGuardedHttp({
      policy: publicPolicy,
      baseUrl: "https://provider.test/v1",
      allowlist: [],
      resolve: () => Promise.reject(new Error("ENOTFOUND"))
    });
    const error = await failureOf(http.send({ method: "GET", url: "https://provider.test/v1/things" }));
    expect(error.code).toBe("DNS_RESOLUTION_FAILED");
  });
});

describe("what a connector is allowed to address at all", () => {
  it("refuses a scheme the manifest does not declare", async () => {
    const http = publicHttp(resolvesTo("93.184.216.34"));
    for (const url of ["http://provider.test/v1/x", "file:///etc/passwd", "gopher://provider.test/1"]) {
      expect((await failureOf(http.send({ method: "GET", url }))).code).toBe("SCHEME_NOT_ALLOWED");
    }
  });

  it("refuses a URL carrying credentials, which is how a host is smuggled past a reader", async () => {
    const http = publicHttp(resolvesTo("93.184.216.34"));
    const error = await failureOf(http.send({ method: "GET", url: "https://provider.test@127.0.0.1/v1/things" }));
    expect(["URL_HAS_CREDENTIALS", "DESTINATION_OUTSIDE_BASE_URL"]).toContain(error.code);
  });

  it("refuses a destination outside the configured base, on the same host", async () => {
    const http = publicHttp(resolvesTo("93.184.216.34"));
    expect((await failureOf(http.send({ method: "GET", url: "https://provider.test/admin" }))).code).toBe(
      "DESTINATION_OUTSIDE_BASE_URL"
    );
    // The prefix trap: /v1-internal is not under /v1.
    expect((await failureOf(http.send({ method: "GET", url: "https://provider.test/v1-internal" }))).code).toBe(
      "DESTINATION_OUTSIDE_BASE_URL"
    );
  });

  it("refuses another host entirely, however similar the name", async () => {
    const http = publicHttp(resolvesTo("93.184.216.34"));
    for (const url of ["https://provider.test.evil.test/v1", "https://provider.test:8443/v1"]) {
      expect((await failureOf(http.send({ method: "GET", url }))).code).toBe("DESTINATION_OUTSIDE_BASE_URL");
    }
  });

  it("refuses a destination the operator never named, under an allowlist policy", async () => {
    const http = createGuardedHttp({
      policy: { schemes: ["http"], destination: "operator_allowlist" },
      baseUrl: null,
      allowlist: [{ scheme: "http:", hostname: "n8n.internal", port: 5678 }],
      resolve: resolvesTo("10.0.0.9")
    });
    expect((await failureOf(http.send({ method: "GET", url: "http://10.0.0.9:5678/rest/x" }))).code).toBe(
      "DESTINATION_NOT_ALLOWLISTED"
    );
    // The same private address is fine once the operator has named the origin it belongs to.
    expect((await failureOf(http.send({ method: "GET", url: "http://n8n.internal:5679/rest/x" }))).code).toBe(
      "DESTINATION_NOT_ALLOWLISTED"
    );
  });

  /**
   * Gap G3 of phase 6. The allowlist answers "may this installation reach that address at all",
   * which is not the same question as "is that address this instance's to call". An operator who
   * allowed one internal n8n and one internal Prometheus was not thereby allowing every instance
   * to talk to both, and before this an instance configured against one could reach the other.
   *
   * All three refusals happen before a name is resolved, so no socket is opened here.
   */
  it("refuses an allowlisted origin that is not this instance's own base", async () => {
    const http = createGuardedHttp({
      policy: { schemes: ["http"], destination: "operator_allowlist" },
      baseUrl: "http://n8n.internal:5678/api/v1",
      allowlist: [
        { scheme: "http:", hostname: "n8n.internal", port: 5678 },
        { scheme: "http:", hostname: "prometheus.internal", port: 9090 }
      ],
      resolve: resolvesTo("10.0.0.9")
    });

    for (const url of [
      // Named by the operator, and still not this instance's to call.
      "http://prometheus.internal:9090/api/v1/query",
      // Its own host, outside its own path.
      "http://n8n.internal:5678/rest/owner",
      // The prefix trap applies here too: /api/v1-internal is not under /api/v1.
      "http://n8n.internal:5678/api/v1-internal"
    ]) {
      expect((await failureOf(http.send({ method: "GET", url }))).code).toBe("DESTINATION_OUTSIDE_BASE_URL");
    }
  });
});

describe("talking to a destination the operator allowed", () => {
  const allowlisted = (extra: Partial<Parameters<typeof createGuardedHttp>[0]> = {}) => {
    const url = new URL(origin);
    return createGuardedHttp({
      policy: { schemes: ["http"], destination: "operator_allowlist" },
      baseUrl: null,
      allowlist: [{ scheme: "http:", hostname: "127.0.0.1", port: Number(url.port) }],
      ...extra
    });
  };

  it("sends the request and returns the response", async () => {
    respond = () => ({ status: 200, body: '{"ok":true}' });
    const response = await allowlisted().send({ method: "POST", url: `${origin}/things`, body: '{"a":1}' });
    expect(response.status).toBe(200);
    expect(response.body).toBe('{"ok":true}');
    expect(lastRequest.method).toBe("POST");
    expect(lastRequest.body).toBe('{"a":1}');
  });

  /**
   * The positive half of G3, over a real socket: confining an allowlisted instance must not stop
   * it doing its job. Every other test in this block runs with `baseUrl: null` and still reaches
   * the whole allowlist, which is the other case the criterion names -- a connector with no base
   * configured is not thereby confined to nothing.
   */
  it("serves what is under the instance base, and refuses what is beside it", async () => {
    respond = () => ({ status: 200, body: '{"ok":true}' });
    const http = allowlisted({ baseUrl: `${origin}/api/v1` });

    const response = await http.send({ method: "GET", url: `${origin}/api/v1/workflows` });
    expect(response.status).toBe(200);

    const error = await failureOf(http.send({ method: "GET", url: `${origin}/rest/owner` }));
    expect(error.code).toBe("DESTINATION_OUTSIDE_BASE_URL");
  });

  it("identifies itself without saying anything about a tenant", async () => {
    respond = () => ({ status: 200 });
    await allowlisted().send({ method: "GET", url: `${origin}/things` });
    expect(lastRequest.headers["user-agent"]).toBe("ControlHub-Connector/1.0");
  });

  /**
   * Header names come from the other end of the socket and become property names on an object we
   * then pass around. Node drops `__proto__` while parsing, so nothing escalates today -- but that
   * is an implementation detail of the parser, not a guarantee of ours, and `constructor` goes
   * straight through. The map is built without a prototype, so a header name can only ever mean a
   * header, and reading one that was never sent answers nothing instead of answering a built-in.
   */
  it("lets a provider name a header after a built-in without it meaning anything more", async () => {
    respond = () => ({
      status: 200,
      headers: ["__proto__", "polluted", "constructor", "not-a-constructor", "content-type", "application/json"]
    });
    const response = await allowlisted().send({ method: "GET", url: `${origin}/things` });

    expect(response.headers["constructor"]).toBe("not-a-constructor");
    expect(response.headers["toString"]).toBeUndefined();
    expect(Object.getPrototypeOf(response.headers)).toBeNull();
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
  });

  it("stops reading a response that is larger than the budget", async () => {
    respond = () => ({ status: 200, body: "x".repeat(4096) });
    const http = allowlisted({ budgets: { maxResponseBytes: 512 } });
    const error = await failureOf(http.send({ method: "GET", url: `${origin}/big` }));
    expect(error.code).toBe("RESPONSE_TOO_LARGE");
    expect(error.failure).toBe("response_too_large");
  });

  it("gives up on a destination that accepts the connection and then says nothing", async () => {
    respond = () => ({ status: 200 });
    const slow = createServer((_request, response) => void response.writeHead(200));
    await new Promise<void>((resolve) => slow.listen(0, "127.0.0.1", resolve));
    const port = (slow.address() as AddressInfo).port;

    const http = createGuardedHttp({
      policy: { schemes: ["http"], destination: "operator_allowlist" },
      baseUrl: null,
      allowlist: [{ scheme: "http:", hostname: "127.0.0.1", port }],
      budgets: { headersMs: 150, totalMs: 2_000 }
    });
    const error = await failureOf(http.send({ method: "GET", url: `http://127.0.0.1:${port}/hang` }));
    expect(error.failure).toBe("timeout");
    await new Promise<void>((resolve) => slow.close(() => resolve()));
  });
});

describe("redirects", () => {
  const redirectingHttp = (target: string) => {
    const url = new URL(origin);
    respond = (path) =>
      path === "/start"
        ? { status: 302, headers: { location: target }, body: "" }
        : { status: 200, body: '{"arrived":true}' };
    return createGuardedHttp({
      policy: { schemes: ["http"], destination: "operator_allowlist" },
      baseUrl: null,
      allowlist: [{ scheme: "http:", hostname: "127.0.0.1", port: Number(url.port) }]
    });
  };

  it("follows one that stays inside what is allowed", async () => {
    const response = await redirectingHttp(`${origin}/arrived`).send({ method: "GET", url: `${origin}/start` });
    expect(response.body).toBe('{"arrived":true}');
  });

  it("refuses one that points at a destination nobody allowed", async () => {
    const http = redirectingHttp("http://169.254.169.254/latest/meta-data/");
    const error = await failureOf(http.send({ method: "GET", url: `${origin}/start` }));
    expect(error.code).toBe("DESTINATION_NOT_ALLOWLISTED");
  });

  it("does not carry the credential to another origin", async () => {
    const other = createServer((request, response) => {
      lastRequest = { method: request.method ?? "", url: request.url ?? "", headers: request.headers, body: "" };
      response.writeHead(200);
      response.end("{}");
    });
    await new Promise<void>((resolve) => other.listen(0, "127.0.0.1", resolve));
    const otherPort = (other.address() as AddressInfo).port;
    const url = new URL(origin);

    respond = () => ({ status: 302, headers: { location: `http://127.0.0.1:${otherPort}/next` }, body: "" });
    const http = createGuardedHttp({
      policy: { schemes: ["http"], destination: "operator_allowlist" },
      baseUrl: null,
      allowlist: [
        { scheme: "http:", hostname: "127.0.0.1", port: Number(url.port) },
        { scheme: "http:", hostname: "127.0.0.1", port: otherPort }
      ]
    });

    await http.send({
      method: "GET",
      url: `${origin}/start`,
      headers: { authorization: "Bearer sk_live_9f2c8ab4", accept: "application/json" }
    });
    expect(lastRequest.headers["authorization"]).toBeUndefined();
    expect(lastRequest.headers["accept"]).toBe("application/json");
    await new Promise<void>((resolve) => other.close(() => resolve()));
  });

  it("stops after the budget rather than following a loop", async () => {
    const url = new URL(origin);
    respond = () => ({ status: 302, headers: { location: `${origin}/start` }, body: "" });
    const http = createGuardedHttp({
      policy: { schemes: ["http"], destination: "operator_allowlist" },
      baseUrl: null,
      allowlist: [{ scheme: "http:", hostname: "127.0.0.1", port: Number(url.port) }],
      budgets: { maxRedirects: 2 }
    });
    const error = await failureOf(http.send({ method: "GET", url: `${origin}/start` }));
    expect(error.code).toBe("TOO_MANY_REDIRECTS");
  });
});

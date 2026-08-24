import { describe, expect, it } from "vitest";
import { ConnectorError, type ConnectorContext, type HttpRequest } from "../contract.js";
import { prometheus } from "./prometheus.js";

/**
 * The contract tests for the Prometheus connector.
 *
 * The fixtures are written from the documented shape of the HTTP API v1 rather than captured
 * from the VPS: production access is out of scope for this phase, exactly as it was for n8n.
 * What they prove is that the connector honours the contract, keeps a bounded projection and
 * never lets a credential or a provider's own words travel -- not that a particular Prometheus
 * build sends exactly these bytes.
 */

const baseUrl = "https://prometheus.example.com";
const token = "prom_SUPERSECRETTOKENVALUE";
const now = new Date("2026-08-19T12:00:00.000Z");
const valid = { baseUrl };

/** A moment with a readable ISO form, used for every timestamp-valued fixture. */
const noon = 1_755_600_000;
const iso = (seconds: number) => new Date(seconds * 1000).toISOString();

type Series = { metric: Record<string, string>; value: [number, string] };

const series = (metric: Record<string, string>, value: number | string): Series => ({
  metric,
  value: [noon, String(value)]
});

const labels = (count: number) => Array.from({ length: count }, (_, index) => `vps-${index}`);

type Reply = { status?: number; body?: unknown };

/**
 * A context whose answers are keyed by a fragment of the PromQL expression, not by call order.
 *
 * Order would make every test depend on the sequence the connector happens to ask in, so adding
 * a metric would break tests that have nothing to do with it. Naming the metric a fixture stands
 * for also makes the test say which series it is describing, which is the part worth reading.
 */
function contextWith(
  config: unknown,
  vectors: Record<string, Series[]> = {},
  options: { secret?: () => Promise<string>; reply?: Reply } = {}
) {
  const requests: HttpRequest[] = [];
  const warnings: { fields: Record<string, unknown>; message: string }[] = [];

  const context: ConnectorContext<unknown> = {
    instanceId: "instance-1",
    config,
    http: {
      send: (request) => {
        requests.push(request);
        const reply = options.reply;
        if (reply) {
          return Promise.resolve({
            status: reply.status ?? 200,
            headers: {},
            body: typeof reply.body === "string" ? reply.body : JSON.stringify(reply.body ?? {})
          });
        }

        const expression = new URL(request.url).searchParams.get("query") ?? "";
        const match = Object.entries(vectors).find(([fragment]) => expression.includes(fragment));
        return Promise.resolve({
          status: 200,
          headers: {},
          body: JSON.stringify({ status: "success", data: { resultType: "vector", result: match?.[1] ?? [] } })
        });
      }
    },
    // No credential is the ordinary case for this connector, so it is what the tests get unless
    // one asks for the other. The runtime raises exactly this when the vault holds nothing.
    secrets: { open: options.secret ?? (() => Promise.reject(new ConnectorError("CREDENTIAL_MISSING"))) },
    logger: {
      info: () => undefined,
      warn: (fields, message) => warnings.push({ fields: { ...fields }, message }),
      error: () => undefined
    },
    clock: { now: () => now }
  };
  return { context, requests, warnings };
}

const queryOf = (request: HttpRequest | undefined) => new URL(request?.url ?? "https://x/").searchParams.get("query");

describe("configuration", () => {
  it("takes a base and fills in the rest", () => {
    expect(prometheus.parseConfig(valid)).toEqual({ ok: true, config: { baseUrl, hostLabels: [] } });
  });

  it("allows plain http, because a Prometheus on the operator's own host has no TLS", () => {
    expect(prometheus.parseConfig({ baseUrl: "http://127.0.0.1:9090" }).ok).toBe(true);
  });

  it("refuses a scheme that is not http, and a base carrying credentials", () => {
    expect(prometheus.parseConfig({ baseUrl: "file:///etc/passwd" }).ok).toBe(false);
    expect(prometheus.parseConfig({ baseUrl: "ftp://prometheus.example.com" }).ok).toBe(false);
    // A password in the base would be a second way to authenticate that the vault never sealed.
    expect(prometheus.parseConfig({ baseUrl: "https://user:pass@prometheus.example.com" }).ok).toBe(false);
  });

  it("refuses a key nobody allowlisted, rather than stripping it", () => {
    expect(prometheus.parseConfig({ baseUrl, apiToken: token }).ok).toBe(false);
  });

  it("holds the host inventory at fifty labels, and refuses an empty one", () => {
    expect(prometheus.parseConfig({ baseUrl, hostLabels: labels(50) }).ok).toBe(true);
    expect(prometheus.parseConfig({ baseUrl, hostLabels: labels(51) }).ok).toBe(false);
    expect(prometheus.parseConfig({ baseUrl, hostLabels: [""] }).ok).toBe(false);
  });

  it("keeps a host label short enough that its identifier still fits the record store", () => {
    expect(prometheus.parseConfig({ baseUrl, hostLabels: ["v".repeat(190)] }).ok).toBe(true);
    expect(prometheus.parseConfig({ baseUrl, hostLabels: ["v".repeat(191)] }).ok).toBe(false);
  });

  it("reports the path and the code of a bad field, and never the value", () => {
    const result = prometheus.parseConfig({
      baseUrl: `ftp://prometheus.example.com/?token=${token}`,
      hostLabels: labels(51)
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(JSON.stringify(result.issues)).not.toContain(token);
    expect(result.issues.map((issue) => issue.path)).toContain("hostLabels");
  });
});

describe("the manifest", () => {
  it("declares three state polls with the cadence the specification agreed", () => {
    expect(prometheus.capabilities.operations).toEqual({
      pull_host_metrics: { shape: "state", everySeconds: 120 },
      pull_container_state: { shape: "state", everySeconds: 300 },
      pull_probe_state: { shape: "state", everySeconds: 120 }
    });
  });

  it("goes out by the operator allowlist, not by whatever the tenant typed", () => {
    expect(prometheus.capabilities.egress).toEqual({ schemes: ["http", "https"], destination: "operator_allowlist" });
  });

  it("asks for the address openly and folds away what answers for itself", () => {
    expect(prometheus.configFields).toEqual([
      { name: "baseUrl", kind: "url", group: "connection", required: true, defaultValue: null },
      { name: "hostLabels", kind: "list", group: "behaviour", required: false, defaultValue: [] },
      { name: "containerJob", kind: "text", group: "behaviour", required: false, defaultValue: null },
      { name: "probeJob", kind: "text", group: "behaviour", required: false, defaultValue: null }
    ]);
  });

  it("offers the token as the one credential, and needs none to work", () => {
    expect(prometheus.credentialKinds).toEqual(["api_token"]);
  });

  it("receives nothing: a Prometheus has no webhook to push at us", async () => {
    expect(prometheus.capabilities.ingress).toBe(false);
    expect(prometheus.ingressSignature).toBeNull();

    const { context } = contextWith(valid);
    await expect(prometheus.ingest(context, { body: "{}", headers: {}, receivedAt: now })).rejects.toMatchObject({
      code: "INGRESS_NOT_SUPPORTED"
    });
  });

  it("refuses an operation that is not in the manifest even though the code exists", async () => {
    const { context } = contextWith(valid);
    await expect(prometheus.run("pull_alerts", context, { cursor: null })).rejects.toThrow(ConnectorError);
  });
});

describe("health", () => {
  it("asks the query API rather than a liveness path that would answer without reading anything", async () => {
    const { context, requests } = contextWith(valid, {}, { reply: { status: 401 } });

    expect(await prometheus.health(context)).toEqual({ status: "failed", failure: "unauthorized" });
    expect(new URL(requests[0]?.url ?? "").pathname).toBe("/api/v1/query");
    expect(queryOf(requests[0])).toBe("vector(1)");
  });

  it("passes when the instance answers", async () => {
    const { context } = contextWith(valid);
    expect(await prometheus.health(context)).toEqual({ status: "ok" });
  });
});

describe("pulling host metrics", () => {
  const hosts = { ...valid, hostLabels: ["vps-1", "vps-2"] };

  it("keeps the fields we chose and drops every label the scrape config invented", async () => {
    const { context } = contextWith(hosts, {
      node_cpu_seconds_total: [series({ instance: "vps-1", job: "node", owner_token: "s3cr3t" }, 0.23)],
      node_memory_MemAvailable_bytes: [series({ instance: "vps-1" }, 0.5)],
      node_filesystem_avail_bytes: [series({ instance: "vps-1" }, 0.81)],
      node_load1: [series({ instance: "vps-1" }, 1.234)],
      node_boot_time_seconds: [series({ instance: "vps-1" }, 86_400.6)]
    });

    const result = await prometheus.run("pull_host_metrics", context, { cursor: null });

    expect(result.records).toEqual([
      {
        externalId: "host:vps-1",
        data: {
          cpuBusyRatio: 0.23,
          memoryUsedRatio: 0.5,
          filesystemUsedRatio: 0.81,
          load1: 1.23,
          uptimeSeconds: 86_401
        }
      }
    ]);
    // The point of the projection: a label somebody added to a scrape config never reaches us.
    expect(JSON.stringify(result.records)).not.toContain("s3cr3t");
    expect(JSON.stringify(result.records)).not.toContain("owner_token");
    // A state operation reads the whole inventory every pass; there is nothing to resume.
    expect(result.cursor).toBeNull();
  });

  it("never puts a host label in the query, so nothing an operator typed can rewrite it", async () => {
    const awkward = { ...valid, hostLabels: ['vps-1"} or up{'] };
    const { context, requests } = contextWith(awkward, { node_load1: [series({ instance: 'vps-1"} or up{' }, 1)] });

    const result = await prometheus.run("pull_host_metrics", context, { cursor: null });

    expect(result.records).toHaveLength(1);
    for (const request of requests) expect(queryOf(request)).not.toContain("or up{");
  });

  it("leaves out a host nobody named, because the inventory is the configuration's to decide", async () => {
    const { context } = contextWith(hosts, {
      node_load1: [series({ instance: "vps-1" }, 1), series({ instance: "vps-9" }, 2)]
    });

    const result = await prometheus.run("pull_host_metrics", context, { cursor: null });
    expect(result.records.map((record) => record.externalId)).toEqual(["host:vps-1"]);
  });

  it("drops the field a host reported as NaN, and keeps the host", async () => {
    const { context } = contextWith(hosts, {
      node_load1: [series({ instance: "vps-1" }, "NaN")],
      node_boot_time_seconds: [series({ instance: "vps-1" }, 3_600)]
    });

    const result = await prometheus.run("pull_host_metrics", context, { cursor: null });
    expect(result.records).toEqual([{ externalId: "host:vps-1", data: { uptimeSeconds: 3_600 } }]);
  });

  it("asks nothing at all when no host was named", async () => {
    const { context, requests } = contextWith(valid, { node_load1: [series({ instance: "vps-1" }, 1)] });

    const result = await prometheus.run("pull_host_metrics", context, { cursor: null });

    expect(result.records).toEqual([]);
    expect(requests).toHaveLength(0);
  });

  it("returns the hosts in a stable order, whatever order the instance answered in", async () => {
    const { context } = contextWith(hosts, {
      node_load1: [series({ instance: "vps-2" }, 2), series({ instance: "vps-1" }, 1)]
    });

    const result = await prometheus.run("pull_host_metrics", context, { cursor: null });
    expect(result.records.map((record) => record.externalId)).toEqual(["host:vps-1", "host:vps-2"]);
  });

  it("gives the same externalId for the same host, so a retry updates rather than duplicates", async () => {
    const vectors = { node_load1: [series({ instance: "vps-1" }, 1)] };
    const first = await prometheus.run("pull_host_metrics", contextWith(hosts, vectors).context, { cursor: null });
    const second = await prometheus.run("pull_host_metrics", contextWith(hosts, vectors).context, { cursor: null });
    expect(first.records[0]?.externalId).toBe(second.records[0]?.externalId);
  });
});

describe("pulling container state", () => {
  const containers = { ...valid, containerJob: "cadvisor" };

  it("asks nothing when nobody said where the containers are", async () => {
    const { context, requests } = contextWith(valid, {
      container_last_seen: [series({ name: "control-hub-api", job: "cadvisor" }, noon)]
    });

    const result = await prometheus.run("pull_container_state", context, { cursor: null });

    expect(result.records).toEqual([]);
    expect(requests).toHaveLength(0);
  });

  it("keeps one record per container of the named job, and leaves the root cgroup out", async () => {
    const of = (name: string, job: string, value: number) => series({ name, job, instance: "vps-1" }, value);
    const { context } = contextWith(containers, {
      container_last_seen: [
        of("control-hub-api", "cadvisor", noon),
        of("", "cadvisor", noon),
        of("somebody-elses", "other-job", noon)
      ],
      container_start_time_seconds: [of("control-hub-api", "cadvisor", noon - 86_400)],
      container_memory_usage_bytes: [of("control-hub-api", "cadvisor", 268_435_456.4)],
      container_cpu_usage_seconds_total: [of("control-hub-api", "cadvisor", 0.1234)]
    });

    const result = await prometheus.run("pull_container_state", context, { cursor: null });

    expect(result.records).toEqual([
      {
        externalId: "container:control-hub-api",
        data: {
          host: "vps-1",
          lastSeenAt: iso(noon),
          startedAt: iso(noon - 86_400),
          memoryBytes: 268_435_456,
          cpuCores: 0.1234
        }
      }
    ]);
  });
});

describe("pulling probe state", () => {
  const target = "https://control-hub.example.com";
  const probes = { ...valid, probeJob: "blackbox" };

  it("merges the scrape and the probe of one target into one record", async () => {
    const of = (value: number) => series({ job: "blackbox", instance: target }, value);
    const { context } = contextWith(probes, {
      "(up)": [of(1)],
      probe_success: [of(1)],
      probe_duration_seconds: [of(0.25)],
      probe_ssl_earliest_cert_expiry: [of(noon + 2_592_000)]
    });

    const result = await prometheus.run("pull_probe_state", context, { cursor: null });

    expect(result.records).toEqual([
      {
        externalId: `probe:${target}`,
        data: {
          job: "blackbox",
          scrapeUp: true,
          success: true,
          durationSeconds: 0.25,
          certificateExpiresAt: iso(noon + 2_592_000)
        }
      }
    ]);
  });

  it("reads `up` even with no probe job, because that is what says an exporter is down", async () => {
    const { context, requests } = contextWith(valid, {
      "(up)": [series({ job: "node", instance: "vps-1:9100" }, 0)]
    });

    const result = await prometheus.run("pull_probe_state", context, { cursor: null });

    expect(result.records).toEqual([{ externalId: "probe:vps-1:9100", data: { job: "node", scrapeUp: false } }]);
    // Without a job to filter by, asking for the blackbox series would scoop up somebody else's.
    for (const request of requests) expect(queryOf(request)).not.toContain("probe_success");
  });

  it("ignores a probe published by a job that is not the configured one", async () => {
    const { context } = contextWith(probes, {
      "(up)": [],
      probe_success: [series({ job: "somebody-elses-blackbox", instance: target }, 1)]
    });

    const result = await prometheus.run("pull_probe_state", context, { cursor: null });
    expect(result.records).toEqual([]);
  });

  it("strips credentials from a probed target before it becomes an identifier", async () => {
    const { context } = contextWith(probes, {
      "(up)": [series({ job: "blackbox", instance: "https://ops:hunter2SECRET@internal.example.com/health" }, 1)]
    });

    const result = await prometheus.run("pull_probe_state", context, { cursor: null });

    expect(result.records[0]?.externalId).toBe("probe:https://internal.example.com/health");
    expect(JSON.stringify(result.records)).not.toContain("hunter2SECRET");
  });

  it("merges two jobs sharing an instance the same way whatever order they arrive in", async () => {
    const alpha = series({ job: "alpha", instance: "shared:9100" }, 0);
    const zulu = series({ job: "zulu", instance: "shared:9100" }, 1);

    const forwards = await prometheus.run("pull_probe_state", contextWith(valid, { "(up)": [alpha, zulu] }).context, {
      cursor: null
    });
    const backwards = await prometheus.run("pull_probe_state", contextWith(valid, { "(up)": [zulu, alpha] }).context, {
      cursor: null
    });

    expect(forwards.records).toEqual(backwards.records);
    expect(forwards.records).toEqual([{ externalId: "probe:shared:9100", data: { job: "zulu", scrapeUp: true } }]);
  });

  it("reads the backup timestamp the VPS script publishes through the textfile collector", async () => {
    const { context } = contextWith(valid, {
      control_hub_backup_last_success_seconds: [series({ backup_job: "postgres-daily" }, noon - 3_600)]
    });

    const result = await prometheus.run("pull_probe_state", context, { cursor: null });

    expect(result.records).toEqual([
      { externalId: "backup:postgres-daily", data: { lastSuccessAt: iso(noon - 3_600) } }
    ]);
  });

  it("leaves out a backup series with no job label instead of inventing a name for it", async () => {
    const { context } = contextWith(valid, {
      control_hub_backup_last_success_seconds: [series({ instance: "vps-1" }, noon)]
    });

    const result = await prometheus.run("pull_probe_state", context, { cursor: null });
    expect(result.records).toEqual([]);
  });
});

describe("what the provider does to us", () => {
  const hosts = { ...valid, hostLabels: ["vps-1"] };

  it("maps a rate limit and a server error onto the codes the retry policy understands", async () => {
    const limited = contextWith(hosts, {}, { reply: { status: 429 } });
    await expect(prometheus.run("pull_host_metrics", limited.context, { cursor: null })).rejects.toMatchObject({
      code: "RATE_LIMITED"
    });

    const broken = contextWith(hosts, {}, { reply: { status: 503 } });
    await expect(prometheus.run("pull_host_metrics", broken.context, { cursor: null })).rejects.toMatchObject({
      code: "SERVER_ERROR"
    });
  });

  it("refuses a body that is not the shape it promised, without quoting it back", async () => {
    const html = contextWith(hosts, {}, { reply: { body: "<html>proxy error for user bob@example.com</html>" } });
    const failure = await prometheus
      .run("pull_host_metrics", html.context, { cursor: null })
      .catch((error: Error) => error);

    expect(failure).toBeInstanceOf(ConnectorError);
    expect((failure as Error).message).toBe("INVALID_RESPONSE");
    expect((failure as Error).message).not.toContain("bob@example.com");
  });

  it("refuses a query the instance answered with an error rather than a vector", async () => {
    const rejected = contextWith(
      hosts,
      {},
      { reply: { body: { status: "error", errorType: "bad_data", error: "invalid parameter" } } }
    );

    await expect(prometheus.run("pull_host_metrics", rejected.context, { cursor: null })).rejects.toMatchObject({
      code: "INVALID_RESPONSE"
    });
  });

  it("refuses more series than it agreed to hold, rather than reporting half an inventory", async () => {
    const flood = Array.from({ length: 1_001 }, (_, index) => series({ instance: `vps-${index}` }, 1));
    const { context } = contextWith(hosts, { node_cpu_seconds_total: flood });

    // A state operation that returned what fitted would expire everything it dropped, so the
    // size of the answer is a failure and not a truncation -- the same rule as n8n's paging.
    await expect(prometheus.run("pull_host_metrics", context, { cursor: null })).rejects.toMatchObject({
      code: "RESPONSE_TOO_LARGE"
    });
  });
});

describe("the token", () => {
  const hosts = { ...valid, hostLabels: ["vps-1"] };
  const vectors = { node_load1: [series({ instance: "vps-1" }, 1)] };

  it("calls without an authorization header when the vault holds nothing", async () => {
    const { context, requests } = contextWith(hosts, vectors);

    const result = await prometheus.run("pull_host_metrics", context, { cursor: null });

    expect(result.records).toHaveLength(1);
    expect(requests).not.toHaveLength(0);
    for (const request of requests) expect(request.headers?.authorization).toBeUndefined();
  });

  it("sends a bare token as a bearer", async () => {
    const { context, requests } = contextWith(hosts, vectors, { secret: () => Promise.resolve(token) });

    await prometheus.run("pull_host_metrics", context, { cursor: null });
    expect(requests[0]?.headers?.authorization).toBe(`Bearer ${token}`);
  });

  it("passes a value that already names its scheme through untouched", async () => {
    const basic = "Basic b3BzOmh1bnRlcjI=";
    const { context, requests } = contextWith(hosts, vectors, { secret: () => Promise.resolve(basic) });

    await prometheus.run("pull_host_metrics", context, { cursor: null });
    expect(requests[0]?.headers?.authorization).toBe(basic);
  });

  it("travels in a header and appears in no url, no record and no log", async () => {
    const { context, requests, warnings } = contextWith(hosts, vectors, { secret: () => Promise.resolve(token) });

    const records = await prometheus.run("pull_host_metrics", context, { cursor: null });
    await prometheus.health(context);

    expect(requests).not.toHaveLength(0);
    for (const request of requests) {
      expect(request.url).not.toContain(token);
      expect(request.headers?.authorization).toBe(`Bearer ${token}`);
    }
    expect(JSON.stringify([records, warnings])).not.toContain(token);
  });

  it("does not disguise a vault that failed to open as an instance with no password", async () => {
    const { context, requests } = contextWith(hosts, vectors, {
      secret: () => Promise.reject(new Error("key ring unavailable"))
    });

    await expect(prometheus.run("pull_host_metrics", context, { cursor: null })).rejects.toThrow(
      "key ring unavailable"
    );
    expect(requests).toHaveLength(0);
  });
});

import { z } from "zod";
import {
  ConnectorError,
  connectorContractVersion,
  defineConnector,
  failureForStatus,
  type ConnectorContext,
  type ConnectorRecord,
  type HttpRequest,
  type HttpResponse,
  type OperationResult,
  type RecordValue
} from "../contract.js";

/**
 * Prometheus: what the machines, the containers and the probes are doing right now.
 *
 * Everything this connector reads is *state* -- the current value of a thing that keeps existing.
 * There is no event here and no cursor: each pass reads the whole of what it was asked to watch,
 * and a host, container or probe the instance stops naming expires from disuse. That is why every
 * operation returns a null cursor, and why an answer we cannot read completely is a failure
 * rather than a short result: reporting half an inventory would expire the other half.
 *
 * Three rules shape the code more than anything else:
 *
 * **The PromQL is constant.** Not one value from the configuration ever reaches a URL: the
 * expressions below are literals, and `hostLabels`, `containerJob` and `probeJob` filter the
 * parsed result instead. That closes PromQL injection, the regex-escaping of a label somebody
 * typed, and "no secret in a query string" all at once, and it is a property a test can hold the
 * connector to rather than a habit somebody has to keep.
 *
 * **We take a projection, never the body.** A Prometheus answer carries the whole label set of
 * every series, and an operator's scrape config routinely adds labels of its own. Each field
 * below is named, and the label map is read for the two or three labels that identify the thing
 * and then dropped -- refusing by construction rather than by remembering to strip.
 *
 * **The credential is optional and it is a header.** A Prometheus authenticates nothing by
 * itself; where one sits behind a proxy that does, the token is opened for the length of the
 * call and never reaches a URL, a record, a log or an error.
 *
 * Specification: `docs/specifications/infrastructure.md`, section "Els connectors".
 */

/** The API these shapes were written against: `/api/v1/query`, stable since Prometheus 2.0. */
export const prometheusApiVersion = "HTTP API v1";

const configSchema = z.strictObject({
  /**
   * The Prometheus root, for example `http://prometheus.internal:9090`. Plain `http` is allowed
   * because a Prometheus on the operator's own host normally has no TLS of its own -- but it is
   * only reachable at all if the operator named it in `CONNECTOR_INTERNAL_ALLOWLIST`, and the
   * guard confines the instance to this base on top of that. A tenant cannot widen either.
   */
  baseUrl: z
    .url()
    .max(2048)
    .refine((value) => {
      const url = new URL(value);
      // Credentials embedded in the base would be a second, unsealed way to authenticate, and
      // they would travel in every log line that ever prints a URL.
      return (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password;
    }, "unsupported_base_url"),
  /**
   * Which `instance` labels are hosts of ours.
   *
   * A Prometheus scrapes whatever the operator pointed it at, and most of it is not a host we
   * inventory. The list is what decides; an empty one is an honest answer -- an installation that
   * only watches probes has no hosts -- and that is what makes this optional rather than an empty
   * field somebody must fill in to get past a form.
   *
   * Capped at 190 characters so that `host:<label>` still fits the 200 the record store allows: a
   * configuration that validates must not produce a record the store would refuse.
   */
  hostLabels: z.array(z.string().min(1).max(190)).max(50).default([]),
  /** The scrape job the container exporter publishes under. Without it, no containers are read. */
  containerJob: z.string().min(1).max(200).optional(),
  /** The scrape job the blackbox exporter publishes under. Without it, no probes are read. */
  probeJob: z.string().min(1).max(200).optional()
});

export type PrometheusConfig = z.infer<typeof configSchema>;

/**
 * What one answer may hold, and what one pass may return.
 *
 * Both are refusals rather than truncations. A `state` operation that returned what fitted would
 * expire everything it dropped, which turns a large instance into a screen that says half the
 * fleet disappeared -- the same reasoning as the page budget in the n8n connector.
 */
const maxSeriesPerQuery = 1_000;
const maxRecordsPerRun = 500;
/** `connector_records.external_id` is checked between 1 and 200 characters by migration 0033. */
const maxExternalIdLength = 200;

const queryResponseSchema = z.object({
  status: z.literal("success"),
  data: z.object({
    // An instant query answers with a vector. A matrix or a scalar means somebody changed an
    // expression into something this code does not know how to read.
    resultType: z.literal("vector"),
    result: z.array(
      z.object({
        metric: z.record(z.string().max(200), z.string().max(2048)),
        /** `[<unix seconds>, "<value>"]` -- the value is a string, including `NaN` and `+Inf`. */
        value: z.tuple([z.number(), z.string().max(64)])
      })
    )
  })
});

/** One series, reduced to the labels that identify it and a number we can use. */
type Sample = { labels: Readonly<Record<string, string>>; value: number };

/** Reads one number out of a series, or `null` for a value that is not worth a field. */
type FieldReader = { expression: string; read: (value: number) => RecordValue | null };

const compare = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0);

const round = (value: number, digits: number) => Number(value.toFixed(digits));

/**
 * A ratio, clamped to what a ratio can be.
 *
 * A rate over counters that were just reset can come back a hair below zero or above one. A
 * screen showing -0.0002% CPU is reporting arithmetic, not a machine.
 */
const ratio = (value: number) => round(Math.min(1, Math.max(0, value)), 4);

/** A unix instant as ISO, or null for the zero and the out-of-range values exporters emit. */
function instant(seconds: number): string | null {
  if (seconds <= 0) return null;
  const date = new Date(seconds * 1000);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

const truth = (value: number): RecordValue => value !== 0;

/**
 * What we keep about a host, from `node_exporter`.
 *
 * Every expression aggregates `by (instance)` so that what comes back is one number per machine
 * rather than one per CPU, mount point and device: the disaggregated series are both larger than
 * the cap and finer than anything the screen asks.
 */
const hostFields: Readonly<Record<string, FieldReader>> = {
  cpuBusyRatio: {
    expression: `1 - avg by (instance) (rate(node_cpu_seconds_total{mode="idle"}[5m]))`,
    read: ratio
  },
  memoryUsedRatio: {
    expression: `max by (instance) (1 - node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)`,
    read: ratio
  },
  filesystemUsedRatio: {
    // The worst filesystem on the machine, which is the one that will fill. Virtual filesystems
    // are excluded: an overlay reported at 100% is a container image, not a disk about to stop.
    expression:
      `max by (instance) ` +
      `(1 - node_filesystem_avail_bytes{fstype!~"tmpfs|overlay|squashfs"} / node_filesystem_size_bytes)`,
    read: ratio
  },
  load1: { expression: `max by (instance) (node_load1)`, read: (value) => round(value, 2) },
  uptimeSeconds: {
    expression: `max by (instance) (time() - node_boot_time_seconds)`,
    read: (value) => Math.max(0, Math.round(value))
  }
};

/** What we keep about a container, from cAdvisor. `name` is the container, `instance` the host. */
const containerFields: Readonly<Record<string, FieldReader>> = {
  lastSeenAt: { expression: `max by (name, instance, job) (container_last_seen)`, read: instant },
  startedAt: { expression: `max by (name, instance, job) (container_start_time_seconds)`, read: instant },
  memoryBytes: {
    expression: `max by (name, instance, job) (container_memory_usage_bytes)`,
    read: (value) => Math.round(value)
  },
  cpuCores: {
    expression: `sum by (name, instance, job) (rate(container_cpu_usage_seconds_total[5m]))`,
    read: (value) => round(value, 4)
  }
};

/** What the blackbox exporter says about a target it probed. */
const probeFields: Readonly<Record<string, FieldReader>> = {
  success: { expression: `max by (job, instance) (probe_success)`, read: truth },
  durationSeconds: { expression: `max by (job, instance) (probe_duration_seconds)`, read: (value) => round(value, 4) },
  certificateExpiresAt: { expression: `max by (job, instance) (probe_ssl_earliest_cert_expiry)`, read: instant }
};

/** Published by Prometheus itself for every target it scrapes, and it needs no configuration. */
const scrapeUpExpression = `max by (job, instance) (up)`;

/**
 * The backup script's own heartbeat, through the textfile collector of `node_exporter`.
 *
 * The label is `backup_job` and not `job`, because `job` belongs to the scrape configuration and
 * would say `node` for every backup on the machine. This is the line the VPS backup script has to
 * write, and it is a precondition of phase 7.2 rather than a piece of code.
 */
const backupExpression = `max by (backup_job) (control_hub_backup_last_success_seconds)`;

const base = (context: ConnectorContext<PrometheusConfig>) => context.config.baseUrl.replace(/\/+$/, "");

/**
 * The `Authorization` header for this instance, or null when there is no credential to send.
 *
 * Prometheus authenticates nothing on its own; what asks for a password is the proxy in front of
 * it, and that proxy may want either scheme. A bare token becomes a bearer, and a value that
 * already names its scheme travels as written, so an operator behind basic auth stores
 * `Basic <base64>` instead of being told to make our guess come true.
 *
 * Only a missing credential is caught. A vault that failed to open is a different fact, and
 * turning it into an unauthenticated call would report `401` from the far end when the answer was
 * that our own key ring is broken.
 */
async function authorization(context: ConnectorContext<PrometheusConfig>): Promise<string | null> {
  let token: string;
  try {
    token = await context.secrets.open("api_token");
  } catch (error) {
    if (!isCredentialMissing(error)) throw error;
    return null;
  }

  const value = token.trim();
  if (!value) return null;
  return /^(basic|bearer) /i.test(value) ? value : `Bearer ${value}`;
}

/**
 * Whether this is the runtime saying the vault holds nothing for this kind.
 *
 * The runtime raises `ConnectorRunError`, whose message is its code; a test raises the
 * `ConnectorError` of the same name. Both are matched on the code rather than on the class,
 * because the class lives in `apps/worker` and this package does not depend on it.
 */
function isCredentialMissing(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (error as { code?: unknown }).code === "CREDENTIAL_MISSING" || error.message === "CREDENTIAL_MISSING";
}

function parsed<Schema extends z.ZodType>(schema: Schema, response: HttpResponse): z.infer<Schema> {
  let body: unknown;
  try {
    body = JSON.parse(response.body);
  } catch {
    throw new ConnectorError("INVALID_RESPONSE");
  }
  const result = schema.safeParse(body);
  // No issue detail: the value that failed to parse is a provider payload, and an instance that
  // answers with an error quotes the request back inside it.
  if (!result.success) throw new ConnectorError("INVALID_RESPONSE");
  return result.data;
}

/**
 * The one door out of this connector: an instant query, with the credential if there is one.
 *
 * Every call goes through here, health included, so an instance that authenticates cannot end up
 * authenticating for some calls and not others. No `time` parameter: Prometheus evaluates at its
 * own now, which is the clock the samples were written against; ours would only add a skew.
 */
async function ask(
  context: ConnectorContext<PrometheusConfig>,
  expression: string,
  timeoutMs?: number
): Promise<HttpResponse> {
  const url = new URL(`${base(context)}/api/v1/query`);
  url.searchParams.set("query", expression);

  const headers: Record<string, string> = { accept: "application/json" };
  const header = await authorization(context);
  if (header) headers.authorization = header;

  const request: HttpRequest = { method: "GET", url: url.toString(), headers };
  return await context.http.send(timeoutMs === undefined ? request : { ...request, timeoutMs });
}

/** One instant query, reduced to the samples a record can be built from. */
async function query(context: ConnectorContext<PrometheusConfig>, expression: string): Promise<Sample[]> {
  const response = await ask(context, expression);

  const failure = failureForStatus(response.status);
  if (failure) throw new ConnectorError(failure.toUpperCase());

  const body = parsed(queryResponseSchema, response);
  if (body.data.result.length > maxSeriesPerQuery) throw new ConnectorError("RESPONSE_TOO_LARGE");

  return (
    body.data.result
      .map((series) => ({ labels: series.metric, value: Number(series.value[1]) }))
      // `NaN` and `+Inf` are ordinary answers from Prometheus -- a division by a counter that has
      // not been scraped twice yet. They are not numbers a record should carry.
      .filter((sample) => Number.isFinite(sample.value))
  );
}

/** Reads one field of one thing into the map, keyed by whatever identifies that thing. */
function collect(
  into: Map<string, Record<string, RecordValue>>,
  key: string | null,
  field: string,
  value: RecordValue | null
): void {
  if (!key || value === null) return;
  const data = into.get(key) ?? {};
  data[field] = value;
  into.set(key, data);
}

/**
 * The records, in a stable order, with the identifiers the store can actually hold.
 *
 * An identifier too long for the column is dropped and said out loud rather than truncated: two
 * long names truncated to the same prefix would be one thing from then on, and a screen would
 * report whichever was read last. The warning names the length, never the value -- a probed
 * target can be a URL with a token in it.
 */
function recordsFrom(
  context: ConnectorContext<PrometheusConfig>,
  prefix: string,
  entries: Map<string, Record<string, RecordValue>>
): ConnectorRecord[] {
  const records: ConnectorRecord[] = [];
  for (const [key, data] of entries) {
    const externalId = `${prefix}:${key}`;
    if (externalId.length > maxExternalIdLength) {
      context.logger.warn(
        { instanceId: context.instanceId, prefix, length: externalId.length },
        "prometheus identifier too long for the record store"
      );
      continue;
    }
    records.push({ externalId, data });
  }
  return records.sort((left, right) => compare(left.externalId, right.externalId));
}

/** One pass may not return more than we agreed to hold, and a state pass may not return part. */
function bounded(records: ConnectorRecord[]): OperationResult {
  if (records.length > maxRecordsPerRun) throw new ConnectorError("RESPONSE_TOO_LARGE");
  return { records, cursor: null };
}

/**
 * The machines named in the configuration, and only those.
 *
 * The filter is applied here rather than in the expression on purpose: a label goes into a PromQL
 * matcher as a regex, and an `instance` somebody typed into a form is not something to hand to a
 * query language. Nothing configured reaches the wire at all.
 */
async function pullHostMetrics(context: ConnectorContext<PrometheusConfig>): Promise<OperationResult> {
  const wanted = new Set(context.config.hostLabels);
  // No hosts named is not an empty read: it is a configuration that inventories no machines, and
  // asking anyway would spend a call on an answer we would throw away.
  if (wanted.size === 0) return { records: [], cursor: null };

  const hosts = new Map<string, Record<string, RecordValue>>();
  for (const [field, reader] of Object.entries(hostFields)) {
    for (const sample of await query(context, reader.expression)) {
      const label = sample.labels.instance;
      if (!label || !wanted.has(label)) continue;
      collect(hosts, label, field, reader.read(sample.value));
    }
  }

  return bounded(recordsFrom(context, "host", hosts));
}

/** The containers of the configured job. Without a job nobody said where to look, so nowhere. */
async function pullContainerState(context: ConnectorContext<PrometheusConfig>): Promise<OperationResult> {
  const job = context.config.containerJob;
  if (!job) return { records: [], cursor: null };

  const containers = new Map<string, Record<string, RecordValue>>();
  for (const [field, reader] of Object.entries(containerFields)) {
    for (const sample of await query(context, reader.expression)) {
      // cAdvisor publishes the root cgroup with an empty name, and it is not a container.
      const name = sample.labels.name;
      if (!name || sample.labels.job !== job) continue;
      collect(containers, name, field, reader.read(sample.value));
      collect(containers, name, "host", sample.labels.instance ?? null);
    }
  }

  return bounded(recordsFrom(context, "container", containers));
}

/**
 * What the outside world can see, and whether the backups ran.
 *
 * Three sources, one operation, because the three infrastructure rules of increment B3 read the
 * same kind of fact: something outside this process either answered or did not. `up` comes free
 * with Prometheus and covers the exporters; the blackbox series need a job to be named, or we
 * would scoop up somebody else's probes; the backup heartbeat needs nothing but the script.
 */
async function pullProbeState(context: ConnectorContext<PrometheusConfig>): Promise<OperationResult> {
  type Reading = { job: string; target: string; field: string; value: RecordValue };
  const readings: Reading[] = [];

  const push = (sample: Sample, field: string, value: RecordValue | null): void => {
    const target = probeTarget(sample.labels.instance ?? "");
    if (!target || value === null) return;
    readings.push({ job: sample.labels.job ?? "", target, field, value });
  };

  for (const sample of await query(context, scrapeUpExpression)) push(sample, "scrapeUp", truth(sample.value));

  const probeJob = context.config.probeJob;
  if (probeJob) {
    for (const [field, reader] of Object.entries(probeFields)) {
      for (const sample of await query(context, reader.expression)) {
        if (sample.labels.job !== probeJob) continue;
        push(sample, field, reader.read(sample.value));
      }
    }
  }

  // Two jobs can carry the same `instance`, and then one record describes both. Applying the
  // readings in sorted order makes which one wins a property of the data rather than of the order
  // an instance happened to answer in, and the record says whose job it ended up describing.
  readings.sort(
    (left, right) =>
      compare(left.job, right.job) || compare(left.target, right.target) || compare(left.field, right.field)
  );

  const targets = new Map<string, Record<string, RecordValue>>();
  for (const reading of readings) {
    collect(targets, reading.target, reading.field, reading.value);
    if (reading.job) collect(targets, reading.target, "job", reading.job);
  }

  const backups = new Map<string, Record<string, RecordValue>>();
  for (const sample of await query(context, backupExpression)) {
    collect(backups, sample.labels.backup_job ?? null, "lastSuccessAt", instant(sample.value));
  }

  return bounded([...recordsFrom(context, "probe", targets), ...recordsFrom(context, "backup", backups)]);
}

/**
 * The identity of a probed target, with any credentials taken out of it.
 *
 * A blackbox target is whatever the operator pointed the exporter at, and that can be a URL with
 * a password in it. This identifier goes to the database and to a screen, so the credential comes
 * out here -- before it is one. Anything that is not a URL is used as it stands: an `instance` is
 * usually `host:port`, and rewriting it would only make it stop matching.
 */
function probeTarget(instance: string): string | null {
  if (!instance) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(instance)) return instance;
  try {
    const url = new URL(instance);
    if (!url.username && !url.password) return instance;
    url.username = "";
    url.password = "";
    return url.toString();
  } catch {
    // Not parseable as a URL after all. It cannot carry userinfo we failed to strip either.
    return instance;
  }
}

export const prometheus = defineConnector<PrometheusConfig>({
  type: "prometheus",
  contractVersion: connectorContractVersion,
  configSchema,
  /** The order an operator is asked: the address first, because nothing works without it. */
  configFields: [
    { name: "baseUrl", kind: "url", group: "connection" },
    { name: "hostLabels", kind: "list", group: "behaviour" },
    { name: "containerJob", kind: "text", group: "behaviour" },
    { name: "probeJob", kind: "text", group: "behaviour" }
  ],
  /**
   * None of these is required. A Prometheus reachable on the operator's own network normally has
   * no authentication at all; the token exists for the one behind a proxy that does.
   */
  credentialKinds: ["api_token"],
  capabilities: {
    egress: { schemes: ["http", "https"], destination: "operator_allowlist" },
    /**
     * All three are `state`: each pass reads the whole of what it watches, and what it stops
     * naming expires. Nothing is polled more often than the alert sweep -- every two minutes --
     * could act on it, so a faster cadence would buy load rather than warning.
     */
    operations: {
      pull_host_metrics: { shape: "state", everySeconds: 2 * 60 },
      pull_container_state: { shape: "state", everySeconds: 5 * 60 },
      pull_probe_state: { shape: "state", everySeconds: 2 * 60 }
    },
    ingress: false
  },
  async health(context) {
    // The cheapest thing the query API can answer, and it goes through whatever authenticates in
    // front of it. `/-/healthy` would answer without a credential, which would report a healthy
    // instance we cannot actually read -- evidence of the wrong thing.
    const response = await ask(context, "vector(1)", 10_000);

    const failure = failureForStatus(response.status);
    return failure ? { status: "failed", failure } : { status: "ok" };
  },
  operations: {
    pull_host_metrics: (context) => pullHostMetrics(context),
    pull_container_state: (context) => pullContainerState(context),
    pull_probe_state: (context) => pullProbeState(context)
  }
});

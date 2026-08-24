import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { open, readFile, rename, writeFile } from "node:fs/promises";

export type CollectorConfig = {
  openCodeUrl: URL;
  openCodeUsername: string;
  openCodePassword: string | null;
  ingressUrl: URL;
  ingressSecret: string;
  statePath: string;
  timeoutMs: number;
};

type State = { version: 1; deviceId: string; projectSalt: string; watermarkMs: number; idsAtWatermark: string[] };
type Session = { id: string; projectKey: string };
export type SanitizedEvent = {
  id: string;
  occurredAt: string;
  provider: string;
  model: string;
  projectRef: string;
  tokens: { input: string; output: string; reasoning: string; cacheRead: string; cacheWrite: string };
};

export class CollectorError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}

const object = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
const text = (value: unknown, max: number): string | null =>
  typeof value === "string" && value.length > 0 && value.length <= max ? value : null;
const count = (value: unknown): string => {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return String(value);
  if (typeof value === "string" && /^\d+$/.test(value)) return value;
  return "0";
};

export function validateConfig(environment: NodeJS.ProcessEnv): CollectorConfig {
  const openCodeUrl = new URL(environment.OPENCODE_URL ?? "http://127.0.0.1:4096");
  if (openCodeUrl.protocol !== "http:" || !["127.0.0.1", "localhost", "::1"].includes(openCodeUrl.hostname))
    throw new CollectorError("OPENCODE_URL_NOT_LOOPBACK");
  const ingressUrl = new URL(environment.CONTROL_HUB_INGRESS_URL ?? "");
  const localIngress = ["127.0.0.1", "localhost", "::1"].includes(ingressUrl.hostname);
  if (ingressUrl.protocol !== "https:" && !(localIngress && ingressUrl.protocol === "http:"))
    throw new CollectorError("INGRESS_URL_NOT_HTTPS");
  const ingressSecret = environment.CONTROL_HUB_INGRESS_SECRET;
  if (!ingressSecret || ingressSecret.length < 32) throw new CollectorError("INGRESS_SECRET_INVALID");
  const statePath = environment.OPENCODE_COLLECTOR_STATE_PATH;
  if (!statePath) throw new CollectorError("STATE_PATH_REQUIRED");
  return {
    openCodeUrl,
    openCodeUsername: environment.OPENCODE_SERVER_USERNAME ?? "opencode",
    openCodePassword: environment.OPENCODE_SERVER_PASSWORD ?? null,
    ingressUrl,
    ingressSecret,
    statePath,
    timeoutMs: 10_000
  };
}

function freshState(): State {
  return {
    version: 1,
    deviceId: randomUUID(),
    projectSalt: randomBytes(32).toString("hex"),
    watermarkMs: 0,
    idsAtWatermark: []
  };
}

async function readState(path: string): Promise<State> {
  try {
    const parsed = object(JSON.parse(await readFile(path, "utf8")));
    const deviceId = text(parsed?.deviceId, 36);
    const projectSalt = text(parsed?.projectSalt, 64);
    if (
      parsed?.version !== 1 ||
      !deviceId ||
      !projectSalt ||
      typeof parsed.watermarkMs !== "number" ||
      !Number.isSafeInteger(parsed.watermarkMs) ||
      parsed.watermarkMs < 0 ||
      !Array.isArray(parsed.idsAtWatermark) ||
      !parsed.idsAtWatermark.every((id) => typeof id === "string" && id.length > 0 && id.length <= 200)
    )
      throw new CollectorError("STATE_INVALID");
    return {
      version: 1,
      deviceId,
      projectSalt,
      watermarkMs: parsed.watermarkMs,
      idsAtWatermark: parsed.idsAtWatermark.filter((id): id is string => typeof id === "string")
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return freshState();
    throw error;
  }
}

async function writeState(path: string, state: State) {
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(state)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, path);
}

function authHeaders(config: CollectorConfig): HeadersInit {
  return config.openCodePassword
    ? {
        authorization: `Basic ${Buffer.from(`${config.openCodeUsername}:${config.openCodePassword}`).toString("base64")}`
      }
    : {};
}

async function json(url: URL, headers: HeadersInit, timeoutMs: number): Promise<unknown> {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new CollectorError(`OPENCODE_HTTP_${response.status}`);
  return response.json();
}

export function sessionsFrom(value: unknown): Session[] {
  if (!Array.isArray(value)) throw new CollectorError("OPENCODE_SESSIONS_INVALID");
  return value.flatMap((candidate) => {
    const session = object(candidate);
    const id = text(session?.id, 200);
    const location = object(session?.location);
    const projectKey =
      text(location?.workspaceID, 500) ?? text(session?.projectID, 500) ?? text(location?.directory, 2000);
    return id && projectKey ? [{ id, projectKey }] : [];
  });
}

export function eventsFrom(value: unknown, session: Session, salt: string): SanitizedEvent[] {
  if (!Array.isArray(value)) throw new CollectorError("OPENCODE_MESSAGES_INVALID");
  const projectRef = createHmac("sha256", salt).update(session.projectKey).digest("hex");
  return value.flatMap((candidate) => {
    const wrapper = object(candidate);
    const info = object(wrapper?.info) ?? wrapper;
    if (!info || (info.role !== "assistant" && info.type !== "assistant")) return [];
    const id = text(info.id, 200);
    const time = object(info.time);
    const created = typeof time?.created === "number" ? time.created : null;
    const modelRef = object(info.model);
    const provider = text(modelRef?.providerID, 80) ?? text(info.providerID, 80);
    const model = text(modelRef?.id, 160) ?? text(info.modelID, 160);
    const tokens = object(info.tokens);
    const cache = object(tokens?.cache);
    if (!id || created === null || !Number.isFinite(created) || !provider || !model || !tokens) return [];
    return [
      {
        id,
        occurredAt: new Date(created).toISOString(),
        provider,
        model,
        projectRef,
        tokens: {
          input: count(tokens.input),
          output: count(tokens.output),
          reasoning: count(tokens.reasoning),
          cacheRead: count(cache?.read),
          cacheWrite: count(cache?.write)
        }
      }
    ];
  });
}

function unseen(event: SanitizedEvent, state: State): boolean {
  const at = Date.parse(event.occurredAt);
  return at > state.watermarkMs || (at === state.watermarkMs && !state.idsAtWatermark.includes(event.id));
}

function nextState(state: State, events: readonly SanitizedEvent[]): State {
  const watermarkMs = Math.max(state.watermarkMs, ...events.map((event) => Date.parse(event.occurredAt)));
  const alreadyAtWatermark = watermarkMs === state.watermarkMs ? state.idsAtWatermark : [];
  const idsAtWatermark = [
    ...new Set([
      ...alreadyAtWatermark,
      ...events.filter((event) => Date.parse(event.occurredAt) === watermarkMs).map((event) => event.id)
    ])
  ].sort();
  return { ...state, watermarkMs, idsAtWatermark };
}

async function deliver(config: CollectorConfig, state: State, events: SanitizedEvent[]) {
  const ids = events
    .map((event) => event.id)
    .sort()
    .join("\n");
  const batchId = createHash("sha256").update(`${state.deviceId}\n${ids}`).digest("hex");
  const body = JSON.stringify({ schemaVersion: 1, batchId, deviceId: state.deviceId, events });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac("sha256", config.ingressSecret).update(`${timestamp}.${body}`).digest("hex");
  const response = await fetch(config.ingressUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-control-hub-timestamp": timestamp,
      "x-control-hub-signature": signature
    },
    body,
    signal: AbortSignal.timeout(config.timeoutMs)
  });
  if (response.status !== 202) throw new CollectorError(`INGRESS_HTTP_${response.status}`);
}

export async function collect(config: CollectorConfig): Promise<{ delivered: number }> {
  const lock = await open(`${config.statePath}.lock`, "wx", 0o600).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "EEXIST") throw new CollectorError("COLLECTOR_ALREADY_RUNNING");
    throw error;
  });
  try {
    let state = await readState(config.statePath);
    const sessionsUrl = new URL("session", `${config.openCodeUrl.toString().replace(/\/$/, "")}/`);
    const sessions = sessionsFrom(await json(sessionsUrl, authHeaders(config), config.timeoutMs));
    const events: SanitizedEvent[] = [];
    for (const session of sessions) {
      const messagesUrl = new URL(`session/${encodeURIComponent(session.id)}/message?limit=1000`, sessionsUrl);
      events.push(
        ...eventsFrom(await json(messagesUrl, authHeaders(config), config.timeoutMs), session, state.projectSalt)
      );
    }
    const pending = events
      .filter((event) => unseen(event, state))
      .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
    let delivered = 0;
    for (let offset = 0; offset < pending.length; offset += 500) {
      const batch = pending.slice(offset, offset + 500);
      await deliver(config, state, batch);
      state = nextState(state, batch);
      await writeState(config.statePath, state);
      delivered += batch.length;
    }
    return { delivered };
  } finally {
    await lock.close();
    await import("node:fs/promises").then(({ unlink }) => unlink(`${config.statePath}.lock`).catch(() => undefined));
  }
}

import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export type PluginConfig = {
  schemaVersion: 1;
  ingressUrl: string;
  ingressSecret: string;
  deviceId: string;
  projectSalt: string;
};

export type SanitizedEvent = {
  id: string;
  occurredAt: string;
  provider: string;
  model: string;
  projectRef: string;
  tokens: { input: string; output: string; reasoning: string; cacheRead: string; cacheWrite: string };
};

const record = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
const text = (value: unknown, max: number): string | null =>
  typeof value === "string" && value.length > 0 && value.length <= max ? value : null;
const count = (value: unknown): string =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? String(value)
    : typeof value === "string" && /^\d+$/.test(value)
      ? value
      : "0";

export function createConfig(ingressUrl: string, ingressSecret: string): PluginConfig {
  const url = new URL(ingressUrl);
  const local = ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) throw new Error("INGRESS_URL_NOT_HTTPS");
  if (ingressSecret.length < 32) throw new Error("INGRESS_SECRET_INVALID");
  return {
    schemaVersion: 1,
    ingressUrl: url.href,
    ingressSecret,
    deviceId: randomUUID(),
    projectSalt: randomBytes(32).toString("hex")
  };
}

export async function writeConfig(path: string, config: PluginConfig): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(config)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, path);
  await chmod(path, 0o600);
}

export async function installPlugin(configPath: string, packageName = "@control-hub/opencode@0.2.0"): Promise<void> {
  let current: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(await readFile(configPath, "utf8"));
    const value = record(parsed);
    if (!value) throw new Error("OPENCODE_CONFIG_INVALID");
    current = value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT")
      throw new Error("OPENCODE_CONFIG_NOT_JSON", { cause: error });
  }
  const existing = current.plugin;
  if (existing !== undefined && (!Array.isArray(existing) || !existing.every((item) => typeof item === "string")))
    throw new Error("OPENCODE_PLUGIN_CONFIG_INVALID");
  const plugins = Array.isArray(existing)
    ? existing.filter((item): item is string => typeof item === "string")
    : undefined;
  if (!plugins?.includes(packageName)) current.plugin = [...(plugins ?? []), packageName];
  await mkdir(dirname(configPath), { recursive: true });
  const temporary = `${configPath}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(current, null, 2)}\n`, "utf8");
  await rename(temporary, configPath);
}

export async function readConfig(path: string): Promise<PluginConfig> {
  const value: unknown = JSON.parse(await readFile(path, "utf8"));
  const parsed = record(value);
  const ingressUrl = text(parsed?.ingressUrl, 2048);
  const ingressSecret = text(parsed?.ingressSecret, 8192);
  const deviceId = text(parsed?.deviceId, 36);
  const projectSalt = text(parsed?.projectSalt, 64);
  if (parsed?.schemaVersion !== 1 || !ingressUrl || !ingressSecret || !deviceId || !projectSalt)
    throw new Error("CONFIG_INVALID");
  return { schemaVersion: 1, ingressUrl, ingressSecret, deviceId, projectSalt };
}

export function eventsFrom(messages: unknown, projectKey: string, projectSalt: string): SanitizedEvent[] {
  if (!Array.isArray(messages)) return [];
  const projectRef = createHmac("sha256", projectSalt).update(projectKey).digest("hex");
  const events: SanitizedEvent[] = [];
  for (const item of messages) {
    const envelope = record(item);
    const info = record(envelope?.info ?? item);
    if (info?.role !== "assistant") continue;
    const id = text(info.id, 200);
    const time = record(info.time);
    const created = time?.created;
    const modelInfo = record(info.model);
    const provider = text(modelInfo?.providerID ?? info.providerID, 80);
    const model = text(modelInfo?.modelID ?? modelInfo?.id ?? info.modelID, 160);
    const tokens = record(info.tokens);
    const cache = record(tokens?.cache);
    if (!id || typeof created !== "number" || !Number.isSafeInteger(created) || !provider || !model) continue;
    events.push({
      id,
      occurredAt: new Date(created).toISOString(),
      provider,
      model,
      projectRef,
      tokens: {
        input: count(tokens?.input),
        output: count(tokens?.output),
        reasoning: count(tokens?.reasoning),
        cacheRead: count(cache?.read),
        cacheWrite: count(cache?.write)
      }
    });
  }
  return events.sort((left, right) => left.id.localeCompare(right.id));
}

export function buildBatch(config: PluginConfig, events: readonly SanitizedEvent[]) {
  const fingerprint = createHash("sha256").update(JSON.stringify(events)).digest("hex");
  return {
    schemaVersion: 1 as const,
    batchId: `plugin:${config.deviceId}:${fingerprint}`,
    deviceId: config.deviceId,
    events
  };
}

export async function deliver(config: PluginConfig, events: readonly SanitizedEvent[]): Promise<number> {
  if (events.length === 0) return 0;
  let delivered = 0;
  for (let index = 0; index < events.length; index += 500) {
    const body = JSON.stringify(buildBatch(config, events.slice(index, index + 500)));
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
      signal: AbortSignal.timeout(5_000)
    });
    if (response.status !== 202) throw new Error(`INGRESS_HTTP_${response.status}`);
    delivered += Math.min(500, events.length - index);
  }
  return delivered;
}

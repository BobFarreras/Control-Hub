/**
 * The daily look at whether a newer version exists.
 *
 * `docs/specifications/deployment.md` (D5) settles the shape of this and its three conditions are
 * not options:
 *
 * 1. **The worker does it, never the browser.** With the browser, every person who opens Control
 *    Hub hands their IP to GitHub without knowing. That is not an implementation detail -- it is
 *    the difference between asking a question yourself and asking it on behalf of your users.
 * 2. **Nothing is sent.** A `GET` of a static file: no version, no identifier, no count of
 *    anything, no body. What is revealed anyway is that this server exists and its IP, which
 *    asking cannot avoid -- and that is why the third condition exists.
 * 3. **It can be switched off** with a documented variable, and `docs/runbooks/installation.md`
 *    says exactly what leaves and where it goes.
 *
 * The comparison happens here. The file is the same file for every installation in the world,
 * which is the property that makes «nothing is sent» true rather than merely intended: a request
 * that carried anything would have to be answered differently, and this one cannot be.
 */
import {
  isNewerVersion,
  parseReleaseManifest,
  parseUpdateCheckState,
  updateCheckStateKey,
  updateCheckStateTtlSeconds
} from "@control-hub/contracts/release";
import type { UpdateCheckState } from "@control-hub/contracts/release";

export const updateCheckJobName = "installation-update-check";

/**
 * Where the manifest is read from. A constant in the source, and not a setting.
 *
 * `deploy/update.sh` takes an override because it is typed by a person who can see what they are
 * pointing it at. This runs unattended, so a configurable URL would be a way to point every
 * installation at a manifest of somebody else's choosing, and the only thing it would buy is a
 * mirror nobody has asked for. It is also what lets the runbook state exactly one destination.
 */
export const releaseManifestUrl = "https://github.com/BobFarreras/Control-Hub/releases/latest/download/release.json";

/**
 * The floor under «once a day», enforced here rather than by the schedule alone.
 *
 * A schedule is a promise about the common case. This is the promise itself: any number of
 * restarts, replicas or manual triggers cannot turn the daily question into an hourly one,
 * because a check that finds a recent answer sends no request at all.
 */
export const minimumCheckIntervalMs = 20 * 60 * 60 * 1000;

/** How long to wait for a file that is either there or not. */
const requestTimeoutMs = 10_000;

export type UpdateCheckStore = {
  read(): Promise<UpdateCheckState | null>;
  write(state: UpdateCheckState): Promise<void>;
};

export type UpdateCheckOutcome =
  | { status: "disabled" }
  | { status: "recent"; checkedAt: string }
  | { status: "current"; version: string }
  | { status: "available"; version: string }
  | { status: "unreachable"; reason: string };

export type UpdateCheckOptions = {
  /** The version this installation runs, from the same stamp the API reports. */
  version: string;
  store: UpdateCheckStore;
  enabled: boolean;
  /** Injected so the tests can run the real function without reaching the network. */
  fetch?: typeof globalThis.fetch;
  now?: () => Date;
};

/**
 * One pass: read what is remembered, ask if it is stale, and remember what came back.
 *
 * Every failure answers `unreachable` and leaves the stored state untouched. That direction is
 * deliberate. A check that cannot reach GitHub knows nothing new, and overwriting a real pending
 * update with «nothing found» because a DNS lookup failed would turn an outage into a silence --
 * which is the one failure a banner exists to prevent.
 */
export async function runUpdateCheck(options: UpdateCheckOptions): Promise<UpdateCheckOutcome> {
  if (!options.enabled) return { status: "disabled" };

  const now = options.now?.() ?? new Date();
  const stored = await options.store.read();
  if (stored) {
    const since = now.getTime() - Date.parse(stored.checkedAt);
    if (since >= 0 && since < minimumCheckIntervalMs) return { status: "recent", checkedAt: stored.checkedAt };
  }

  const request = options.fetch ?? globalThis.fetch;
  let text: string;
  try {
    // No headers that describe this installation, and none that could. `accept` says what shape
    // is wanted; nothing here says who is asking.
    const response = await request(releaseManifestUrl, {
      headers: { accept: "application/json" },
      redirect: "follow",
      signal: AbortSignal.timeout(requestTimeoutMs)
    });
    if (!response.ok) return { status: "unreachable", reason: `HTTP ${response.status}` };
    text = await response.text();
  } catch (error) {
    return { status: "unreachable", reason: error instanceof Error ? error.message : "request failed" };
  }

  let version: string;
  let available: UpdateCheckState["available"];
  try {
    const manifest = parseReleaseManifest(text);
    version = manifest.version;
    available = isNewerVersion(manifest.version, options.version)
      ? {
          version: manifest.version,
          released: manifest.released,
          migrations: manifest.work.migrations,
          configuration: manifest.work.configuration
        }
      : null;
  } catch (error) {
    return { status: "unreachable", reason: error instanceof Error ? error.message : "unreadable manifest" };
  }

  await options.store.write({ checkedAt: now.toISOString(), available });
  return available ? { status: "available", version } : { status: "current", version };
}

/**
 * The store, over the Valkey connection the worker already has.
 *
 * Typed structurally rather than against ioredis so the pass above can be tested without one.
 * The expiry is set on every write, so the clock restarts each time somebody looks: a result
 * only ages out when the checks themselves have stopped.
 */
export function valkeyUpdateStore(client: {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: "EX", seconds: number): Promise<unknown>;
}): UpdateCheckStore {
  return {
    async read() {
      const text = await client.get(updateCheckStateKey);
      return text === null ? null : parseUpdateCheckState(text);
    },
    async write(state) {
      await client.set(updateCheckStateKey, JSON.stringify(state), "EX", updateCheckStateTtlSeconds);
    }
  };
}

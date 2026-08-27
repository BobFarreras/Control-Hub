import type { UpdateCheckState } from "@control-hub/contracts/release";
import { describe, expect, it, vi } from "vitest";
import { minimumCheckIntervalMs, releaseManifestUrl, runUpdateCheck, valkeyUpdateStore } from "./update-check.js";

const digest = (byte: string) => `sha256:${byte.repeat(64)}`;

function manifest(version: string, work = { migrations: 2, configuration: true }) {
  return JSON.stringify({
    schema: 1,
    version,
    released: "2026-08-27T10:00:00Z",
    commit: "a".repeat(40),
    images: Object.fromEntries(
      ["api", "worker", "migrate", "web"].map((service, index) => [
        service,
        `ghcr.io/bobfarreras/control-hub-${service}@${digest(String(index + 1))}`
      ])
    ),
    work
  });
}

/** A store that remembers, and counts what was asked of it. */
function store(initial: UpdateCheckState | null = null) {
  let state = initial;
  const writes: UpdateCheckState[] = [];
  return {
    writes,
    get state() {
      return state;
    },
    read: () => Promise.resolve(state),
    write: (next: UpdateCheckState) => {
      writes.push(next);
      state = next;
      return Promise.resolve();
    }
  };
}

const answering = (body: string, init: ResponseInit = {}) => vi.fn(() => Promise.resolve(new Response(body, init)));
const at = (instant: string) => () => new Date(instant);

describe("the daily update check", () => {
  it("sends nothing at all when it is switched off", async () => {
    // The whole of the third condition D5 attaches to checking: off has to mean no request, not
    // a request whose answer is ignored.
    const fetch = answering(manifest("2.0.0"));
    const remembered = store();
    const outcome = await runUpdateCheck({ version: "1.0.0", store: remembered, enabled: false, fetch });

    expect(outcome).toEqual({ status: "disabled" });
    expect(fetch).not.toHaveBeenCalled();
    expect(remembered.writes).toEqual([]);
  });

  it("asks for a file and tells it nothing", async () => {
    // The second condition, asserted on the request itself. There is no body, no method other
    // than a plain GET, and no header that says which installation is asking or what it runs.
    const fetch = answering(manifest("1.1.0"));
    await runUpdateCheck({ version: "1.0.0", store: store(), enabled: true, fetch });

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(releaseManifestUrl);
    expect(new URL(url).search).toBe("");
    expect(init.body ?? null).toBeNull();
    expect(init.method ?? "GET").toBe("GET");
    expect(Object.keys(init.headers as Record<string, string>)).toEqual(["accept"]);
  });

  it("does not ask again when it already has a recent answer", async () => {
    // The schedule says once a day; this is what makes it true under restarts and replicas.
    const fetch = answering(manifest("2.0.0"));
    const remembered = store({ checkedAt: "2026-08-27T08:00:00.000Z", available: null });
    const outcome = await runUpdateCheck({
      version: "1.0.0",
      store: remembered,
      enabled: true,
      fetch,
      now: at("2026-08-27T12:00:00.000Z")
    });

    expect(outcome).toEqual({ status: "recent", checkedAt: "2026-08-27T08:00:00.000Z" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("asks again once the answer is a day old", async () => {
    const fetch = answering(manifest("1.1.0"));
    const checkedAt = new Date(Date.parse("2026-08-27T12:00:00.000Z") - minimumCheckIntervalMs).toISOString();
    const remembered = store({ checkedAt, available: null });
    const outcome = await runUpdateCheck({
      version: "1.0.0",
      store: remembered,
      enabled: true,
      fetch,
      now: at("2026-08-27T12:00:00.000Z")
    });

    expect(outcome).toEqual({ status: "available", version: "1.1.0" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("remembers what work the new version represents, not merely that it exists", async () => {
    // The banner exists to say this. A notice that only says «there is a new version» moves the
    // decision without giving anybody anything to decide it with.
    const fetch = answering(manifest("1.1.0", { migrations: 3, configuration: true }));
    const remembered = store();
    await runUpdateCheck({
      version: "1.0.0",
      store: remembered,
      enabled: true,
      fetch,
      now: at("2026-08-27T12:00:00.000Z")
    });

    expect(remembered.state).toEqual({
      checkedAt: "2026-08-27T12:00:00.000Z",
      available: { version: "1.1.0", released: "2026-08-27T10:00:00Z", migrations: 3, configuration: true }
    });
  });

  it("records that it looked and found nothing, which is a different thing from not looking", async () => {
    const fetch = answering(manifest("1.0.0"));
    const remembered = store();
    const outcome = await runUpdateCheck({
      version: "1.0.0",
      store: remembered,
      enabled: true,
      fetch,
      now: at("2026-08-27T12:00:00.000Z")
    });

    expect(outcome).toEqual({ status: "current", version: "1.0.0" });
    expect(remembered.state).toEqual({ checkedAt: "2026-08-27T12:00:00.000Z", available: null });
  });

  it("clears a pending update once the installation has caught up with it", async () => {
    // Without this the banner outlives the update by up to a week, and a banner that lies once is
    // a banner nobody reads again.
    const remembered = store({
      checkedAt: "2026-08-20T12:00:00.000Z",
      available: { version: "1.1.0", released: "2026-08-20T10:00:00Z", migrations: 1, configuration: false }
    });
    await runUpdateCheck({
      version: "1.1.0",
      store: remembered,
      enabled: true,
      fetch: answering(manifest("1.1.0")),
      now: at("2026-08-27T12:00:00.000Z")
    });

    expect(remembered.state?.available).toBeNull();
  });

  it("never points backwards", async () => {
    // An installation deliberately ahead of the published tag -- an `edge` image being tested --
    // must not be told to «update» to something older.
    const remembered = store();
    const outcome = await runUpdateCheck({
      version: "1.2.0",
      store: remembered,
      enabled: true,
      fetch: answering(manifest("1.1.0")),
      now: at("2026-08-27T12:00:00.000Z")
    });

    expect(outcome).toEqual({ status: "current", version: "1.1.0" });
    expect(remembered.state?.available).toBeNull();
  });

  it("keeps what it knew when the request fails", async () => {
    // The direction matters. A check that could not reach GitHub knows nothing new, and turning a
    // real pending update into silence because a DNS lookup failed is the one failure a banner
    // exists to prevent.
    const known: UpdateCheckState = {
      checkedAt: "2026-08-20T12:00:00.000Z",
      available: { version: "1.1.0", released: "2026-08-20T10:00:00Z", migrations: 1, configuration: false }
    };
    // The reason is asserted as well as the outcome, because the reason is the whole of what
    // somebody reading the log has to work from: «unreachable» on its own does not separate a
    // release that was never published from a proxy answering 403 from a manifest we refused.
    const failures: Record<string, [ReturnType<typeof vi.fn>, RegExp]> = {
      "a 404": [answering("not found", { status: 404 }), /404/],
      "a 500": [answering("boom", { status: 500 }), /500/],
      "a manifest that is not one": [answering('{"schema":1,"version":"latest"}'), /RELEASE_MANIFEST_INVALID/],
      "a manifest from two registries": [
        answering(
          manifest("2.0.0").replace(
            `ghcr.io/bobfarreras/control-hub-web@${digest("4")}`,
            `docker.io/someone/control-hub-web@${digest("4")}`
          )
        ),
        /registries/
      ],
      "the network refusing": [vi.fn(() => Promise.reject(new Error("ECONNREFUSED"))), /ECONNREFUSED/]
    };

    for (const [what, [fetch, reason]] of Object.entries(failures)) {
      const remembered = store({ ...known });
      const outcome = await runUpdateCheck({
        version: "1.0.0",
        store: remembered,
        enabled: true,
        fetch: fetch as unknown as typeof globalThis.fetch,
        now: at("2026-08-27T12:00:00.000Z")
      });

      expect(outcome, what).toMatchObject({ status: "unreachable", reason: expect.stringMatching(reason) });
      expect(remembered.writes, what).toEqual([]);
      expect(remembered.state, what).toEqual(known);
    }
  });
});

describe("where the answer is kept", () => {
  it("writes one key with an expiry and reads it back", async () => {
    const client = {
      values: new Map<string, string>(),
      get(key: string) {
        return Promise.resolve(this.values.get(key) ?? null);
      },
      set(key: string, value: string, mode: "EX", seconds: number) {
        expect(mode).toBe("EX");
        // An expiry on every write, so a result only ages out when the checks have stopped.
        expect(seconds).toBeGreaterThan(0);
        this.values.set(key, value);
        return Promise.resolve("OK");
      }
    };
    const kept = valkeyUpdateStore(client);
    const state: UpdateCheckState = {
      checkedAt: "2026-08-27T12:00:00.000Z",
      available: { version: "1.1.0", released: "2026-08-27T10:00:00Z", migrations: 2, configuration: true }
    };

    expect(await kept.read()).toBeNull();
    await kept.write(state);
    expect(await kept.read()).toEqual(state);
    expect(client.values.size).toBe(1);
  });

  it("forgets a stored value it cannot read rather than showing it", async () => {
    const client = {
      get: () => Promise.resolve('{"checkedAt":"whenever","available":{"version":"none"}}'),
      set: () => Promise.resolve("OK")
    };
    expect(await valkeyUpdateStore(client).read()).toBeNull();
  });
});

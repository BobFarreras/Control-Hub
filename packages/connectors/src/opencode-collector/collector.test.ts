import { createHmac } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { collect, eventsFrom, sessionsFrom, validateConfig } from "./collector.js";

afterEach(() => vi.unstubAllGlobals());

describe("OpenCode response minimization", () => {
  it("rebuilds an event without copying transcript, paths, diffs or commands", () => {
    const [event] = eventsFrom(
      [
        {
          info: {
            id: "message-1",
            role: "assistant",
            time: { created: 1787558400000 },
            model: { providerID: "anthropic", id: "claude-sonnet" },
            tokens: { input: 10, output: 3, reasoning: 1, cache: { read: 5, write: 2 } },
            content: "private answer",
            command: "printenv"
          },
          parts: [{ text: "private prompt" }],
          diff: "private patch"
        }
      ],
      { id: "session-1", projectKey: "C:/private/customer" },
      "salt"
    );
    expect(event).toEqual({
      id: "message-1",
      occurredAt: "2026-08-24T08:00:00.000Z",
      provider: "anthropic",
      model: "claude-sonnet",
      projectRef: createHmac("sha256", "salt").update("C:/private/customer").digest("hex"),
      tokens: { input: "10", output: "3", reasoning: "1", cacheRead: "5", cacheWrite: "2" }
    });
    expect(JSON.stringify(event)).not.toMatch(/private|prompt|content|command|diff|directory/i);
  });

  it("takes a project key without exposing it", () => {
    expect(sessionsFrom([{ id: "session-1", projectID: "project-private", title: "a private task" }])).toEqual([
      { id: "session-1", projectKey: "project-private" }
    ]);
  });
});

describe("collector configuration", () => {
  const valid = {
    CONTROL_HUB_INGRESS_URL: "https://hub.example.test/api/v1/webhooks/public",
    CONTROL_HUB_INGRESS_SECRET: "s".repeat(64),
    OPENCODE_COLLECTOR_STATE_PATH: "state.json"
  };

  it("only reads OpenCode from loopback and only sends remotely over HTTPS", () => {
    expect(() => validateConfig({ ...valid, OPENCODE_URL: "http://10.0.0.4:4096" })).toThrow(
      "OPENCODE_URL_NOT_LOOPBACK"
    );
    expect(() => validateConfig({ ...valid, CONTROL_HUB_INGRESS_URL: "http://hub.example.test/webhook" })).toThrow(
      "INGRESS_URL_NOT_HTTPS"
    );
  });
});

it("signs a sanitized batch and advances state only after a 202", async () => {
  const directory = await mkdtemp(join(tmpdir(), "control-hub-opencode-"));
  try {
    const statePath = join(directory, "state.json");
    const secret = "collector-secret-that-is-long-enough";
    const calls: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal("fetch", (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      calls.push({ url, ...(init ? { init } : {}) });
      if (url.endsWith("/session"))
        return Promise.resolve(
          new Response(JSON.stringify([{ id: "session-1", location: { directory: "C:/private/repo" } }]))
        );
      if (url.includes("/message?"))
        return Promise.resolve(
          new Response(
            JSON.stringify([
              {
                info: {
                  id: "message-1",
                  role: "assistant",
                  time: { created: 1787558400000 },
                  model: { providerID: "openai", id: "gpt-5" },
                  tokens: { input: 2, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
                  content: "must stay local"
                },
                parts: [{ text: "must stay local too" }]
              }
            ])
          )
        );
      return Promise.resolve(new Response(null, { status: 202 }));
    });

    const result = await collect({
      openCodeUrl: new URL("http://127.0.0.1:4096"),
      openCodeUsername: "opencode",
      openCodePassword: null,
      ingressUrl: new URL("https://hub.example.test/api/v1/webhooks/public"),
      ingressSecret: secret,
      statePath,
      timeoutMs: 1_000
    });
    expect(result).toEqual({ delivered: 1 });
    const sent = calls.at(-1)?.init;
    expect(typeof sent?.body).toBe("string");
    const body = typeof sent?.body === "string" ? sent.body : "";
    expect(body).not.toContain("must stay local");
    expect(body).not.toContain("C:/private/repo");
    const timestamp = String((sent?.headers as Record<string, string>)["x-control-hub-timestamp"]);
    expect((sent?.headers as Record<string, string>)["x-control-hub-signature"]).toBe(
      createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")
    );
    expect(JSON.parse(await readFile(statePath, "utf8"))).toMatchObject({ watermarkMs: 1787558400000 });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

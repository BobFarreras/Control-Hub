import { createHmac } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildBatch, createConfig, deliver, eventsFrom, installPlugin, readConfig, writeConfig } from "./core.js";

afterEach(() => vi.unstubAllGlobals());

describe("plugin configuration", () => {
  it("accepts remote HTTPS and rejects a remote clear-text endpoint", () => {
    expect(createConfig("https://hub.example.test/webhook", "s".repeat(32))).toMatchObject({ schemaVersion: 1 });
    expect(() => createConfig("http://hub.example.test/webhook", "s".repeat(32))).toThrow("INGRESS_URL_NOT_HTTPS");
  });

  it("writes a private, round-trippable configuration", async () => {
    const directory = await mkdtemp(join(tmpdir(), "control-hub-plugin-"));
    try {
      const path = join(directory, "nested", "config.json");
      const config = createConfig("https://hub.example.test/webhook", "s".repeat(32));
      await writeConfig(path, config);
      expect(await readConfig(path)).toEqual(config);
      if (process.platform !== "win32") expect((await stat(path)).mode & 0o777).toBe(0o600);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("adds itself to an existing OpenCode configuration without removing settings", async () => {
    const directory = await mkdtemp(join(tmpdir(), "control-hub-plugin-"));
    try {
      const path = join(directory, "opencode.json");
      await writeFile(path, JSON.stringify({ theme: "system", plugin: ["existing-plugin"] }), "utf8");
      await installPlugin(path);
      await installPlugin(path);
      expect(JSON.parse(await readFile(path, "utf8"))).toEqual({
        theme: "system",
        plugin: ["existing-plugin", "@control-hub/opencode@0.2.0"]
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe("privacy-minimized delivery", () => {
  const config = {
    schemaVersion: 1 as const,
    ingressUrl: "https://hub.example.test/webhook",
    ingressSecret: "collector-secret-that-is-long-enough",
    deviceId: "2c1bca87-0e5e-4ee4-b53f-c545384f27b8",
    projectSalt: "salt"
  };

  it("rebuilds assistant usage without transcript, paths, parts or commands", () => {
    const events = eventsFrom(
      [
        {
          info: {
            id: "message-1",
            role: "assistant",
            time: { created: 1787558400000 },
            model: { providerID: "anthropic", modelID: "claude-sonnet" },
            tokens: { input: 10, output: 3, reasoning: 1, cache: { read: 5, write: 2 } },
            content: "private response"
          },
          parts: [{ text: "private prompt" }],
          command: "printenv"
        }
      ],
      "C:/customer/private-project",
      config.projectSalt
    );
    expect(events).toEqual([
      {
        id: "message-1",
        occurredAt: "2026-08-24T08:00:00.000Z",
        provider: "anthropic",
        model: "claude-sonnet",
        projectRef: createHmac("sha256", "salt").update("C:/customer/private-project").digest("hex"),
        tokens: { input: "10", output: "3", reasoning: "1", cacheRead: "5", cacheWrite: "2" }
      }
    ]);
    expect(JSON.stringify(events)).not.toMatch(/private|prompt|content|command|customer/i);
  });

  it("makes unchanged batches deterministic and signs the exact sanitized body", async () => {
    const events = eventsFrom(
      [
        {
          info: {
            id: "message-1",
            role: "assistant",
            time: { created: 1787558400000 },
            model: { providerID: "openai", modelID: "gpt-5" },
            tokens: { input: 2, output: 1 }
          }
        }
      ],
      "project",
      config.projectSalt
    );
    expect(buildBatch(config, events).batchId).toBe(buildBatch(config, events).batchId);
    let sent: RequestInit | undefined;
    vi.stubGlobal("fetch", (_input: string | URL | Request, init?: RequestInit) => {
      sent = init;
      return Promise.resolve(new Response(null, { status: 202 }));
    });
    expect(await deliver(config, events)).toBe(1);
    expect(typeof sent?.body).toBe("string");
    const body = typeof sent?.body === "string" ? sent.body : "";
    expect(JSON.parse(body)).toEqual(buildBatch(config, events));
    const headers = sent?.headers as Record<string, string>;
    expect(headers["x-control-hub-signature"]).toBe(
      createHmac("sha256", config.ingressSecret).update(`${headers["x-control-hub-timestamp"]}.${body}`).digest("hex")
    );
  });
});

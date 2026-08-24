import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { createConfig, writeConfig } from "./core.js";
import { ControlHubPlugin } from "./index.js";

const originalPath = process.env.CONTROL_HUB_OPENCODE_CONFIG;
afterEach(() => {
  vi.unstubAllGlobals();
  if (originalPath === undefined) delete process.env.CONTROL_HUB_OPENCODE_CONFIG;
  else process.env.CONTROL_HUB_OPENCODE_CONFIG = originalPath;
});

it("delivers only on session idle and never breaks OpenCode when delivery fails", async () => {
  const directory = await mkdtemp(join(tmpdir(), "control-hub-plugin-"));
  try {
    const path = join(directory, "config.json");
    process.env.CONTROL_HUB_OPENCODE_CONFIG = path;
    await writeConfig(path, createConfig("https://hub.example.test/webhook", "s".repeat(32)));
    const messages = vi.fn(() =>
      Promise.resolve({
        data: [
          {
            info: {
              id: "message-1",
              role: "assistant",
              time: { created: 1787558400000 },
              model: { providerID: "openai", modelID: "gpt-5" },
              tokens: { input: 2, output: 1 }
            },
            parts: [{ text: "never sent" }]
          }
        ]
      })
    );
    const log = vi.fn(() => Promise.resolve());
    vi.stubGlobal("fetch", () => Promise.resolve(new Response(null, { status: 503 })));
    const plugin = await ControlHubPlugin({
      directory: "C:/private/project",
      worktree: "C:/private/project",
      client: { session: { messages }, app: { log } }
    });
    await plugin.event({ event: { type: "session.created", properties: { sessionID: "session-1" } } });
    expect(messages).not.toHaveBeenCalled();
    await expect(
      plugin.event({ event: { type: "session.idle", properties: { sessionID: "session-1" } } })
    ).resolves.toBeUndefined();
    expect(messages).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledWith({
      body: { service: "control-hub-opencode", level: "warn", message: "DELIVERY_DEFERRED" }
    });
    log.mockRejectedValueOnce(new Error("logger unavailable"));
    await expect(
      plugin.event({ event: { type: "session.idle", properties: { sessionID: "session-1" } } })
    ).resolves.toBeUndefined();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

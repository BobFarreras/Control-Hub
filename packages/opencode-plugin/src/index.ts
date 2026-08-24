import { homedir } from "node:os";
import { join } from "node:path";
import { deliver, eventsFrom, readConfig } from "./core.js";

type PluginContext = {
  directory: string;
  worktree: string;
  client: {
    session: { messages(input: { path: { id: string }; query?: { directory?: string } }): Promise<unknown> };
    app?: { log(input: { body: { service: string; level: string; message: string } }): Promise<unknown> };
  };
};

type PluginEvent = { event: { type: string; properties?: { sessionID?: string } } };

export const ControlHubPlugin = ({ client, directory, worktree }: PluginContext) =>
  Promise.resolve({
    event: async ({ event }: PluginEvent) => {
      if (event.type !== "session.idle") return;
      const sessionID = event.properties?.sessionID;
      if (!sessionID) return;
      try {
        const configDirectory = process.env.CONTROL_HUB_OPENCODE_CONFIG_DIR ?? join(homedir(), ".config", "opencode");
        const configPath = process.env.CONTROL_HUB_OPENCODE_CONFIG ?? join(configDirectory, "control-hub.json");
        const config = await readConfig(configPath);
        const response = await client.session.messages({ path: { id: sessionID }, query: { directory } });
        const envelope = response as { data?: unknown };
        const messages = envelope && typeof envelope === "object" && "data" in envelope ? envelope.data : response;
        await deliver(config, eventsFrom(messages, worktree || directory, config.projectSalt));
      } catch {
        try {
          await client.app?.log({
            body: { service: "control-hub-opencode", level: "warn", message: "DELIVERY_DEFERRED" }
          });
        } catch {
          return;
        }
      }
    }
  });

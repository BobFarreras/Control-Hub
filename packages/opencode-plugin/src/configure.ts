#!/usr/bin/env node
import { homedir } from "node:os";
import { join } from "node:path";
import { createConfig, installPlugin, writeConfig } from "./core.js";

const args = process.argv.slice(2);
const value = (name: string) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

async function hiddenSecret(): Promise<string> {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== "function")
    throw new Error("INGRESS_SECRET_REQUIRED");
  process.stdout.write("Control Hub signing secret: ");
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return new Promise((resolve, reject) => {
    let secret = "";
    const finish = () => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write("\n");
    };
    process.stdin.on("data", (chunk: Buffer) => {
      for (const byte of chunk) {
        if (byte === 3) {
          finish();
          reject(new Error("CONFIGURE_CANCELLED"));
          return;
        }
        if (byte === 13 || byte === 10) {
          finish();
          resolve(secret);
          return;
        }
        if (byte === 8 || byte === 127) secret = secret.slice(0, -1);
        else secret += String.fromCharCode(byte);
      }
    });
  });
}

try {
  if (args[0] !== "configure") throw new Error("USAGE: configure --url <url>");
  const url = value("--url");
  if (!url) throw new Error("CONFIG_ARGUMENTS_REQUIRED");
  const secret = value("--secret") ?? (await hiddenSecret());
  const directory = process.env.CONTROL_HUB_OPENCODE_CONFIG_DIR ?? join(homedir(), ".config", "opencode");
  const path = process.env.CONTROL_HUB_OPENCODE_CONFIG ?? join(directory, "control-hub.json");
  await installPlugin(join(directory, "opencode.json"));
  await writeConfig(path, createConfig(url, secret));
  process.stdout.write("CONTROL_HUB_OPENCODE_CONFIGURED\n");
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : "CONFIGURE_FAILED"}\n`);
  process.exitCode = 1;
}

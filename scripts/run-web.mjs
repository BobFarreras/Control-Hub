import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const verify = process.argv.includes("--verify");
const portVariable = verify ? "VERIFY_WEB_PORT" : "WEB_PORT";
const port = process.env[portVariable];

if (!port || !/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
  console.error(`${portVariable} ha de declarar un port valid entre 1 i 65535.`);
  process.exit(1);
}
const nextBin = fileURLToPath(new URL("../apps/web/node_modules/next/dist/bin/next", import.meta.url));

const result = spawnSync(process.execPath, [nextBin, "dev", "--hostname", "127.0.0.1", "--port", port], {
  env: process.env,
  stdio: "inherit",
  shell: false
});

if (result.error) throw result.error;
process.exit(result.status ?? 1);

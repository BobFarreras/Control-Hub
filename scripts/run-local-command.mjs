import { spawnSync } from "node:child_process";

const commands = {
  migrate: ["--filter", "@control-hub/database", "migrate"],
  bootstrap: ["--filter", "@control-hub/api", "exec", "tsx", "src/bootstrap.ts"],
  api: ["--filter", "@control-hub/api", "dev"],
  seed: ["--filter", "@control-hub/api", "exec", "tsx", "src/seed-dev.ts", "--confirm-local"],
  "seed:e2e": ["--filter", "@control-hub/api", "exec", "tsx", "src/seed-e2e.ts", "--confirm-test"]
};
const selected = commands[process.argv[2]];
if (!selected) throw new Error("Unknown local command");
const packageManager = process.env.npm_execpath;
if (!packageManager) throw new Error("pnpm execution path is unavailable");
const result = spawnSync(process.execPath, [packageManager, ...selected], {
  env: process.env,
  stdio: "inherit",
  shell: false
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);

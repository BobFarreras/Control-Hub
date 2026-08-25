import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./run-web.mjs", import.meta.url));

function run(args, overrides) {
  const env = { ...process.env, ...overrides };
  delete env.WEB_PORT;
  delete env.VERIFY_WEB_PORT;
  Object.assign(env, overrides);
  return spawnSync(process.execPath, [script, ...args], { encoding: "utf8", env });
}

test("refuses to start without an explicit web port", () => {
  const result = run([], {});

  assert.equal(result.status, 1);
  assert.match(result.stderr, /WEB_PORT ha de declarar un port valid/);
});

test("refuses an invalid verification port", () => {
  const result = run(["--verify"], { VERIFY_WEB_PORT: "70000" });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /VERIFY_WEB_PORT ha de declarar un port valid/);
});

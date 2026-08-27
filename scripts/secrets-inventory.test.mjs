import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const inventory = JSON.parse(readFileSync(new URL("docs/security/secrets-inventory.json", root), "utf8"));
const allowedClassifications = new Set(inventory.classifications);
const entries = new Map(inventory.variables.map((entry) => [entry.name, entry]));

const sensitiveName = /(?:PASSWORD|SECRET|TOKEN|KEY_RING|DATABASE_URL|REDIS_URL|CREDENTIALS_FILE|_FILE)$/;

function collect(pattern, content, names) {
  for (const match of content.matchAll(pattern)) names.add(match[1]);
}

function discoveredSensitiveVariables() {
  const names = new Set();
  for (const file of [".env.example", ".env.verify.example"])
    collect(/^([A-Z][A-Z0-9_]*)=/gm, readFileSync(new URL(file, root), "utf8"), names);

  collect(
    /^\s{2}([A-Z][A-Z0-9_]*):\s*z\./gm,
    readFileSync(new URL("packages/config/src/index.ts", root), "utf8"),
    names
  );
  collect(/\$\{([A-Z][A-Z0-9_]*)/g, readFileSync(new URL("compose.yaml", root), "utf8"), names);

  const tracked = execFileSync("git", ["ls-files", "apps", "packages", "scripts", "tests", ".github"], {
    cwd: root,
    encoding: "utf8"
  })
    .split(/\r?\n/)
    .filter(Boolean);

  for (const file of tracked) {
    const content = readFileSync(new URL(file, root), "utf8");
    collect(/process\.env\.([A-Z][A-Z0-9_]*)/g, content, names);
    collect(/secrets\.([A-Z][A-Z0-9_]*)/g, content, names);
  }
  return [...names].filter((name) => sensitiveName.test(name)).sort();
}

test("the inventory has one complete record per variable", () => {
  assert.equal(entries.size, inventory.variables.length, "duplicate variable in secrets inventory");
  for (const entry of inventory.variables) {
    assert.match(entry.name, /^[A-Z][A-Z0-9_]*$/);
    assert.ok(allowedClassifications.has(entry.classification), `${entry.name} has an unknown classification`);
    assert.ok(entry.consumers.length > 0, `${entry.name} has no consumer`);
    assert.ok(entry.owner, `${entry.name} has no owner`);
    assert.ok(entry.environments.length > 0, `${entry.name} has no environment`);
    assert.ok(entry.rotation, `${entry.name} has no rotation procedure`);
  }
});

test("every sensitive variable used by the repository is classified", () => {
  const missing = discoveredSensitiveVariables().filter((name) => {
    if (entries.has(name)) return false;
    if (!name.endsWith("_FILE")) return true;
    const entry = entries.get(name.slice(0, -"_FILE".length));
    return entry?.fileVariable !== name;
  });
  assert.deepEqual(missing, [], `unclassified sensitive variables: ${missing.join(", ")}`);
});

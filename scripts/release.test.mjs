import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { evaluateChecks, requiredChecks } from "./release-gate.mjs";
import { buildManifest, manifestSchema, releaseServices, releaseWork } from "./release-manifest.mjs";

const workflow = readFileSync(new URL("../.github/workflows/release.yml", import.meta.url), "utf8");
const ci = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
const dockerfile = readFileSync(new URL("../deploy/Dockerfile", import.meta.url), "utf8");

const digest = (byte) => `sha256:${byte.repeat(64)}`;
const valid = {
  version: "1.1.0",
  commit: "a".repeat(40),
  released: "2026-08-26T09:00:00Z",
  registry: "ghcr.io/bobfarreras",
  digests: { api: digest("1"), worker: digest("2"), migrate: digest("3"), web: digest("4") },
  work: { migrations: 2, configuration: false }
};

test("the manifest names every image by digest and nothing else", () => {
  const manifest = buildManifest(valid);
  assert.equal(manifest.schema, manifestSchema);
  assert.deepEqual(Object.keys(manifest.images).sort(), [...releaseServices].sort());
  assert.equal(manifest.images.api, `ghcr.io/bobfarreras/control-hub-api@${digest("1")}`);
  // Nothing anywhere in the file that an installation could be induced to call. The image
  // references are pull addresses, and `@sha256:` is what makes them that rather than a name
  // somebody can repoint later.
  for (const reference of Object.values(manifest.images)) assert.match(reference, /@sha256:[0-9a-f]{64}$/);
  assert.doesNotMatch(JSON.stringify(manifest), /https?:\/\//);
});

test("it refuses anything it cannot vouch for instead of publishing it", () => {
  const rejects = (change, because) =>
    assert.throws(() => buildManifest({ ...valid, ...change }), /RELEASE_MANIFEST_INVALID/, because);

  rejects({ version: "v1.1.0" }, "a tag is not a version");
  rejects({ version: "1.1" }, "two numbers are not a version");
  rejects({ commit: "a".repeat(7) }, "a short sha does not identify a commit forever");
  rejects({ released: "2026-08-26" }, "a date is not an instant");
  rejects({ registry: "ghcr.io/BobFarreras" }, "a registry namespace is case sensitive");
  rejects({ registry: "ghcr.io/bobfarreras/" }, "a trailing slash would double it");
  rejects({ digests: { ...valid.digests, web: undefined } }, "three images are not a release");
  rejects({ digests: { ...valid.digests, web: "latest" } }, "a tag is not a digest");
  rejects({ digests: { ...valid.digests, extra: digest("5") } }, "an unknown service means a stale list");
  rejects({ work: { migrations: -1, configuration: false } }, "a negative count is a bug upstream");
  rejects({ work: { migrations: 1, configuration: "yes" } }, "the banner branches on this, so it is a boolean");
});

test("the work an update represents is read off the paths, not guessed", () => {
  const work = releaseWork([
    "packages/database/migrations/0060_thing.sql",
    "packages/database/migrations/0061_other.sql",
    "packages/database/migrations/README.md",
    "apps/api/src/app.ts",
    ".env.example"
  ]);
  assert.deepEqual(work, { migrations: 2, configuration: true });

  assert.deepEqual(releaseWork(["apps/web/src/page.tsx"]), { migrations: 0, configuration: false });
  // A file that merely mentions the directory is not a migration, or every documentation change
  // would tell somebody to expect database work during an update and the banner would stop meaning
  // anything.
  assert.deepEqual(releaseWork(["docs/specifications/packages/database/migrations/x.sql"]).migrations, 0);
});

test("the gate publishes only on a full house", () => {
  const completed = (name, conclusion = "success") => ({
    name,
    status: "completed",
    conclusion,
    started_at: "2026-08-26T09:00:00Z"
  });
  const all = requiredChecks.map((name) => completed(name));

  assert.equal(evaluateChecks(all).verdict, "passed");
  assert.equal(evaluateChecks(all.slice(1)).verdict, "waiting", "a check nobody has reported is not a pass");
  assert.equal(evaluateChecks([...all.slice(1), completed(requiredChecks[0], "failure")]).verdict, "failed");
  // Skipped and cancelled are the two that look like nothing went wrong. They are refusals here:
  // a gate that did not run did not pass.
  assert.equal(evaluateChecks([...all.slice(1), completed(requiredChecks[0], "skipped")]).verdict, "failed");
  assert.equal(evaluateChecks([...all.slice(1), completed(requiredChecks[0], "cancelled")]).verdict, "failed");
  assert.equal(
    evaluateChecks([...all.slice(1), { name: requiredChecks[0], status: "in_progress" }]).verdict,
    "waiting"
  );
  assert.equal(evaluateChecks([]).verdict, "waiting");
  assert.equal(evaluateChecks(undefined).verdict, "waiting");
});

test("a green re-run outvotes the failure it replaced", () => {
  // Re-running a check adds a row rather than replacing one. Taking the first match would make a
  // re-run pointless: the release would keep refusing on a result somebody already dealt with.
  const runs = requiredChecks.map((name) => ({
    name,
    status: "completed",
    conclusion: "success",
    started_at: "2026-08-26T10:00:00Z"
  }));
  runs.push({
    name: requiredChecks[0],
    status: "completed",
    conclusion: "failure",
    started_at: "2026-08-26T09:00:00Z"
  });
  assert.equal(evaluateChecks(runs).verdict, "passed");
});

test("the required list holds every gate ci.yml declares", () => {
  // The same disagreement as the migration variable and the build argument: two files that read
  // correctly alone. A job added to CI and forgotten here would silently stop being required for a
  // release, and nothing would fail -- the release would simply publish without it.
  const declared = [...ci.matchAll(/^ {4}name: (.+)$/gm)].map(([, name]) => name.trim());
  for (const name of declared) {
    assert.ok(requiredChecks.includes(name), `ci.yml declares "${name}", which the release does not require`);
  }
  // And nothing required that CI does not produce, except the one GitHub's default setup reports.
  for (const name of requiredChecks) {
    if (name === "CodeQL") continue;
    assert.ok(declared.includes(name), `the release requires "${name}", which ci.yml no longer declares`);
  }
});

test("the workflow publishes exactly the images the Dockerfile can build", () => {
  const stages = [...dockerfile.matchAll(/^FROM runtime AS ([a-z]+)$/gm)].map(([, stage]) => stage);
  assert.deepEqual([...stages].sort(), [...releaseServices].sort());
  for (const service of releaseServices) {
    assert.match(workflow, new RegExp(`^          target: ${service}$`, "m"), `nothing builds ${service}`);
    assert.match(
      workflow,
      new RegExp(`control-hub-${service}:\\$\\{\\{ env.VERSION \\}\\}`),
      `nothing pushes ${service}`
    );
  }
});

test("nothing is published before the gate, or signed by a tag", () => {
  assert.match(workflow, /^ {2}publish:\n(?:.*\n)*? {4}needs: gate$/m, "publish must depend on the gate");
  // Signing a tag verifies against whatever the tag points at today, which is not what was signed.
  assert.match(workflow, /cosign sign --yes "\$REGISTRY\/control-hub-\$service@\$digest"/);
  assert.doesNotMatch(workflow, /cosign sign[^\n]*:\$\{?VERSION/);
  // `latest` is the tag an installation must never resolve, so the workflow must never write one.
  assert.doesNotMatch(workflow, /control-hub-[a-z]+:latest/);
  // Every action pinned to a commit, for the reason the header gives.
  for (const [, action] of workflow.matchAll(/uses: (\S+)/g)) {
    assert.match(action, /@[0-9a-f]{40}$/, `${action} is not pinned to a commit`);
  }
});

test("no workflow expression is substituted into a shell script", () => {
  // `${{ }}` inside a `run:` is textual substitution before bash ever sees the line, so the value
  // arrives as source code rather than as a value. Everything this workflow interpolates comes from
  // its own gate job today, which is exactly the reasoning that stops being true the day somebody
  // adds one that comes from a tag name or an issue title. The environment has no such problem.
  const lines = workflow.split(/\r?\n/);
  const offenders = [];
  let indent = null;
  for (const [index, line] of lines.entries()) {
    if (indent !== null && line.trim() !== "" && line.search(/\S/) < indent) indent = null;
    if (indent !== null && line.includes("${{")) offenders.push(`line ${index + 1}: ${line.trim()}`);
    const opens = /^(\s+)run: \|/.exec(line);
    if (opens) indent = opens[1].length + 2;
  }
  assert.deepEqual(offenders, []);
});

test("the build identifier the workflow stamps is the one the Dockerfile accepts", () => {
  const [, argument] = dockerfile.match(/^ARG (CONTROL_HUB_[A-Z_]+)=/m) ?? [];
  assert.ok(argument, "the builder stage declares no build identifier");
  const passes = [...workflow.matchAll(new RegExp(`build-args: ${argument}=`, "g"))];
  assert.equal(passes.length, releaseServices.length, `${passes.length} of four images would report "development"`);
});

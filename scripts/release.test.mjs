import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { releaseEnvironment } from "./release-env.mjs";
import { evaluateChecks, requiredChecks } from "./release-gate.mjs";
import {
  buildManifest,
  manifestEnvironment,
  manifestSchema,
  parseManifest,
  releaseServices,
  releaseWork
} from "./release-manifest.mjs";

// Normalised, because these files are checked out with whatever line endings the machine uses and
// half of them are CRLF here. A pattern that anchors on `\n` after a colon then matches nothing at
// all, and a test that matches nothing passes every assertion it never reaches.
const read = (name) => readFileSync(new URL(`../${name}`, import.meta.url), "utf8").replaceAll("\r\n", "\n");

const workflow = read(".github/workflows/release.yml");
const ci = read(".github/workflows/ci.yml");
const dockerfile = read("deploy/Dockerfile");
const compose = read("compose.yaml");
const release = read("compose.release.yaml");
const ignored = read(".gitignore");

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

test("reading a manifest back means validating it, not trusting it", () => {
  const manifest = buildManifest(valid);
  const text = JSON.stringify(manifest);
  assert.deepEqual(parseManifest(text), manifest);

  const rejects = (mutate, because) => {
    const broken = JSON.parse(text);
    mutate(broken);
    assert.throws(() => parseManifest(JSON.stringify(broken)), /RELEASE_MANIFEST_INVALID/, because);
  };

  assert.throws(() => parseManifest("{"), /RELEASE_MANIFEST_INVALID/, "not JSON");
  rejects((m) => (m.schema = 2), "a shape this code does not know is not one to guess at");
  rejects((m) => delete m.images.web, "three images are not a release");
  rejects((m) => (m.images.web = "ghcr.io/bobfarreras/control-hub-web:1.1.0"), "a tag is not a digest");
  // The one that matters. Four references that each look fine but do not share a namespace is not a
  // shape a release can have, and is exactly the shape a substituted image would have.
  rejects((m) => (m.images.web = `ghcr.io/somebody-else/control-hub-web@${digest("4")}`), "second registry");
  rejects((m) => (m.images.web = `ghcr.io/bobfarreras/control-hub-webb@${digest("4")}`), "renamed repository");
  // Rebuilding rather than checking field by field is what catches the fields nobody thought to
  // check -- anything added, removed or reordered fails the comparison.
  rejects((m) => (m.extra = "surprise"), "a field this code does not know about");

  // And the limit of it, worth stating rather than implying: a value edited coherently survives.
  // Changing the version to 9.9.9 parses, because the parser has nothing to compare the claim
  // against. What a manifest cannot do is make an installation pull anything other than the four
  // digests it names -- those are signed (D6), and a digest that was never published cannot be
  // pulled at all. The manifest tells you a version is out; it is not what makes the images
  // trustworthy.
  const relabelled = JSON.parse(text);
  relabelled.version = "9.9.9";
  assert.equal(parseManifest(JSON.stringify(relabelled)).images.api, manifest.images.api);
});

test("the generated environment is exactly what the overlay reads", () => {
  // The pairing that would otherwise drift silently: rename a variable in the generator and the
  // overlay keeps asking for the old name, which fails at `docker compose up` on somebody's server
  // rather than here.
  const manifest = buildManifest(valid);
  const generated = manifestEnvironment(manifest);
  const defined = generated.map((line) => line.split("=")[0]);
  const wanted = [...release.matchAll(/\$\{(CONTROL_HUB_[A-Z_]+):\?/g)].map(([, name]) => name);

  assert.ok(wanted.length > 0, "the overlay reads no image variables at all");
  for (const name of wanted) assert.ok(defined.includes(name), `the overlay reads ${name}, which nothing generates`);
  for (const line of generated) assert.match(line, /^CONTROL_HUB_[A-Z_]+=\S+$/);
  assert.equal(generated[0], "CONTROL_HUB_VERSION=1.1.0");
  assert.ok(generated.includes(`CONTROL_HUB_API_IMAGE=ghcr.io/bobfarreras/control-hub-api@${digest("1")}`));

  // And the files the generator writes must be ignored by git. They are written into an
  // installation directory, but the generator runs wherever somebody points it, and a digest file
  // committed by accident is a version pin nobody meant to publish.
  for (const name of ["release.env", "release.json"])
    assert.match(ignored, new RegExp(`^${name.replace(".", "\\.")}$`, "m"), `${name} is not ignored`);

  const file = releaseEnvironment(JSON.stringify(manifest));
  assert.match(file, /^# Generated by scripts\/release-env\.mjs/);
  assert.match(file, /\n$/);
  // Every variable it reads must be pinned. A generated file that could name a tag would make the
  // digest discipline optional, and optional is how it stops happening.
  for (const line of file.split("\n").filter((l) => l.startsWith("CONTROL_HUB_") && l.includes("_IMAGE=")))
    assert.match(line, /@sha256:[0-9a-f]{64}$/);
});

test("the release overlay leaves nothing that could still be built", () => {
  // Every service `compose.yaml` builds has to appear here with its build removed. A service that
  // kept its `build:` would carry both, and `docker compose up --build` -- which is what somebody
  // types out of habit when a container misbehaves -- would compile from a source tree that a
  // production installation does not have.
  const builds = [...compose.matchAll(/^ {2}([a-z]+):\n {4}build:/gm)].map(([, service]) => service);
  assert.deepEqual([...builds].sort(), [...releaseServices].sort());
  // Split rather than matched. A lazy `[\s\S]*?` up to `$` under the `m` flag stops at the first
  // line ending, so the block is one line long and every assertion about its contents passes by
  // never seeing them -- which is how this test first went green against an overlay that was wrong.
  const blocks = new Map(
    release
      .split(/^ {2}(?=[a-z]+:$)/m)
      .slice(1)
      .map((chunk) => [chunk.match(/^([a-z]+):/)[1], chunk])
  );
  for (const service of builds) {
    const block = blocks.get(service);
    assert.ok(block, `${service} is missing from the release overlay`);
    assert.match(block, /^ {4}build: !reset null$/m, `${service} keeps a build definition`);
    assert.match(block, /^ {4}image: \$\{CONTROL_HUB_[A-Z_]+_IMAGE:\?/m, `${service} has no pinned image`);
  }
  // And no digest written into the overlay itself: they belong in the generated file, where an
  // update replaces them all at once.
  assert.doesNotMatch(release, /sha256:/);
  assert.doesNotMatch(release, /:latest/);
});

test("the build identifier the workflow stamps is the one the Dockerfile accepts", () => {
  const [, argument] = dockerfile.match(/^ARG (CONTROL_HUB_[A-Z_]+)=/m) ?? [];
  assert.ok(argument, "the builder stage declares no build identifier");
  const passes = [...workflow.matchAll(new RegExp(`build-args: ${argument}=`, "g"))];
  assert.equal(passes.length, releaseServices.length, `${passes.length} of four images would report "development"`);
});

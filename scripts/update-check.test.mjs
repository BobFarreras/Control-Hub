import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (name) => readFileSync(new URL(`../${name}`, import.meta.url), "utf8").replaceAll("\r\n", "\n");

const compose = read("compose.yaml");
const example = read(".env.example");
const worker = read("apps/worker/src/index.ts");
const check = read("apps/worker/src/update-check.ts");
const route = read("apps/api/src/routes/installation.ts");
const runbook = read("docs/runbooks/installation.md");

const manifestUrl = "https://github.com/BobFarreras/Control-Hub/releases/latest/download/release.json";

/**
 * The three conditions `docs/specifications/deployment.md` (D5) attaches to checking for updates at
 * all, none of which is optional, asserted where each of them actually lives.
 *
 * Unit tests cover the pass itself. What they cannot cover is the wiring: a switch that never
 * reaches the process, a schedule the last release left behind, or a runbook that describes a
 * request different from the one the code makes. Each of those is silent, and each of them turns a
 * documented promise into a false one.
 */
test("the switch reaches the process that makes the request", () => {
  // Compose enumerates the worker's environment explicitly. A variable missing from that list
  // never arrives, so `CONTROL_HUB_UPDATE_CHECK=false` in `.env` would change nothing at all --
  // and it would change nothing silently, which is the worst way for a privacy switch to fail.
  const workerService = compose.slice(compose.indexOf("\n  worker:"), compose.indexOf("\n  migrate:"));
  assert.match(workerService, /CONTROL_HUB_UPDATE_CHECK: \$\{CONTROL_HUB_UPDATE_CHECK:-true\}/);
  assert.match(example, /^CONTROL_HUB_UPDATE_CHECK=/m, ".env.example does not mention the switch");
});

test("switching it off removes the schedule rather than merely not adding one", () => {
  // Off has to mean nothing leaves this machine, not «nothing new leaves it». A branch that only
  // skipped `upsertJobScheduler` would leave the schedule the previous release installed still
  // making the request, with no way to stop it short of a deploy.
  const wiring = worker.slice(worker.indexOf("if (updateCheckEnabled) {"));
  assert.ok(wiring.length > 0, "the schedule is not conditional on the switch at all");
  const branch = wiring.slice(0, wiring.indexOf("\n}\n") + 3);
  assert.match(branch, /upsertJobScheduler\(\s*UPDATE_CHECK_JOB/, "the check is never scheduled");
  assert.match(branch, /else \{[\s\S]*removeJobScheduler\(UPDATE_CHECK_JOB\)/, "the old schedule is left running");
});

test("it asks one host, and it is the one the runbook names", () => {
  // A configurable URL would be a way to point an unattended installation at somebody else's
  // manifest, and it would make the runbook's «exactly what goes out and where» unanswerable.
  const addresses = [...check.matchAll(/https?:\/\/[^\s"'`]+/g)].map(([address]) => address);
  assert.deepEqual([...new Set(addresses)], [manifestUrl]);
  assert.match(check, /export const releaseManifestUrl = "https:\/\//, "the address is not a constant");
  assert.ok(!/process\.env/.test(check), "the address or the switch is read from the environment here");
});

test("nothing about the request identifies this installation", () => {
  // The second condition, read off the call. `accept` says what shape is wanted; a header naming
  // a version or a build would say who is asking, and there is nothing else in this file to say.
  const request = check.slice(check.indexOf("const response = await request("), check.indexOf("if (!response.ok)"));
  assert.match(request, /headers: \{ accept: "application\/json" \}/);
  assert.doesNotMatch(request, /body|user-agent|version|method: "POST"/i);
});

test("the browser is never the one that asks", () => {
  // The first condition, and the one with a victim: with the browser, every person who opens
  // Control Hub hands their IP to GitHub without knowing. The route that serves the answer reads
  // what the worker stored and reaches nothing.
  assert.doesNotMatch(route, /\bfetch\s*\(/, "the API route fetches something");
  // A literal search, not a regular expression: the claim is that this text appears nowhere in the
  // file, and an unanchored host pattern is what CodeQL flags as a host check that matches too much.
  // It was never a host check -- but the honest way to say «this string is absent» is `includes`.
  assert.ok(!route.includes("github.com"), "the API route knows an address it has no business knowing");
  assert.match(runbook, /Mai el navegador|mai el navegador/, "the runbook does not say who asks");
});

test("the runbook says exactly what leaves and how to stop it", () => {
  // The third condition. A switch nobody can find, or one whose effect is described vaguely, is a
  // switch that does not count -- the point is that somebody can decide on the facts.
  assert.ok(runbook.includes(manifestUrl), "the runbook does not name the address");
  assert.match(runbook, /CONTROL_HUB_UPDATE_CHECK=false/, "the runbook does not say how to switch it off");
  assert.match(runbook, /24 hores/, "the runbook does not say how often");
});

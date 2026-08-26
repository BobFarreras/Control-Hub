/**
 * The gate that decides whether a commit may be published.
 *
 * `docs/specifications/deployment.md` says no image is published unless the nine gates of `ci.yml`
 * have passed on the same commit. Enforcing that inside the publishing workflow rather than
 * assuming it matters because the two workflows do not share a run: a tag can be pushed at any
 * moment, by hand, at any commit -- including one that never reached `main`, or one whose checks
 * are still running, or one where a check failed and somebody tagged anyway.
 *
 * Check runs hang off the commit, not off the ref, which is what makes this work for a tag at all:
 * `ci.yml` does not run on tag pushes, but the commit the tag points at has already been through it
 * on `main`.
 *
 * The default is refusal. A check that is missing, queued, cancelled or skipped is not a pass here
 * -- «not failed» and «passed» are different claims, and only the second one is worth publishing on.
 */
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/**
 * The gates a release requires, and why the list is written out rather than discovered.
 *
 * Branch protection knows this list, but reading it needs a token with administration rights, and
 * a publishing workflow is the last place to widen a token. So the list lives here, and
 * `release.test.mjs` holds it against the jobs `ci.yml` actually declares -- a job added there and
 * forgotten here fails the suite rather than quietly dropping out of the requirement.
 */
export const requiredChecks = [
  "Repository standards",
  "Application checks",
  "Previous version",
  "End to end",
  "Authenticated end to end",
  "Container image",
  "Secret scan",
  "Vulnerable dependencies",
  "Static analysis",
  // Not a job in `ci.yml`: GitHub's default setup runs it and reports under this name.
  "CodeQL"
];

/**
 * Reads one API page of check runs into a verdict.
 *
 * Returns `waiting` rather than `failed` while something is still running, because on `develop`
 * this workflow starts from the same push as CI and would otherwise refuse every time on a race
 * instead of on a result.
 */
export function evaluateChecks(checkRuns, required = requiredChecks) {
  const latest = new Map();
  for (const run of checkRuns ?? []) {
    // The same check can appear more than once -- a re-run adds a row rather than replacing one --
    // so the newest start wins and an old failure does not outvote a green re-run.
    const previous = latest.get(run.name);
    if (!previous || String(run.started_at ?? "") >= String(previous.started_at ?? "")) latest.set(run.name, run);
  }

  const missing = [];
  const pending = [];
  const failed = [];
  for (const name of required) {
    const run = latest.get(name);
    if (!run) {
      missing.push(name);
    } else if (run.status !== "completed") {
      pending.push(name);
    } else if (run.conclusion !== "success") {
      failed.push(`${name} (${run.conclusion})`);
    }
  }

  if (failed.length > 0) return { verdict: "failed", reason: `did not pass: ${failed.join(", ")}` };
  if (pending.length > 0) return { verdict: "waiting", reason: `still running: ${pending.join(", ")}` };
  // Missing comes last on purpose. Early in a run a check that has not been created yet is
  // indistinguishable from one that will never exist, so this is only a refusal once the caller
  // has run out of patience -- the workflow turns a timed-out `waiting` into a failure itself.
  if (missing.length > 0) return { verdict: "waiting", reason: `not reported yet: ${missing.join(", ")}` };
  return { verdict: "passed", reason: `all ${required.length} required checks passed` };
}

/**
 * Reads the API response on stdin and answers in the exit code, so the workflow's retry loop is
 * three lines of shell: 0 publishes, 75 sleeps and asks again, anything else stops the release.
 * 75 is `EX_TEMPFAIL`, which is what «ask me later» has meant since sysexits.h.
 */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const payload = JSON.parse(readFileSync(0, "utf8"));
  const { verdict, reason } = evaluateChecks(payload.check_runs ?? payload);
  process.stdout.write(`${verdict}: ${reason}\n`);
  process.exit(verdict === "passed" ? 0 : verdict === "waiting" ? 75 : 1);
}

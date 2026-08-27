import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { inspectMigration, migrationsSincePreviousVersion, safetyMarker } from "./migration-compatibility.mjs";
import { requiredChecks } from "./release-gate.mjs";

// See the note in `release.test.mjs`: these files are CRLF here, and a pattern anchored on `\n`
// would match nothing while every assertion after it passed unread.
const read = (name) => readFileSync(new URL(`../${name}`, import.meta.url), "utf8").replaceAll("\r\n", "\n");
const ci = read(".github/workflows/ci.yml");

/** The `previous-version:` block alone, so a match cannot come from a neighbouring job. */
const job = ci.split(/^ {2}(?=[a-z-]+:$)/m).find((block) => block.startsWith("previous-version:"));

test("a migration that removes something the previous version may use is refused", () => {
  const removals = {
    "drops a table": "drop table legacy_sessions;",
    "drops a column": "alter table tenants\n  drop column status;",
    "drops a type": "drop type tenant_status;",
    renames: "alter table tenants rename column slug to handle;",
    "changes a type": "alter table tenants\n  alter column name type text;",
    // The one the integration suite cannot see: it breaks the old version's writes, and a suite
    // that only reads stays green.
    "adds a required column with no default": "alter table tenants add column region text not null;"
  };

  for (const [what, sql] of Object.entries(removals)) {
    assert.equal(inspectMigration("0060_x.sql", sql).length, 1, `${what} went unnoticed`);
  }
});

test("what does not break a running version is left alone", () => {
  const harmless = {
    "adds a nullable column": "alter table tenants add column region text;",
    "adds a required column with a default": "alter table tenants add column region text not null default 'eu';",
    // Loosening: code that ran under the constraint still runs without it.
    "drops an index": "drop index if exists tenants_slug_idx;",
    "drops a constraint": "alter table tenants drop constraint tenants_region_check;",
    "names a table after the words": "create table dropped_columns_audit (id uuid primary key);"
  };

  for (const [what, sql] of Object.entries(harmless)) {
    assert.deepEqual(inspectMigration("0060_x.sql", sql), [], `${what} was reported`);
  }
});

test("the marker excuses the statement it sits on and no other", () => {
  const sql = [
    `${safetyMarker} nothing has read status since 0.2.0`,
    "alter table tenants",
    "  drop column status;",
    "",
    "alter table tenants",
    "  drop column slug;"
  ].join("\n");

  const findings = inspectMigration("0060_x.sql", sql);
  assert.equal(findings.length, 1);
  assert.match(findings[0].statement, /alter table tenants/);
  assert.equal(findings[0].what, "drops a column");
});

test("a semicolon inside a function body does not split the statement around it", () => {
  // Unmasked, the body would be torn into chunks and one of them would contain the words on their
  // own -- a finding invented out of a string literal, and a marker stranded in the wrong chunk.
  const sql = [
    "create function announce() returns void as $$",
    "begin",
    "  raise notice 'drop column status';",
    "end;",
    "$$ language plpgsql;"
  ].join("\n");

  assert.deepEqual(inspectMigration("0060_x.sql", sql), []);
});

test("every migration this release adds is either harmless or explained", () => {
  // The false-positive direction, held against the migrations that actually exist rather than
  // against invented ones: a rule nobody can satisfy gets switched off within a week.
  const { files } = migrationsSincePreviousVersion();
  const findings = files.flatMap((path) => inspectMigration(path, readFileSync(path, "utf8")));
  assert.deepEqual(
    findings.map((finding) => `${finding.migration}: ${finding.what}`),
    []
  );
});

test("ci.yml exercises the previous version against this schema", () => {
  assert.ok(job, "ci.yml declares no previous-version job");
  assert.match(job, /^ {4}name: Previous version$/m);
  assert.match(job, /fetch-depth: 0/, "without full history there are no tags to compare against");
  assert.match(job, /node scripts\/migration-compatibility\.mjs$/m, "the static check does not run");
  assert.match(job, /git worktree add --detach "\$RUNNER_TEMP\/previous"/);
  assert.match(job, /pnpm --filter @control-hub\/database migrate/, "the database is never brought to this version");
  assert.match(job, /pnpm test:integration/, "the previous version's suite never runs");
});

test("the previous-version gate can never report itself skipped", () => {
  // `release-gate.mjs` counts a skipped check as a failure, so a job that skips itself would block
  // every release rather than waving it through. The fast path is inside the job, not around it.
  assert.ok(job);
  assert.doesNotMatch(job, /^ {4}needs:/m, "a needs: makes the job skippable when its dependency fails");
  assert.doesNotMatch(job, /^ {4}if:/m, "a job-level if: reports skipped, which the release gate reads as failure");
  assert.ok(requiredChecks.includes("Previous version"), "the release does not require the check");
});

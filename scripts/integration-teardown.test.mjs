import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

/**
 * Every tracked TypeScript file, from git rather than from a directory walk.
 *
 * A walk here would descend into `.claude/worktrees`, where other checkouts of this same repository
 * live: twenty-seven copies of these files that are nobody's source and that would make this guard
 * report failures in code that is not on this branch.
 */
const sources = execFileSync("git", ["ls-files", "*.ts", "*.tsx"], { cwd: root, encoding: "utf8" })
  .split("\n")
  .filter(Boolean);

/**
 * `alter table ... disable trigger` is DDL, and DDL is global.
 *
 * Turbo runs `test:integration` for fourteen packages in parallel against one `TEST_DATABASE_URL`,
 * so a teardown that takes an append-only trigger down takes it down for every suite running at
 * that moment. Two of them used to disable the same three tables, and the interleaving that follows
 * is not hypothetical -- it turned up red on a release PR on 28/08/2026:
 *
 *   1. the worker suite disables the three triggers
 *   2. the persistence suite disables them too, which does nothing, they are already down
 *   3. the persistence suite finishes and its `finally` puts all three back up
 *   4. the worker suite's third delete meets a live trigger: "support history is append-only"
 *
 * It can only ever produce a false red -- a re-enabled trigger makes a cleanup fail, it cannot make
 * an append-only assertion pass in silence. But a suite that fails by luck teaches people to re-run
 * without reading, and that habit is what eventually waves a real failure through.
 *
 * `session_replication_role` does the same job for one session, so a suite can no longer reach into
 * another one's tables.
 */
test("no integration teardown disables a trigger for every other suite at once", () => {
  const offenders = [];
  for (const file of sources) {
    const contents = readFileSync(new URL(file, new URL("..", import.meta.url)), "utf8");
    contents.split("\n").forEach((line, index) => {
      if (/alter table .*\b(disable|enable) trigger\b/i.test(line)) {
        offenders.push(`${file}:${index + 1}`);
      }
    });
  }

  assert.deepEqual(
    offenders,
    [],
    "these change a trigger for the whole database while other packages are using it. " +
      "Use `set session_replication_role = 'replica'` and `'origin'` on the admin connection instead. " +
      "Keep the window around the append-only deletes only: `replica` suppresses foreign-key and " +
      "cascade triggers too, so a delete that relies on `on delete cascade` leaves its children " +
      "behind and fails later on the constraint.\n  " +
      offenders.join("\n  ")
  );
});

/**
 * The replacement is only session-scoped if it is put back, and `finally` is what guarantees that.
 * A suite that sets `replica` and then throws would hand the connection back to the pool with
 * triggers off for whatever runs next -- the same class of bug wearing different clothes.
 */
test("every suite that relaxes its session puts it back in a finally", () => {
  const wrong = [];
  for (const file of sources) {
    const contents = readFileSync(new URL(file, new URL("..", import.meta.url)), "utf8");
    if (!contents.includes("session_replication_role = 'replica'")) continue;
    const restores = contents.match(/session_replication_role = 'origin'/g) ?? [];
    const relaxes = contents.match(/session_replication_role = 'replica'/g) ?? [];
    if (restores.length < relaxes.length) wrong.push(`${file}: ${relaxes.length} relaxed, ${restores.length} restored`);
    else if (!/finally\s*{[\s\S]*?session_replication_role = 'origin'/.test(contents)) {
      wrong.push(`${file}: restored, but not from a finally`);
    }
  }
  assert.deepEqual(
    wrong,
    [],
    `a session left in replica is a session the next test inherits:\n  ${wrong.join("\n  ")}`
  );
});

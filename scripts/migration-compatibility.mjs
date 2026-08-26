/**
 * The static half of the N-1 compatibility check: migrations that remove something, refused unless
 * somebody said out loud why it is safe.
 *
 * The dynamic half -- running the previous version's integration suite against a database migrated
 * to this one -- is the real exercise, and it has a measured hole. Dropping `tenants.status` from a
 * database at migration 0059 left all 602 tests of v0.3.0 green, because no test reads that column;
 * dropping `tenants.slug` turned four files red immediately. So the suite proves compatibility for
 * everything the old code exercises and says nothing about the rest, which is precisely the part
 * nobody remembers to check.
 *
 * This half covers the other side and costs no database. It reads only the migrations added since
 * the previous version tag: the rule from D4 is about what a release does to the version before it,
 * so history is not in scope and the whole existing tree is not re-litigated on every run.
 *
 *   node scripts/migration-compatibility.mjs          # check, exit 1 on an unexplained removal
 *   node scripts/migration-compatibility.mjs --list   # the migration files added since the tag
 *
 * The escape hatch is a comment in the migration itself rather than an allowlist file. An allowlist
 * is a place where entries accumulate and nobody reads them; a sentence next to the statement is
 * read by whoever reviews the migration, which is the person who can still say no.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const migrationsDirectory = "packages/database/migrations";

/** The marker that turns a removal from an accident into a decision. */
export const safetyMarker = "-- n-1-safe:";

/**
 * Statements that can stop the previous version working against this schema.
 *
 * Not everything irreversible: loosening a constraint or dropping an index does not break code that
 * was already running. What breaks it is an object or column going away, a rename (which is a
 * removal wearing a hat), a type change under a running query, and a `not null` column with no
 * default -- which breaks the old version's inserts rather than its reads, and so passes every test
 * that only reads.
 */
const destructive = [
  { name: "drops a table", pattern: /\bdrop\s+table\b/i },
  { name: "drops a column", pattern: /\bdrop\s+column\b/i },
  { name: "drops a type", pattern: /\bdrop\s+type\b/i },
  { name: "renames", pattern: /\brename\s+(?:column|to)\b/i },
  { name: "changes a column type", pattern: /\balter\s+column\b[\s\S]*?\btype\b/i },
  {
    name: "adds a required column with no default",
    pattern: /\badd\s+column\b(?![\s\S]*?\bdefault\b)[\s\S]*?\bnot\s+null\b/i
  }
];

/**
 * Splits SQL into statements, with each statement carrying the comments written above it.
 *
 * Each one comes back twice: `text` to quote back to whoever has to fix it, and `scan` with every
 * dollar-quoted body blanked out. Both are needed. Without the blanking a function containing a
 * semicolon is torn in half and its halves land in the wrong statements; and matching the original
 * rather than the blanked copy reads the words back out of the body regardless -- a `raise notice`
 * mentioning a dropped column is not a dropped column. Same length, so the two stay aligned.
 */
function statements(sql) {
  const masked = sql.replace(/\$\$[\s\S]*?\$\$/g, (block) => " ".repeat(block.length));
  const chunks = [];
  let start = 0;
  for (let index = 0; index < masked.length; index += 1) {
    if (masked[index] !== ";") continue;
    chunks.push({ text: sql.slice(start, index + 1), scan: masked.slice(start, index + 1) });
    start = index + 1;
  }
  if (sql.slice(start).trim() !== "") chunks.push({ text: sql.slice(start), scan: masked.slice(start) });
  return chunks;
}

/** Every unexplained removal in one migration. */
export function inspectMigration(name, sql) {
  const findings = [];
  for (const { text, scan } of statements(sql)) {
    // Read off the blanked copy too: a marker quoted inside a function body excuses nothing.
    if (scan.includes(safetyMarker)) continue;
    for (const { name: what, pattern } of destructive) {
      if (!pattern.test(scan)) continue;
      findings.push({ migration: name, what, statement: text.trim().split("\n")[0].slice(0, 90) });
      break;
    }
  }
  return findings;
}

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

/**
 * The migrations this release adds, relative to the previous version tag.
 *
 * With no tag yet everything counts, which is the right answer for a first release and also the
 * safe one: it errs towards checking too much rather than towards checking nothing.
 */
export function migrationsSincePreviousVersion() {
  let previous;
  try {
    previous = git("describe", "--tags", "--abbrev=0", "--match", "v*.*.*");
  } catch {
    previous = null;
  }
  const output = previous
    ? git("diff", "--name-only", `${previous}..HEAD`, "--", migrationsDirectory)
    : git("ls-files", migrationsDirectory);
  return { previous, files: output.split("\n").filter((path) => path.endsWith(".sql")) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { previous, files } = migrationsSincePreviousVersion();
  if (process.argv.includes("--list")) {
    process.stdout.write(files.join("\n") + (files.length > 0 ? "\n" : ""));
    process.exit(0);
  }

  const findings = files.flatMap((path) => inspectMigration(path, readFileSync(path, "utf8")));
  process.stdout.write(`${files.length} migration(s) since ${previous ?? "the beginning"}\n`);
  if (findings.length === 0) {
    process.stdout.write("no unexplained removals\n");
    process.exit(0);
  }
  for (const finding of findings) {
    process.stdout.write(`\n${finding.migration}\n  ${finding.what}: ${finding.statement}\n`);
  }
  process.stdout.write(
    `\nEach of these can stop version ${previous ?? "N-1"} working against this schema. The rule (D4) is` +
      " that a column is added in one version, stopped being used in the next, and removed in the third.\n" +
      `If that has already happened, say so above the statement:\n\n    ${safetyMarker} unused since 0.2.0, nothing reads it\n\n`
  );
  process.exit(1);
}

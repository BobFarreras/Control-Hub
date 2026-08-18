/**
 * The dependency log, derived from the history rather than kept by hand.
 *
 * A register somebody has to remember to update is a register that is wrong by the third month,
 * and a wrong one is worse than none: it invites decisions based on a picture of the project
 * that stopped being true without anybody noticing. So nothing here is typed. Every line comes
 * out of a commit Dependabot wrote, which means the log cannot drift from what actually landed
 * -- the worst it can do is be regenerated late, and regenerating costs one command.
 *
 * What it answers: what has come in on its own, what came in after somebody looked at it, and
 * how far behind we are letting things get. Run it with `pnpm deps:log`.
 *
 * The classification is deliberately conservative. Anything it cannot read becomes `unknown`
 * and appears in its own section instead of being guessed into `patch`, because a major hiding
 * in the pile nobody reads is the one failure this file exists to prevent.
 */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const logPath = resolve(repositoryRoot, "docs/development/dependency-log.md");

/** The commit prefixes `dependabot.yml` declares. Anything else is not a dependency update. */
const prefixes = ["chore(deps)", "chore(deps-dev)", "chore(docker)", "chore(actions)"];

/** Leading numbers of a version, so `22.16-alpine` reads as 22.16 rather than as nothing. */
function numbers(version) {
  const match = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(version.trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)];
}

/**
 * How big a bump is, by semver's rules including the one about leading zeroes.
 *
 * Below 1.0.0 there is no compatibility promise and the minor position is where breaking
 * changes land, so `0.548.0 -> 0.549.0` is a major here even though the first number did not
 * move. Dependabot itself reports those as minor, which is how a breaking change ends up in an
 * automatic merge.
 */
export function classify(from, to) {
  const before = numbers(from);
  const after = numbers(to);
  if (!before || !after) return "unknown";

  if (before[0] !== after[0]) return "major";
  if (before[0] === 0 && before[1] !== after[1]) return "major";
  if (before[1] !== after[1]) return "minor";
  if (before[2] !== after[2]) return "patch";
  return "patch";
}

/**
 * The packages one commit moved.
 *
 * A grouped update names nothing in its subject -- it says "10 updates" -- and lists the
 * packages in the body instead. Reading only subjects would record the busiest commits as a
 * single anonymous line, so the body wins whenever it has something to say.
 *
 * The last branch is the one that earns its keep. Not every dependency commit is written by
 * Dependabot: a major taken by hand gets a subject that says what it did rather than "bump X
 * from A to B", and until this fell through to `unknown` such a commit vanished from the log
 * entirely -- the prefix said "dependency update", the pattern did not match, and nothing was
 * recorded. That is the one outcome this file exists to prevent, so a commit that claims a
 * dependency prefix now always leaves a row, even when the row has to say the version could
 * not be read.
 */
export function parseCommit(subject, body) {
  if (!prefixes.some((prefix) => subject.startsWith(prefix))) return [];

  const grouped = [...body.matchAll(/^Updates `([^`]+)` from (\S+) to (\S+)/gm)].map((match) => ({
    name: match[1],
    from: match[2],
    to: match[3]
  }));
  if (grouped.length > 0) return grouped;

  const single = /bump (\S+) from (\S+) to (\S+)/.exec(subject);
  if (single) return [{ name: single[1], from: single[2], to: single[3] }];

  // What is left of the subject once the prefix and the pull request number are gone: enough to
  // recognise the commit in the table and go read it.
  const described = subject.replace(/^[a-z-]+\([a-z-]+\):\s*/, "").replace(/\s*\(#\d+\)\s*$/, "");
  return [{ name: described, from: "?", to: "?" }];
}

const sections = [
  ["major", "Major", "Revisats a ma, un per branca. Cap d'aquests entra sol."],
  ["minor", "Minor", "Fusionats automaticament un cop les vuit portes han passat."],
  ["patch", "Patch", "Fusionats automaticament un cop les vuit portes han passat."],
  ["unknown", "Sense classificar", "La versio no s'ha pogut llegir. Mirar-los a ma."]
];

/** The document, in the house language: Catalan without accented vowels. */
export function renderLog(entries) {
  const dated = [...entries].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  const counted = (category) => dated.filter((entry) => classify(entry.from, entry.to) === category);

  const lines = [
    "# Registre de dependencies",
    "",
    "> **Generat, no escrit.** Surt de l'historial de git amb `pnpm deps:log`, llegint els commits",
    "> amb prefix de dependencia, els de Dependabot i els nostres. No l'editis a ma: el proper cop",
    "> que es generi perdras el canvi.",
    "",
    "## Resum",
    "",
    "| Categoria | Quantes |",
    "| --- | --- |",
    ...sections.map(([category, title]) => `| ${title} | ${counted(category).length} |`),
    `| **Total** | **${dated.length}** |`,
    ""
  ];

  if (dated.length > 0) {
    const last = dated[0];
    lines.push(`Darrera actualitzacio integrada: **${last.name}** el ${last.date}.`, "");
  }

  for (const [category, title, explanation] of sections) {
    const rows = counted(category);
    lines.push(`## ${title}`, "", explanation, "");
    if (rows.length === 0) {
      lines.push("Cap.", "");
      continue;
    }
    lines.push("| Paquet | De | A | Data | Commit |", "| --- | --- | --- | --- | --- |");
    for (const row of rows) {
      lines.push(`| \`${row.name}\` | ${row.from} | ${row.to} | ${row.date} | \`${row.commit}\` |`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

/** Every dependency commit reachable from HEAD, oldest field order fixed by the format string. */
function readHistory() {
  // Unit and record separators: a commit body can hold any character that seemed like a safe
  // delimiter, so the delimiters are the two ASCII codes reserved for exactly this.
  const separator = String.fromCharCode(31);
  const record = String.fromCharCode(30);
  const output = execFileSync(
    "git",
    ["log", `--pretty=format:%h${separator}%ad${separator}%s${separator}%b${record}`, "--date=short"],
    { cwd: repositoryRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }
  );

  const entries = [];
  for (const chunk of output.split(record)) {
    const [commit, date, subject, body] = chunk.replace(/^\n/, "").split(separator);
    if (!commit || !subject) continue;
    for (const parsed of parseCommit(subject, body ?? "")) entries.push({ ...parsed, date, commit });
  }
  return entries;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const entries = readHistory();
  writeFileSync(logPath, `${renderLog(entries)}\n`, "utf8");
  console.log(`${entries.length} actualitzacions -> ${logPath.replace(repositoryRoot, ".")}`);
}

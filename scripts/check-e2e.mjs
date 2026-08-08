/**
 * The gate `pnpm check` never was: the authenticated end to end suite, run the way CI runs it.
 *
 * `pnpm check` is lint, format, typecheck, unit tests and build. None of those start a browser,
 * so "green locally" said nothing at all about the `authenticated-end-to-end` job, and three
 * pushes in a row went red on a job no local command could have caught. The differences that
 * hid the failure were not subtle once written down: local ran one spec, with one worker, over a
 * database with a day of accumulated rows; CI runs every spec, with two workers, over a database
 * created a minute earlier.
 *
 * So this reproduces all four: empty database, whole suite, two workers, CI's retry count. It
 * runs against the verify stack (3002/4002, its own database, its own secret) rather than the
 * one at 3001, so running the gate does not sign anybody out of the product they are working on.
 *
 * A test that only passes on retry is reported as a failure here even though CI would go green
 * on it. Retries inside a single run are how the suite hides tests that depend on state they do
 * not own -- the seeded ticket that was already open the second time around was found exactly
 * that way -- and a gate that tolerates them is a gate that lets the next one through.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { connect } from "node:net";
import { relative, resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, "..");
const jsonReport = resolve(repositoryRoot, "playwright-report", "authenticated.json");

function fail(title, lines) {
  console.error(`\n  ${title}\n`);
  for (const line of lines) console.error(`  ${line}`);
  console.error("");
  process.exit(1);
}

const packageManager = process.env.npm_execpath;
if (!packageManager) fail("Executa-ho amb pnpm:  pnpm check:e2e", []);

/** Every step runs through pnpm, inherits this process's environment, and stops the gate if it fails. */
function step(title, args, extraEnv = {}) {
  console.log(`\n=== ${title}`);
  const result = spawnSync(process.execPath, [packageManager, ...args], {
    cwd: repositoryRoot,
    env: { ...process.env, ...extraEnv },
    stdio: "inherit",
    shell: false
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

// ------------------------------------------------------------------ what the run needs to exist

const missing = [
  "MIGRATION_DATABASE_URL",
  "DATABASE_URL",
  "API_INTERNAL_URL",
  "APP_ORIGIN",
  "PLAYWRIGHT_BASE_URL",
  "E2E_OWNER_EMAIL",
  "E2E_OWNER_PASSWORD",
  "E2E_CREDENTIALS_FILE"
].filter((name) => !process.env[name]);

if (missing.length > 0)
  fail(`Falta configuracio a .env.verify: ${missing.join(", ")}.`, [
    "Aquest gate corre contra la pila de verificacio, no contra la de 3001.",
    "",
    "Copia'l i posa-hi els valors locals:  Copy-Item .env.verify.example .env.verify",
    "El procediment sencer es a DEVELOPMENT.md, seccio 'Verificar sense tancar la sessio de ningu'."
  ]);

// The API compares the two on every mutating request. Different strings mean every PATCH in the
// suite comes back ORIGIN_DENIED, which reads as a broken product and is a typo in an env file.
if (process.env.APP_ORIGIN !== process.env.PLAYWRIGHT_BASE_URL)
  fail("APP_ORIGIN i PLAYWRIGHT_BASE_URL han de ser la mateixa cadena.", [
    `APP_ORIGIN          = ${process.env.APP_ORIGIN}`,
    `PLAYWRIGHT_BASE_URL = ${process.env.PLAYWRIGHT_BASE_URL}`,
    "",
    "Si no ho son, totes les mutacions de la tanda tornen ORIGIN_DENIED."
  ]);

// Resetting one database and then running against another is a silent way to test nothing.
const migrationDatabase = new URL(process.env.MIGRATION_DATABASE_URL).pathname;
const runtimeDatabase = new URL(process.env.DATABASE_URL).pathname;
if (migrationDatabase !== runtimeDatabase)
  fail("MIGRATION_DATABASE_URL i DATABASE_URL apunten a bases diferents.", [
    `Migracions: ${migrationDatabase}`,
    `Aplicacio:  ${runtimeDatabase}`,
    "",
    "El reinici esborraria una base i la suite correria contra l'altra."
  ]);

/**
 * The flags CI declares are read out of the workflow instead of copied here.
 *
 * A module behind a flag that is off answers 404, so a suite run without the flag tests a 404
 * and passes. Two copies of the list would let this gate drift from the job it exists to
 * predict, and the drift would show up as a red CI run on a green local check -- the exact
 * failure mode this file was written to remove.
 */
function flagsDeclaredByCi() {
  const workflow = readFileSync(resolve(repositoryRoot, ".github/workflows/ci.yml"), "utf8");
  const job = workflow.slice(workflow.indexOf("authenticated-end-to-end:"));
  const declared = /^\s*CONTROL_HUB_FLAGS:\s*(\S+)\s*$/m.exec(job);
  return declared
    ? declared[1]
        .split(",")
        .map((flag) => flag.trim())
        .filter(Boolean)
    : [];
}

const localFlags = (process.env.CONTROL_HUB_FLAGS ?? "")
  .split(",")
  .map((flag) => flag.trim())
  .filter(Boolean);
const missingFlags = flagsDeclaredByCi().filter((flag) => !localFlags.includes(flag));
if (missingFlags.length > 0)
  fail(`CONTROL_HUB_FLAGS no cobreix el que porta CI: falta ${missingFlags.join(", ")}.`, [
    "Afegeix-les a .env.verify. Sense una flag, les seves rutes no es declaren i responen 404,",
    "aixi que la suite passaria provant un 404 i CI seguiria en vermell."
  ]);

/**
 * The gate starts its own web and API, so their ports have to be free.
 *
 * Reusing a `next dev` that somebody left open is how a run gets answered by a process whose
 * render worker died two hours ago: the whole suite fails on a 500 that has nothing to do with
 * the code under test, and CI, which starts its processes a minute before the first test, never
 * shows it. Refusing is cheap; `pnpm dev` at 3001 is untouched either way.
 */
function portInUse(port) {
  return new Promise((resolveProbe) => {
    const socket = connect({ port, host: "127.0.0.1" });
    const settle = (answer) => {
      socket.destroy();
      resolveProbe(answer);
    };
    socket.setTimeout(1_500);
    socket.on("connect", () => settle(true));
    socket.on("timeout", () => settle(false));
    socket.on("error", () => settle(false));
  });
}

const ports = [
  ["web", Number(new URL(process.env.PLAYWRIGHT_BASE_URL).port)],
  ["API", Number(new URL(process.env.API_INTERNAL_URL).port)]
];
const busy = (
  await Promise.all(ports.map(async ([role, port]) => ((await portInUse(port)) ? [role, port] : null)))
).filter(Boolean);

if (busy.length > 0)
  fail(`La pila de verificacio ja esta amunt: ${busy.map(([role, port]) => `${role} a ${port}`).join(", ")}.`, [
    "Atura-la; aquest gate aixeca la seva, com fa CI:  atura el `pnpm dev:verify` que tinguis obert.",
    "",
    "No es manio: un `next dev` que porta hores obert pot respondre 500 a tota la suite amb el",
    "worker de render mort, i CI no ho veu mai perque arrenca els seus processos abans de correr.",
    "El `pnpm dev` de 3001 no s'ha de tocar."
  ]);

// --------------------------------------------------------------------------------- the run

if (step("Infraestructura", ["exec", "node", "scripts/check-infra.mjs", "mailpit"]) !== 0) process.exit(1);
if (step("Base neta", ["exec", "node", "scripts/run-local-command.mjs", "reset:e2e"]) !== 0) process.exit(1);
if (step("Migracions", ["exec", "node", "scripts/run-local-command.mjs", "migrate"]) !== 0) process.exit(1);
if (step("Sembra", ["exec", "node", "scripts/run-local-command.mjs", "seed:e2e"]) !== 0) process.exit(1);

/**
 * `--workers 2` and `--retries 2` are CI's numbers, not the config's local ones. Two workers
 * share one database and one session, and that sharing is what the suite has to survive.
 * `E2E_OWN_SERVERS` makes Playwright start the web and the API itself rather than adopting
 * whatever happens to be listening, which is the other half of running this the way CI does.
 */
const status = step(
  "Suite autenticada (2 workers, com CI)",
  [
    "exec",
    "playwright",
    "test",
    "--project",
    "setup",
    "--project",
    "authenticated",
    "--workers",
    "2",
    "--retries",
    "2",
    "--reporter",
    "list,json"
  ],
  { PLAYWRIGHT_JSON_OUTPUT_NAME: jsonReport, E2E_OWN_SERVERS: "1" }
);

// ------------------------------------------------------------------- tests that only passed twice

function flakyTitles(node, titles = []) {
  for (const suite of node.suites ?? []) flakyTitles(suite, titles);
  for (const spec of node.specs ?? [])
    if ((spec.tests ?? []).some((test) => test.status === "flaky")) titles.push(spec.title);
  return titles;
}

let flaky = [];
try {
  const report = JSON.parse(readFileSync(jsonReport, "utf8"));
  flaky = flakyTitles(report);
} catch {
  // No report means the run never got far enough to write one. Its own exit status is the answer.
}

if (status !== 0) {
  console.error("\n  La suite autenticada ha fallat. L'informe:  pnpm exec playwright show-report\n");
  process.exit(status);
}

if (flaky.length > 0)
  fail(`${flaky.length} prova(es) nomes han passat al reintent:`, [
    ...flaky.map((title) => `- ${title}`),
    "",
    "CI ho donaria per bo i aquest gate no, a proposit: un reintent que salva una prova vol dir",
    "que depen d'estat que no controla, i el reintent passa dins de la mateixa execucio.",
    `Traces i captures a ${relative(repositoryRoot, jsonReport)} i a test-results/.`
  ]);

console.log("\n  La suite autenticada passa sencera, amb dos workers i sobre una base neta.\n");

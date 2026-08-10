/**
 * Refuses to start the development stack when the things it depends on are not there.
 *
 * Without this the product starts perfectly and then answers every page with a 500 and a stack
 * trace ending in `ECONNREFUSED`, which reads as "the code is broken" when what actually happened
 * is that Docker Desktop was closed. That cost a session once; the information was already in
 * `/health/ready`, it just arrived far too late and in the wrong shape.
 *
 * It only ever reports and exits. Starting Docker Desktop, or a container, is left to whoever is
 * at the keyboard: a script that quietly starts things is a script that hides what it fixed.
 */
import { execFileSync } from "node:child_process";

// Extra services can be named on the command line: the end to end seed also needs somewhere to
// deliver Better Auth's verification message, and it awaits the send, so a missing Mailpit is a
// failed seed rather than a missing email.
const required = ["postgres", "valkey", ...process.argv.slice(2)];

function docker(args) {
  return execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function fail(title, lines) {
  console.error(`\n  ${title}\n`);
  for (const line of lines) console.error(`  ${line}`);
  console.error("");
  process.exit(1);
}

try {
  docker(["info", "--format", "{{.ServerVersion}}"]);
} catch {
  fail("Docker no respon, aixi que no hi ha ni base de dades ni cua.", [
    "Obre Docker Desktop, espera que digui que esta en marxa, i torna-ho a provar.",
    "Despres:  pnpm infra:up",
    "",
    "O tot d'una tirada, que ja fa les dues coses:  pnpm dev:all"
  ]);
}

let running = [];
try {
  running = docker(["compose", "ps", "--services", "--filter", "status=running"]).split(/\r?\n/).filter(Boolean);
} catch {
  fail("Docker respon pero no s'ha pogut llegir l'estat dels contenidors.", ["Prova:  pnpm infra:up"]);
}

const missing = required.filter((service) => !running.includes(service));
if (missing.length > 0) {
  fail(`Falten contenidors: ${missing.join(", ")}.`, [
    "Aixeca'ls amb:  pnpm infra:up",
    "",
    "Sense ells el web arrenca igualment i despres respon 500 a cada pagina,",
    "que sembla un error del codi i no ho es."
  ]);
}

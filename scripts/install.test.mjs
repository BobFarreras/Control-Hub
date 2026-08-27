import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const read = (name) => readFileSync(new URL(`../${name}`, import.meta.url), "utf8").replaceAll("\r\n", "\n");
const installer = fileURLToPath(new URL("../deploy/install.sh", import.meta.url));
const updater = fileURLToPath(new URL("../deploy/update.sh", import.meta.url));
const install = read("deploy/install.sh");
const workflow = read(".github/workflows/release.yml");
const runbook = read("docs/runbooks/installation.md");

const registry = "ghcr.io/bobfarreras";
const digest = (byte) => `sha256:${byte.repeat(64)}`;
const releaseFile = (version, overrides = {}) =>
  [
    `CONTROL_HUB_VERSION=${version}`,
    `CONTROL_HUB_API_IMAGE=${overrides.api ?? `${registry}/control-hub-api@${digest("a")}`}`,
    `CONTROL_HUB_WORKER_IMAGE=${overrides.worker ?? `${registry}/control-hub-worker@${digest("b")}`}`,
    `CONTROL_HUB_MIGRATE_IMAGE=${overrides.migrate ?? `${registry}/control-hub-migrate@${digest("c")}`}`,
    `CONTROL_HUB_WEB_IMAGE=${overrides.web ?? `${registry}/control-hub-web@${digest("d")}`}`,
    ...(overrides.extra ?? [])
  ].join("\n") + "\n";

/** The answers, in the order the installer asks for them. An empty string takes the default. */
const answers = {
  domain: "hub.example.com",
  ownerEmail: "owner@example.com",
  ownerName: "Ada Lovelace",
  organisation: "Avant Business",
  slug: "",
  smtpHost: "smtp.example.com",
  smtpPort: "",
  smtpSecure: "",
  from: "",
  modules: "",
  backups: "",
  go: "y"
};

/**
 * A directory holding what the release package holds, and nothing else.
 *
 * `--dry-run` reaches every question, every validation, the secret files and the release check,
 * and stops before the first `docker`. That is the half where a mistake would be silent: a
 * validator that accepts everything reads exactly like one that works, and an installer that
 * regenerates a password on a second run looks fine right up until PostgreSQL refuses it.
 */
function packageDirectory() {
  const directory = mkdtempSync(join(tmpdir(), "control-hub-install-"));
  mkdirSync(join(directory, "deploy", "postgres"), { recursive: true });
  for (const file of ["compose.yaml", "compose.release.yaml", "compose.production.yaml"]) {
    writeFileSync(join(directory, file), "# fixture\n");
  }
  writeFileSync(join(directory, "deploy", "postgres", "init-app-user.sh"), "# fixture\n");
  return directory;
}

function run(
  directory,
  { published = releaseFile("1.0.0"), given = {}, script = installer, args = ["--dry-run"] } = {}
) {
  const source = join(directory, "published.env");
  writeFileSync(source, published);
  const replies = { ...answers, ...given };
  try {
    const stdout = execFileSync("sh", [script, ...args], {
      cwd: directory,
      encoding: "utf8",
      input: Object.values(replies).join("\n") + "\n",
      env: {
        ...process.env,
        SECRETS_DIRECTORY: join(directory, "secrets"),
        CONTROL_HUB_RELEASE_URL: pathToFileURL(source).href
      },
      stdio: ["pipe", "pipe", "pipe"]
    });
    return { ok: true, output: stdout };
  } catch (error) {
    return { ok: false, output: `${error.stdout ?? ""}${error.stderr ?? ""}` };
  }
}

const cleanly = (body) => {
  const directory = packageDirectory();
  try {
    return body(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
};

test("it installs from the answers and writes what the stack reads", () => {
  cleanly((directory) => {
    const result = run(directory);
    assert.ok(result.ok, result.output);
    const environment = readFileSync(join(directory, ".env"), "utf8");
    assert.match(environment, /^APP_ORIGIN=https:\/\/hub\.example\.com$/m);
    // The domain has to reach all three, and they are three different variables: a passkey
    // registered against the wrong relying party is one nobody can use and nobody can explain.
    assert.match(environment, /^WEBAUTHN_RP_ID=hub\.example\.com$/m);
    assert.match(environment, /^WEBAUTHN_ORIGIN=https:\/\/hub\.example\.com$/m);
    assert.match(environment, /^MCP_ISSUER=https:\/\/hub\.example\.com$/m);
    assert.match(environment, /^SECRETS_PROVIDER=runtime_files$/m);
    assert.match(readFileSync(join(directory, "release.env"), "utf8"), /CONTROL_HUB_VERSION=1\.0\.0/);
  });
});

test("nothing it asks for is a password, and no secret reaches the screen", () => {
  // Invariant 8. The installer generates every secret and writes it straight to a file; a value
  // that reached the terminal would be in the scrollback of whoever installed it, and a value in
  // `.env` would be on disk in plain text for the life of the installation.
  cleanly((directory) => {
    const result = run(directory);
    assert.ok(result.ok, result.output);
    // No question it asks is about a password, and nothing it reads is one. Asserted on the script
    // rather than on the transcript, because the transcript also carries the sentence explaining
    // that it does not ask -- and a check that a word is absent from prose is a check that breaks
    // the next time somebody rewords the prose.
    for (const [, prompt] of install.matchAll(/^ask "([^"]*)"/gm)) {
      assert.doesNotMatch(prompt, /password|secret|key/i, `the installer asks: ${prompt}`);
    }
    assert.doesNotMatch(install, /read -r *(password|secret)/i, "the installer reads a secret from the terminal");

    const environment = readFileSync(join(directory, ".env"), "utf8");
    const secrets = join(directory, "secrets");
    for (const name of [
      "postgres_admin_password",
      "postgres_app_password",
      "better_auth_secret",
      "database_url",
      "migration_database_url",
      "connector_key_ring"
    ]) {
      const value = readFileSync(join(secrets, name), "utf8");
      assert.ok(value.length >= 32, `${name} is only ${value.length} characters`);
      assert.ok(!result.output.includes(value), `${name} was printed to the terminal`);
      assert.ok(!environment.includes(value), `${name} was written into .env`);
    }
    // And the file that does reach disk in the clear carries no password of any kind.
    assert.doesNotMatch(environment, /PASSWORD=/);
  });
});

test("the secrets are files only root can read", () => {
  // Read off the script rather than off the filesystem: the test suite does not run as root, and
  // the tests run on Windows too, where a mode is not a mode. The mutation that matters is somebody
  // dropping the chown or widening the mode, and that is visible here.
  assert.match(install, /chown root:root "\$path"/, "the secret files are not given to root");
  assert.match(install, /chmod 0400 "\$path"/, "the secret files are not 0400");
  assert.match(install, /chmod 0700 "\$SECRETS_DIRECTORY"/, "the secrets directory is readable by others");
  assert.match(install, /\[ "\$\(id -u\)" = "0" \]/, "a non-root installer would leave the secrets readable");
});

test("running it again reproduces the installation instead of a second one", () => {
  // Invariant 7, and the reason it is not cosmetic: the role passwords are set once, by a script
  // PostgreSQL runs on an empty data directory and never again. An installer that regenerated them
  // would write a configuration that cannot connect to its own database, and the symptom would look
  // like a corrupted volume rather than like a second run.
  cleanly((directory) => {
    assert.ok(run(directory).ok);
    const first = readFileSync(join(directory, "secrets", "database_url"), "utf8");
    const environment = readFileSync(join(directory, ".env"), "utf8");

    // Every question left blank: the second run has to find all six answers in `.env`.
    const blank = Object.fromEntries(Object.keys(answers).map((key) => [key, ""]));
    const again = run(directory, { given: { ...blank, go: "y" } });
    assert.ok(again.ok, again.output);
    assert.equal(readFileSync(join(directory, "secrets", "database_url"), "utf8"), first);
    assert.equal(readFileSync(join(directory, ".env"), "utf8"), environment);
  });
});

test("it refuses to run anywhere but an extracted release package", () => {
  const directory = mkdtempSync(join(tmpdir(), "control-hub-bare-"));
  try {
    const result = run(directory);
    assert.equal(result.ok, false);
    assert.match(result.output, /Run this from the directory the release package was extracted into/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("an incomplete package is refused rather than half-installed", () => {
  // The gap P3 recorded: `compose.yaml` mounts `deploy/postgres/init-app-user.sh` from the host, so
  // the release has to ship a small tree of files and not only YAML. Without it PostgreSQL starts
  // with no application role, and the failure surfaces much later as a permission error.
  cleanly((directory) => {
    rmSync(join(directory, "deploy", "postgres", "init-app-user.sh"));
    const result = run(directory);
    assert.equal(result.ok, false);
    assert.match(result.output, /release package is incomplete/);
  });
});

test("it and the update command refuse the same releases", () => {
  // Two scripts now read `release.env`, and two implementations of one check is a real risk. Rather
  // than a comment asking future edits to keep them in step, each corruption goes through both.
  const refusals = {
    "an image by tag rather than digest": releaseFile("1.0.0", { api: `${registry}/control-hub-api:1.0.0` }),
    "an image from somewhere else": releaseFile("1.0.0", { web: `docker.io/someone/control-hub-web@${digest("e")}` }),
    "a missing service": releaseFile("1.0.0").replace(/^CONTROL_HUB_WORKER_IMAGE=.*\n/m, ""),
    "no version at all": releaseFile("1.0.0").replace(/^CONTROL_HUB_VERSION=.*\n/m, ""),
    // `release.env` is read by Compose as environment, so a smuggled line reaches the containers.
    // The placeholder is inert on purpose: a realistic credential here would trip the secret
    // scanner for nothing.
    "a line that has no business being there": releaseFile("1.0.0", { extra: ["POSTGRES_ADMIN_PASSWORD=<injected>"] })
  };

  for (const [what, published] of Object.entries(refusals)) {
    cleanly((directory) => {
      const installed = run(directory, { published });
      assert.equal(installed.ok, false, `install.sh accepted ${what}`);
      assert.match(installed.output, /^install: /m, `install.sh refused ${what} without saying why`);
      assert.equal(existsSync(join(directory, "release.env")), false, `install.sh kept ${what}`);

      // The same file, through the command that reads it on every update afterwards.
      for (const file of ["compose.yaml", "compose.release.yaml", ".env"]) {
        writeFileSync(join(directory, file), "# fixture\n");
      }
      writeFileSync(join(directory, "release.env"), releaseFile("0.9.0"));
      const updated = run(directory, { published, script: updater, args: ["--check"] });
      assert.equal(updated.ok, false, `update.sh accepted ${what}`);
    });
  }
});

test("a rejected release leaves nothing behind for the next run to trust", () => {
  cleanly((directory) => {
    const result = run(directory, { published: releaseFile("1.0.0", { api: `${registry}/control-hub-api:1.0.0` }) });
    assert.equal(result.ok, false);
    assert.equal(existsSync(join(directory, "release.env.new")), false, "the rejected candidate survived");
  });
});

test("a domain that does not resolve is a question, and one that is not a domain is a refusal", () => {
  // The two are different. A record that does not exist yet is the normal state of a first install
  // and behind NAT the address legitimately belongs to something else, so resolution is a warning
  // somebody can answer for. A value that is not a domain at all is a typo, and every later step --
  // the certificate, the passkeys, the Owner's link -- inherits it.
  cleanly((directory) => {
    for (const domain of ["not a domain", "localhost", "hub.example.com/panel", "-hub.example.com."]) {
      const result = run(directory, { given: { domain } });
      assert.equal(result.ok, false, `«${domain}» was accepted as a domain`);
    }
  });
});

test("an address the Owner's link cannot reach is refused before anything is created", () => {
  // The mail is the only way into that account, and the bootstrap refuses to run twice: a typo
  // here is an installation nobody owns and cannot be given to anybody by re-running this.
  cleanly((directory) => {
    for (const ownerEmail of ["owner", "owner@example", "  "]) {
      const result = run(directory, { given: { ownerEmail } });
      assert.equal(result.ok, false, `«${ownerEmail}» was accepted as the Owner`);
      assert.equal(existsSync(join(directory, ".env")), false, "it wrote configuration for an Owner it cannot reach");
    }
  });
});

test("it says what it did not do, not only what it did", () => {
  // The end of an installer is where somebody decides they are finished. Everything named here is
  // something that is not true yet and that nothing else will remind them about.
  const report = install.slice(install.indexOf("What this installer did not do"));
  assert.ok(report.length > 0, "the installer never says what it left undone");
  assert.match(report, /Traefik/, "it does not say the installation is unreachable until the proxy is told");
  assert.match(report, /CONTROL_HUB_FLAGS/, "it does not say which modules are off");
  assert.match(report, /connector/i, "it does not say the connectors are unconfigured");
  assert.match(report, /backup/i, "it does not say there is no backup yet");
});

test("it does not write outside the installation directory and the secrets directory", () => {
  // Everything it produces has to be somewhere the operator can find, delete or copy. A file
  // dropped into a shared Traefik configuration directory would be an installer editing a service
  // that other people's sites depend on.
  const writes = [...install.matchAll(/(?:^|\s)(?:cat|printf|tee)[^\n]*>(?!&)\s*"?([^\s"|;]+)/gm)].map(([, to]) => to);
  assert.ok(writes.length >= 3, "no writes were found at all, so this test proves nothing");
  for (const target of writes) {
    assert.ok(
      target.startsWith("$path") ||
        target.startsWith("$SECRETS_DIRECTORY") ||
        target.startsWith("$TRAEFIK_FILE") ||
        [".env", "release.env.new", "/dev/null"].includes(target),
      `install.sh writes to ${target}`
    );
  }
  assert.match(
    install,
    /TRAEFIK_FILE="traefik-control-hub\.yaml"/,
    "the Traefik file is written outside the directory"
  );
});

test("it needs nothing a customer's server does not have", () => {
  // The point of P3 was that a production installation has no source tree. An installer that
  // reached for Node, pnpm or jq would put one back -- and it is the first thing anybody runs, so
  // the dependency would be discovered by a customer rather than by us.
  const body = install.replace(/^\s*#.*$/gm, "");
  for (const tool of [/\bnode\b/, /\bpnpm\b/, /\bjq\b/, /\bpython3?\b/, /\bopenssl\b/]) {
    assert.doesNotMatch(body, tool, `install.sh reaches for ${tool}`);
  }
});

test("the release ships the installer and the files it insists on", () => {
  // An installation has no repository to copy any of this out of, so the release is where it comes
  // from -- and the package has to carry the file tree, not only the compose files.
  assert.match(workflow, /control-hub-install\.tar\.gz/, "the release publishes no installation package");
  assert.match(workflow, /deploy\/postgres\/init-app-user\.sh/, "the package omits the file compose.yaml mounts");
  assert.match(workflow, /deploy\/install\.sh/, "the release publishes no installer");
  assert.match(workflow, /compose\.production\.yaml/, "the package omits the production overlay");
});

test("the runbook describes the installer that exists", () => {
  assert.match(runbook, /install\.sh/, "the runbook still describes an installation nobody can perform");
  // The old instruction existed because the bootstrap took a password. There is no longer one, and
  // a runbook telling somebody to delete variables that are not secret teaches the wrong lesson.
  assert.doesNotMatch(runbook, /BOOTSTRAP_OWNER_PASSWORD/, "the runbook still asks for an Owner password");
});

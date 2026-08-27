import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
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

/** Whether `nc` is on this machine, asked of the same shell the installer runs under. */
const hasNetcat = (() => {
  try {
    execFileSync("sh", ["-c", "command -v nc"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

/**
 * Whether this machine can tell the installer which ports are taken.
 *
 * Asked by running the installer's own probe rather than by looking for the binaries: Windows has a
 * `netstat`, and it rejects `-ltn`. Where the answer is no the installer keeps the preferred ports,
 * which is the behaviour that existed before any of this -- so the tests below assert that instead
 * of asserting a port moved on a machine that cannot see that it should.
 */
const probesPorts = (() => {
  try {
    const probe =
      "ss -ltn 2>/dev/null | awk 'NR > 1 { print $4 }' || netstat -ltn 2>/dev/null | awk '/^tcp/ { print $4 }'";
    return /:\d+/.test(execFileSync("sh", ["-c", probe], { encoding: "utf8" }));
  } catch {
    return false;
  }
})();

/**
 * The answers, in the order the installer asks for them. An empty string takes the default.
 *
 * A piped answer stream and a conditional question do not mix: where the question is skipped every
 * answer after it lands on the wrong one, and the failure surfaces several questions later as an
 * address or a port nobody typed. Three of the installer's questions are conditional, so all three
 * are pinned here instead of being left to the machine. The relay password is the third: it is
 * asked only when a relay user was given, so the default stream leaves the user blank and never
 * reaches it, and the test that does supply one adds the answer itself.
 *
 * Both hosts are `.invalid`, which RFC 6761 reserves so that it can never be installed in the DNS.
 * That makes «this name does not resolve» true everywhere, so the domain warning always appears and
 * `nc` always fails at once instead of waiting out its timeout. What the machine still decides is
 * whether `nc` exists at all -- asked here the same way the installer asks it. With
 * `hub.example.com` this passed on Windows, which has neither `getent` nor `nc`, and failed in CI,
 * which has both.
 */
const answers = {
  domain: "hub.invalid",
  domainAnyway: "y",
  ownerEmail: "owner@example.com",
  ownerName: "Ada Lovelace",
  organisation: "Avant Business",
  slug: "",
  smtpHost: "smtp.invalid",
  smtpPort: "",
  smtpSecure: "",
  from: "",
  relayUser: "",
  // `null` rather than "": the question is not asked at all when the user above is blank, so an
  // empty answer here would be consumed by the next question. `run` drops it, and a test that does
  // supply a user overrides it in place -- which is the only way to keep it in the right position,
  // since a key added through `given` would be appended after every other answer.
  relayPassword: null,
  ...(hasNetcat ? { mailAnyway: "y" } : {}),
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
  for (const file of [
    "compose.yaml",
    "compose.release.yaml",
    "compose.production.yaml",
    "compose.production.smtp.yaml"
  ]) {
    writeFileSync(join(directory, file), "# fixture\n");
  }
  writeFileSync(join(directory, "deploy", "postgres", "init-app-user.sh"), "# fixture\n");
  fakeDocker(directory, "");
  return directory;
}

/**
 * A `docker` on PATH that answers whatever a test needs it to.
 *
 * The installer looks at the running Traefik to decide how to publish itself, and a test that let
 * it look at the real daemon would assert something about whichever containers happen to be up on
 * the machine running the suite. Every package directory gets one of these reporting an empty
 * daemon, so the default is «no proxy found» everywhere; the proxy tests replace it.
 *
 * `containers` is the `docker ps --format '{{.ID}} {{.Image}}'` output, and `answers` maps a
 * fragment of an inspect format string to what that inspect should print.
 */
function fakeDocker(directory, containers, answers = {}) {
  const bin = join(directory, "bin");
  mkdirSync(bin, { recursive: true });
  const branches = Object.entries(answers)
    // `%b`, not `%s`: the replies are JSON-quoted into the script, so a newline in one arrives as a
    // literal backslash-n and only `%b` turns it back into the line break the real format produces.
    .map(([needle, reply]) => `    *${needle}*) printf '%b\\n' ${JSON.stringify(reply)} ;;`)
    .join("\n");
  writeFileSync(
    join(bin, "docker"),
    [
      "#!/bin/sh",
      'if [ "$1" = ps ]; then',
      // `%b` here too, and it matters more than it looks: without the real trailing newline a
      // `while read` over this output assigns the line and then returns non-zero, so the loop body
      // never runs and the installer sees a daemon with no containers in it.
      `  printf '%b' ${JSON.stringify(containers)}`,
      "  exit 0",
      "fi",
      'if [ "$1" = inspect ]; then',
      '  case "$*" in',
      branches,
      "    *) : ;;",
      "  esac",
      "  exit 0",
      "fi",
      "exit 0",
      ""
    ].join("\n"),
    { mode: 0o755 }
  );
  return bin;
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
      input:
        Object.values(replies)
          .filter((answer) => answer !== null)
          .join("\n") + "\n",
      env: {
        ...process.env,
        // Prepended, so the stub wins over a real docker on the machine running the suite.
        PATH: `${join(directory, "bin")}${process.platform === "win32" ? ";" : ":"}${process.env.PATH}`,
        SECRETS_DIRECTORY: join(directory, "secrets"),
        // A `file://` URL, which `curl` reads and `wget` does not -- so on a machine with only
        // `wget` nothing downloads and every test that asserts a refusal passes for the wrong
        // reason. What keeps that from being silent is the first test below: it reads the version
        // out of the release the installer wrote, so a fixture that cannot download is red there
        // before it is misleading anywhere else. Serving this over HTTP instead is not open, since
        // the installer is run through `execFileSync` and a server in this process cannot answer
        // while that call holds the loop.
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
    assert.match(environment, /^APP_ORIGIN=https:\/\/hub\.invalid$/m);
    // The domain has to reach all three, and they are three different variables: a passkey
    // registered against the wrong relying party is one nobody can use and nobody can explain.
    assert.match(environment, /^WEBAUTHN_RP_ID=hub\.invalid$/m);
    assert.match(environment, /^WEBAUTHN_ORIGIN=https:\/\/hub\.invalid$/m);
    assert.match(environment, /^MCP_ISSUER=https:\/\/hub\.invalid$/m);
    assert.match(environment, /^SECRETS_PROVIDER=runtime_files$/m);
    assert.match(readFileSync(join(directory, "release.env"), "utf8"), /CONTROL_HUB_VERSION=1\.0\.0/);
  });
});

test("the only password it asks for is the one it cannot generate, and no secret reaches the screen", () => {
  // Invariant 8. The installer generates every secret it can and writes it straight to a file; a
  // value that reached the terminal would be in the scrollback of whoever installed it, and a value
  // in `.env` would be on disk in plain text for the life of the installation.
  cleanly((directory) => {
    const result = run(directory);
    assert.ok(result.ok, result.output);
    // No visible question is about a password, and the one password question is not visible.
    // Asserted on the script rather than on the transcript, because the transcript also carries the
    // prose explaining the rule -- and a check that a word is absent from prose is a check that
    // breaks the next time somebody rewords it.
    for (const [, prompt] of install.matchAll(/^ask "([^"]*)"/gm)) {
      assert.doesNotMatch(prompt, /password|secret|key/i, `the installer asks in the clear: ${prompt}`);
    }
    // The relay password is the single exception, and it is an exception because the credential
    // belongs to somebody else's relay. It goes through `ask_hidden`, which turns the echo off --
    // and this is the assertion that stops a future edit from moving a prompt back to `ask`.
    const hidden = [...install.matchAll(/^\s*ask_hidden "([^"]*)"/gm)].map(([, prompt]) => prompt);
    assert.deepEqual(hidden, ["Relay password"], "the set of hidden questions changed");
    assert.match(install, /stty -echo/, "the relay password is typed in the clear");
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

test("a relay credential becomes a mounted secret, and a relay without one mounts nothing", () => {
  // The three defects P8 fixes all had the same shape: the installer assumed the state of the
  // machine instead of looking at it. This is the mail half. An installation whose relay refuses
  // unauthenticated sessions -- which is nearly all of them -- could not send the Owner their link,
  // and the failure arrived after the install reported success.
  cleanly((directory) => {
    const result = run(directory, { given: { relayUser: "hub@example.com", relayPassword: "relay-password" } });
    assert.ok(result.ok, result.output);

    const stored = readFileSync(join(directory, "secrets", "smtp_password"), "utf8");
    assert.equal(stored, "relay-password");
    assert.ok(!result.output.includes("relay-password"), "the relay password was printed to the terminal");

    const environment = readFileSync(join(directory, ".env"), "utf8");
    assert.match(environment, /^SMTP_USER=hub@example\.com$/m);
    assert.ok(!environment.includes("relay-password"), "the relay password was written into .env");
  });

  cleanly((directory) => {
    const result = run(directory);
    assert.ok(result.ok, result.output);
    assert.equal(existsSync(join(directory, "secrets", "smtp_password")), false);
    // Blank, not absent: the configuration layer reads an empty value as «no credential», and a
    // line that is present is a line somebody can fill in later without knowing the variable exists.
    assert.match(readFileSync(join(directory, ".env"), "utf8"), /^SMTP_USER=$/m);
  });
});

test("it writes ports this machine is not already using", async () => {
  // The second of P8's three defects. `POSTGRES_PORT=5432` was written into `.env` as a constant,
  // and on the machine D2 describes that port belongs to `supabase-pooler`. The symptom arrived
  // long after the cause -- «port is already allocated» from `docker compose up`, after the secrets
  // and the configuration were written -- and it could not be corrected, because `.env` is rewritten
  // whole on every run, so editing it and re-running undid the edit.
  const ports = cleanly((directory) => {
    const result = run(directory);
    assert.ok(result.ok, result.output);
    const environment = readFileSync(join(directory, ".env"), "utf8");
    return ["WEB_PORT", "API_PORT", "POSTGRES_PORT", "REDIS_PORT"].map((name) => {
      const [, value] = environment.match(new RegExp(`^${name}=(\\d+)$`, "m")) ?? [];
      assert.ok(value, `${name} is not a port number`);
      return Number(value);
    });
  });

  for (const [index, preferred] of [3001, 4000, 5432, 6379].entries()) {
    assert.ok(ports[index] >= preferred, `it moved down from ${preferred} to ${ports[index]}`);
  }

  if (!probesPorts) return;
  // And they are free, proved the only way that is not a second reading of the same list: by
  // binding them. A machine that cannot probe keeps the preferred ports whether or not they are
  // taken, so this half only runs where the installer could actually have looked.
  for (const port of ports) {
    await new Promise((resolve, reject) => {
      const probe = createServer();
      probe.once("error", (error) => reject(new Error(`the installer chose ${port}, which is taken: ${error.code}`)));
      probe.listen(port, "127.0.0.1", () => probe.close(resolve));
    });
  }
});

test("ports already chosen are kept, never probed again", () => {
  // Invariant 7, and the reason probing is conditional. On a re-run the installation itself is
  // holding these ports, so an installer that looked would find all four busy and walk the
  // configuration off its own ports -- which is an update that silently moves the address the
  // reverse proxy was told to send traffic to.
  cleanly((directory) => {
    assert.ok(run(directory).ok);
    const chosen = readFileSync(join(directory, ".env"), "utf8").replace(/^WEB_PORT=\d+$/m, "WEB_PORT=3999");
    writeFileSync(join(directory, ".env"), chosen);

    const again = run(directory);
    assert.ok(again.ok, again.output);
    assert.match(readFileSync(join(directory, ".env"), "utf8"), /^WEB_PORT=3999$/m);
  });
});

test("it publishes itself the way the Traefik on this machine actually works", () => {
  // The third of P8's defects, and the one that failed most quietly. The installer always wrote the
  // same traefik-control-hub.yaml: `certResolver: letsencrypt`, and a service at
  // `http://127.0.0.1:3001`. On the machine D2 describes the resolver is called `myresolver`,
  // 127.0.0.1 inside the Traefik container is Traefik itself, and that Traefik runs with
  // `--providers.docker` and no file provider at all -- so the file had nowhere to go. It produced
  // something that read as correct, which is worse than producing nothing.
  cleanly((directory) => {
    fakeDocker(directory, "abc123 traefik:v3.1\n", {
      "Config.Cmd":
        "traefik --providers.docker=true --entrypoints.web.address=:80 " +
        "--entrypoints.websecure.address=:443 --certificatesresolvers.myresolver.acme.tlschallenge=true ",
      NetworkSettings: "traefik-public bridge "
    });

    const result = run(directory);
    assert.ok(result.ok, result.output);

    const proxy = readFileSync(join(directory, "compose.proxy.yaml"), "utf8");
    assert.match(proxy, /traefik\.http\.routers\.control-hub\.tls\.certresolver: "myresolver"/);
    assert.match(proxy, /traefik\.http\.routers\.control-hub\.entrypoints: "websecure"/);
    assert.match(proxy, /traefik\.docker\.network: "traefik-public"/);
    assert.match(proxy, /traefik\.http\.routers\.control-hub\.rule: "Host\(`hub\.invalid`\)"/);
    // The web service keeps the network it already had. A list replaces rather than merges, so an
    // overlay naming only the proxy network would take the web tier off `application` -- and the
    // symptom would be a site that Traefik reaches and that cannot reach its own API.
    assert.match(proxy, /networks: \[application, traefik-public\]/);
    assert.match(proxy, /^ {2}traefik-public:\n {4}external: true$/m);
    // 3001 is the port inside the container. The published 127.0.0.1 port does not exist on the
    // network Traefik uses to reach it, and naming it here would route to nothing.
    assert.match(proxy, /loadbalancer\.server\.port: "3001"/);
    assert.doesNotMatch(proxy, /127\.0\.0\.1/);

    // Nothing to carry anywhere, so the closing report must not send anybody to copy a file.
    assert.doesNotMatch(result.output, /Copy traefik-control-hub\.yaml/);
  });
});

test("it reads the resolver off a neighbour when Traefik does not name it on the command line", () => {
  // The arrangement on the machine D2 describes. Traefik is started with `--providers.docker=true`
  // and its resolvers declared in a static file, so the command line says nothing about them -- and
  // the only place `myresolver` appears anywhere is on the containers already routed by it.
  // Reading it off a neighbour is still reading this machine, which is the whole distinction
  // between looking and inventing.
  cleanly((directory) => {
    fakeDocker(directory, "abc123 traefik:v3.1\n", {
      "Config.Cmd": "traefik --providers.docker=true ",
      NetworkSettings: "traefik-public bridge ",
      "Config.Labels":
        "traefik.enable=true\ntraefik.http.routers.n8n.entrypoints=websecure\n" +
        "traefik.http.routers.n8n.tls.certresolver=myresolver\ntraefik.docker.network=traefik-public\n"
    });

    const result = run(directory);
    assert.ok(result.ok, result.output);
    const proxy = readFileSync(join(directory, "compose.proxy.yaml"), "utf8");
    assert.match(proxy, /certresolver: "myresolver"/);
    assert.match(proxy, /entrypoints: "websecure"/);
    assert.doesNotMatch(result.output, /is a guess/);
  });
});

test("it invents no resolver name when it cannot read one", () => {
  // «letsencrypt» is what it used to write on every machine. Keeping that as a fallback is fine as
  // long as it is labelled as the guess it is: a name this script made up produces a configuration
  // that looks finished and never obtains a certificate.
  cleanly((directory) => {
    fakeDocker(directory, "abc123 traefik:v3.1\n", {
      "Config.Cmd": "traefik --providers.docker=true ",
      NetworkSettings: "traefik-public bridge "
    });

    const result = run(directory);
    assert.ok(result.ok, result.output);
    assert.equal(existsSync(join(directory, "compose.proxy.yaml")), false, "it published itself on a guess");
    assert.match(result.output, /is a guess/);
    assert.match(readFileSync(join(directory, "traefik-control-hub.yaml"), "utf8"), /certResolver: letsencrypt/);
  });
});

test("a Traefik that reads files is told so, and gets the resolver it really uses", () => {
  cleanly((directory) => {
    fakeDocker(directory, "abc123 traefik:v2.11\n", {
      "Config.Cmd":
        "traefik --providers.file.directory=/etc/traefik/dynamic " +
        "--entrypoints.websecure.address=:443 --certificatesresolvers.acmehttp.acme.email=x@y.z ",
      NetworkSettings: "traefik-public "
    });

    const result = run(directory);
    assert.ok(result.ok, result.output);
    assert.equal(existsSync(join(directory, "compose.proxy.yaml")), false);
    const file = readFileSync(join(directory, "traefik-control-hub.yaml"), "utf8");
    assert.match(file, /certResolver: acmehttp/);
    assert.doesNotMatch(result.output, /is a guess/);
    assert.match(result.output, /file provider/);
  });
});

test("with no proxy running it says so instead of describing one", () => {
  cleanly((directory) => {
    const result = run(directory);
    assert.ok(result.ok, result.output);
    assert.equal(existsSync(join(directory, "compose.proxy.yaml")), false);
    assert.match(result.output, /No Traefik was found running here/);
  });
});

test("the update command loads the routing the installer wrote", () => {
  // Nothing ships compose.proxy.yaml, so its presence is a fact about this installation. An update
  // that left it out would bring the containers back without the labels Traefik routes by, and the
  // address would stop answering with nothing in any log to say why.
  assert.match(read("deploy/update.sh"), /compose\.proxy\.yaml/, "update.sh drops the routing on the first update");
  assert.match(install, /compose\.proxy\.yaml/);
});

test("a relay user with no password is refused rather than half-configured", () => {
  // Half a credential is not a smaller version of one. The transport would offer AUTH with an empty
  // password, the relay would refuse every message, and nothing would say so until the first one
  // mattered -- and the first one that matters is the Owner's only way into the installation.
  cleanly((directory) => {
    const result = run(directory, { given: { relayUser: "hub@example.com", relayPassword: "" } });
    assert.equal(result.ok, false, "the installer accepted a relay user with no password");
    assert.match(result.output, /password/i);
  });
});

test("the installer and the update command load the same relay overlay", () => {
  // Decided by `SMTP_USER` in both, and it has to be: the overlay ships in every package, so its
  // presence on disk says nothing about whether this installation has a credential. An overlay one
  // script loads and the other does not is an installation that loses the mount on its first
  // update -- and the symptom is mail that stopped working after an upgrade nobody connects to it.
  const update = read("deploy/update.sh");
  for (const [name, source] of [
    ["install.sh", install],
    ["update.sh", update]
  ]) {
    assert.match(source, /compose\.production\.smtp\.yaml/, `${name} never loads the relay overlay`);
    assert.match(source, /smtp_user/, `${name} does not decide the overlay from SMTP_USER`);
  }
});

test("the secrets are files only root can read", () => {
  // Read off the script rather than off the filesystem: the test suite does not run as root, and
  // the tests run on Windows too, where a mode is not a mode. The mutation that matters is somebody
  // dropping the chown or widening the mode, and that is visible here.
  assert.match(install, /chown root:root "\$SECRETS_DIRECTORY\/smtp_password"/, "the relay password is not root's");
  assert.match(install, /chmod 0400 "\$SECRETS_DIRECTORY\/smtp_password"/, "the relay password is not 0400");
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

    // Every question left blank: the second run has to find all six answers in `.env`. The
    // confirmations keep theirs -- they are not questions, and a blank one means «no» and stops.
    // A `null` default stays null: it marks a question this run does not reach, and turning it into
    // a blank answer would put a line back into the stream that nothing consumes.
    const blank = Object.fromEntries(
      Object.keys(answers)
        .filter((key) => !/Anyway$/.test(key) && key !== "go" && answers[key] !== null)
        .map((key) => [key, ""])
    );
    const again = run(directory, { given: blank });
    assert.ok(again.ok, again.output);
    assert.equal(readFileSync(join(directory, "secrets", "database_url"), "utf8"), first);
    assert.equal(readFileSync(join(directory, ".env"), "utf8"), environment);
  });
});

test("a second run keeps the stored relay password, and a typed one replaces it", () => {
  // The one secret here the installer does not own. Every other file is written once and never
  // rewritten, because regenerating a database password would leave PostgreSQL holding the old one
  // -- but a relay password belongs to the relay and does change, so this one has to be replaceable
  // without making the operator retype it on every unrelated re-run.
  cleanly((directory) => {
    const stored = join(directory, "secrets", "smtp_password");
    assert.ok(run(directory, { given: { relayUser: "hub@example.com", relayPassword: "first" } }).ok);
    assert.equal(readFileSync(stored, "utf8"), "first");

    // The user comes back from `.env`, so the question is asked again and the blank answer means
    // «keep it». A run that demanded the password again would be a run somebody performs from a
    // password manager, in a terminal, under time pressure.
    const kept = run(directory, { given: { relayUser: "", relayPassword: "" } });
    assert.ok(kept.ok, kept.output);
    assert.equal(readFileSync(stored, "utf8"), "first");

    const rotated = run(directory, { given: { relayUser: "", relayPassword: "second" } });
    assert.ok(rotated.ok, rotated.output);
    assert.equal(readFileSync(stored, "utf8"), "second");
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
    for (const domain of ["not a domain", "localhost", "hub.invalid/panel", "-hub.invalid."]) {
      const result = run(directory, { given: { domain } });
      assert.equal(result.ok, false, `«${domain}» was accepted as a domain`);
    }
  });
});

test("the resolver's own address is not mistaken for an answer", () => {
  // `nslookup` is the branch taken by machines without `getent` -- Windows and macOS, which is to
  // say most of the machines a first installation is prepared from. Reading the `Address:` lines
  // that sit above `Name:` returned the resolver's own address for every name asked about, so a
  // domain with a typo in it looked like one that resolves and the warning never appeared. The
  // check silently did nothing exactly where it was most needed.
  //
  // The awk program is read out of the installer rather than written again here: a second copy of
  // it would only move the disagreement somewhere no test is looking.
  const [, program] = install.match(/^ *answer='([^']*)'/m) ?? [];
  assert.ok(program, "the installer no longer reads nslookup through a named awk program");
  const parse = (output) =>
    execFileSync("sh", ["-c", 'awk "$1"', "sh", program], { input: output, encoding: "utf8" }).trim();

  const header = "Server:  UnKnown\nAddress:  192.168.1.1\n\n";
  assert.equal(parse(`${header}*** UnKnown can't find hub.invalid: Non-existent domain\n`), "");
  assert.equal(parse(`${header}Name:    hub.example.com\nAddress:  93.184.215.14\n`), "93.184.215.14");
  // Linux separates with tabs and lists every address it has; any one of them is an answer.
  const several = `${header}Name:\thub.example.com\nAddresses:  2606:2800::1\n          93.184.215.14\n`;
  assert.equal(parse(several), "2606:2800::1");
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
        [".env", "compose.proxy.yaml", "release.env.new", "/dev/null"].includes(target),
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

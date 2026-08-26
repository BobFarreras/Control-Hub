import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const read = (name) => readFileSync(new URL(`../${name}`, import.meta.url), "utf8").replaceAll("\r\n", "\n");
const script = fileURLToPath(new URL("../deploy/update.sh", import.meta.url));
const workflow = read(".github/workflows/release.yml");
const update = read("deploy/update.sh");

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

/**
 * An installation directory with nothing in it but the files the command insists on.
 *
 * `--check` reaches the download, the validation and the comparison and stops before it needs
 * docker, so these run the real script rather than reading it -- which is the half where a mistake
 * would be silent, because a validator that accepts everything looks exactly like one that works.
 */
function installation(currentVersion = "1.0.0") {
  const directory = mkdtempSync(join(tmpdir(), "control-hub-update-"));
  for (const file of ["compose.yaml", "compose.release.yaml", ".env"]) {
    writeFileSync(join(directory, file), "# fixture\n");
  }
  writeFileSync(join(directory, "release.env"), releaseFile(currentVersion));
  return directory;
}

/** Runs the command against a release file served from disk, and reports how it went. */
function run(directory, published, args = ["--check"]) {
  const source = join(directory, "published.env");
  writeFileSync(source, published);
  try {
    const stdout = execFileSync("sh", [script, ...args], {
      cwd: directory,
      encoding: "utf8",
      env: { ...process.env, CONTROL_HUB_RELEASE_URL: pathToFileURL(source).href },
      stdio: ["ignore", "pipe", "pipe"]
    });
    return { ok: true, output: stdout };
  } catch (error) {
    return { ok: false, output: `${error.stdout ?? ""}${error.stderr ?? ""}` };
  }
}

test("it reports an update without changing anything", () => {
  const directory = installation("1.0.0");
  try {
    const result = run(directory, releaseFile("1.1.0"));
    assert.ok(result.ok, result.output);
    assert.match(result.output, /Installed: 1\.0\.0/);
    assert.match(result.output, /Available: 1\.1\.0/);
    assert.match(result.output, /An update is available/);
    // The installed version is still named by the file the running stack reads, and no half-written
    // candidate is left behind for a later run to mistake for the real one.
    assert.match(readFileSync(join(directory, "release.env"), "utf8"), /CONTROL_HUB_VERSION=1\.0\.0/);
    assert.equal(existsSync(join(directory, "release.env.new")), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("it says so when there is nothing to do", () => {
  const directory = installation("1.0.0");
  try {
    const result = run(directory, releaseFile("1.0.0"));
    assert.ok(result.ok, result.output);
    assert.match(result.output, /Already up to date/);
    assert.equal(existsSync(join(directory, "release.env.new")), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a release it cannot trust is refused before anything is backed up or pulled", () => {
  // Each of these is a file that reads as plausible. The one that matters is the second: four
  // references that each look right but come from two registries is not a shape a release can have,
  // and is exactly the shape a substituted image would have.
  const refusals = {
    "an image by tag rather than digest": releaseFile("1.1.0", { api: `${registry}/control-hub-api:1.1.0` }),
    "an image from somewhere else": releaseFile("1.1.0", { web: `docker.io/someone/control-hub-web@${digest("e")}` }),
    "a missing service": releaseFile("1.1.0").replace(/^CONTROL_HUB_WORKER_IMAGE=.*\n/m, ""),
    "no version at all": releaseFile("1.1.0").replace(/^CONTROL_HUB_VERSION=.*\n/m, ""),
    // An injected line is the reason this check exists: `release.env` is read by Compose as
    // environment, so anything smuggled into it reaches the containers. The placeholder is inert
    // on purpose -- a realistic-looking credential here would trip the secret scanner for no gain.
    "a line that has no business being there": releaseFile("1.1.0", { extra: ["POSTGRES_ADMIN_PASSWORD=<injected>"] })
  };

  for (const [what, published] of Object.entries(refusals)) {
    const directory = installation("1.0.0");
    try {
      const result = run(directory, published);
      assert.equal(result.ok, false, `${what} was accepted`);
      assert.match(result.output, /^update: /m, `${what} failed without saying why`);
      assert.match(readFileSync(join(directory, "release.env"), "utf8"), /CONTROL_HUB_VERSION=1\.0\.0/);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }
});

test("it refuses to run anywhere but an installation directory", () => {
  const directory = mkdtempSync(join(tmpdir(), "control-hub-empty-"));
  try {
    const result = run(directory, releaseFile("1.1.0"));
    assert.equal(result.ok, false);
    assert.match(result.output, /Run this from the installation directory/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("nothing that is running is replaced before the migrations have passed", () => {
  // The order is the whole promise: back up, pull, migrate, and only then replace. Read off the
  // script rather than executed, because executing it needs a database -- but an ordering that
  // drifted would take the promise with it silently.
  const at = (pattern) => {
    const index = update.search(pattern);
    assert.notEqual(index, -1, `${pattern} is not in update.sh at all`);
    return index;
  };
  const backup = at(/pg_dump/);
  const pull = at(/compose_new pull/);
  const migrate = at(/compose_new run --rm migrate/);
  const replace = at(/mv release\.env\.new release\.env/);
  const start = at(/compose_now up -d/);

  assert.ok(backup < pull, "the images are pulled before the backup is taken");
  assert.ok(pull < migrate, "the migrations run before the images they need are pulled");
  assert.ok(migrate < replace, "the installed version is replaced before the migrations have passed");
  assert.ok(replace < start, "the services start before the file naming them is in place");
});

test("a failed migration leaves the running version alone and says what it kept", () => {
  const failure = update.slice(
    update.indexOf("compose_new run --rm migrate"),
    update.indexOf("cp release.env release.env.previous")
  );
  assert.match(failure, /Still running/, "it does not say the old version is still up");
  assert.match(failure, /Kept: *\$backup/, "it does not say where the backup is");
  assert.match(failure, /rm -f release\.env\.new/, "the candidate release file survives a failed update");
  assert.doesNotMatch(failure, /compose_\w+ up -d/, "it starts services after the migrations failed");
});

test("a dump that fails is not mistaken for a backup", () => {
  // Measured, not assumed: `pg_dump | gzip > file` reports gzip's status, so dumping a database
  // that does not exist produced a valid 20-byte archive that `gzip -t` accepted. pg_dump's own
  // verdict has to leave the pipeline some other way, and POSIX sh has no pipefail.
  assert.match(update, /failed=\$\(mktemp\)/, "pg_dump's exit status is discarded by the pipe");
  assert.match(update, /echo yes > "\$failed"/, "nothing records that the dump failed");
  assert.match(update, /if \[ -s "\$failed" \]/, "the recorded failure is never read back");
  // And the check has to come before the update proceeds on the strength of the backup.
  assert.ok(update.indexOf('if [ -s "$failed" ]') < update.indexOf("compose_new pull"));
});

test("the backup is checked rather than assumed", () => {
  // A dump that failed mid-pipe leaves a file behind, and an unchecked file is indistinguishable
  // from a backup right up until somebody needs it.
  assert.match(update, /gzip -t "\$backup"/, "the backup is never verified as readable");
  assert.match(update, /\[ "\$size" -gt 1000 \]/, "an empty backup would pass for a real one");
});

test("the release publishes what the update command reads", () => {
  assert.match(workflow, /node scripts\/release-env\.mjs --manifest release\.json --out release\.env/);
  assert.match(
    workflow,
    /gh release upload "\$GITHUB_REF_NAME" release\.json release\.env deploy\/update\.sh --clobber/
  );
});

test("the command itself reaches the installations that need it", () => {
  // An installation has no repository to copy it out of, so the release is where it comes from.
  assert.match(workflow, /deploy\/update\.sh/, "the release publishes no update command");
});

test("the update command needs nothing a customer's server does not have", () => {
  // The point of P3 was that a production installation has no source tree. An update command that
  // reached for Node, pnpm or jq would put one back.
  for (const tool of [/\bnode\b/, /\bpnpm\b/, /\bjq\b/, /\bpython3?\b/]) {
    const body = update.replace(/^#.*$/gm, "");
    assert.doesNotMatch(body, tool, `update.sh reaches for ${tool}`);
  }
});

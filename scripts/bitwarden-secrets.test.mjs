import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { BitwardenDeployError, deployWithBitwarden, parseManifest } from "./lib/bitwarden-secrets.mjs";

const projectId = "11111111-1111-4111-8111-111111111111";
const databaseId = "22222222-2222-4222-8222-222222222222";
const authId = "33333333-3333-4333-8333-333333333333";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "control-hub-bws-"));
  const manifestPath = join(root, "manifest.json");
  const fakeBws = join(root, "fake-bws.mjs");
  const deploy = join(root, "deploy.mjs");
  writeFileSync(
    manifestPath,
    JSON.stringify({
      schemaVersion: 1,
      cliVersion: "2.1.0",
      projectId,
      secrets: [
        { name: "database_url", id: databaseId },
        { name: "better_auth_secret", id: authId }
      ]
    })
  );
  writeFileSync(
    fakeBws,
    `
const args = process.argv.slice(2);
if (args[0] === "--version") {
  process.stdout.write(process.env.BWS_FAKE_VERSION ?? "bws 2.1.0");
} else {
  const id = args[2];
  if (id === process.env.BWS_FAIL_ID) process.exit(9);
  if (id === process.env.BWS_DELAY_ID) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2000);
  process.stdout.write(JSON.stringify({
    object: "secret",
    id,
    projectId: process.env.BWS_FAKE_PROJECT,
    value: "material-" + id,
    revisionDate: "2026-08-26T08:00:00.000Z"
  }));
}
`
  );
  writeFileSync(
    deploy,
    `
import { writeFileSync } from "node:fs";
if (process.env.DEPLOY_FAIL === "1") process.exit(7);
if (process.env.DEPLOY_FAIL_ONCE) {
  try {
    writeFileSync(process.env.DEPLOY_FAIL_ONCE, "failed", { flag: "wx" });
    process.exit(7);
  } catch {}
}
writeFileSync(process.env.DEPLOY_EVIDENCE, JSON.stringify({
  accessTokenPresent: "BWS_ACCESS_TOKEN" in process.env,
  directSecretPresent: "BETTER_AUTH_SECRET" in process.env,
  secretFilePresent: "BETTER_AUTH_SECRET_FILE" in process.env,
  secretsDirectory: process.env.SECRETS_DIRECTORY,
  secretsProvider: process.env.SECRETS_PROVIDER
}));
`
  );
  return { deploy, fakeBws, manifestPath, root, secretsRoot: join(root, "secrets") };
}

function environment(extra = {}) {
  return {
    ...process.env,
    BETTER_AUTH_SECRET: "fixture",
    BETTER_AUTH_SECRET_FILE: "/must/not/reach/deploy",
    BWS_ACCESS_TOKEN: "fixture",
    BWS_FAKE_PROJECT: projectId,
    ...extra
  };
}

function expectCode(code, action) {
  assert.throws(action, (error) => error instanceof BitwardenDeployError && error.code === code);
}

test("materializes immutable IDs and strips all root credentials from the deploy command", () => {
  const context = fixture();
  const evidence = join(context.root, "evidence.json");
  const runningAsRoot = process.platform !== "win32" && typeof process.getuid === "function" && process.getuid() === 0;
  let audit = "";
  const write = process.stdout.write;
  process.stdout.write = (chunk) => {
    audit += String(chunk);
    return true;
  };
  try {
    const metadata = deployWithBitwarden({
      bwsCommand: [process.execPath, context.fakeBws],
      command: [process.execPath, context.deploy],
      environment: environment({ DEPLOY_EVIDENCE: evidence }),
      manifestPath: context.manifestPath,
      requireRoot: runningAsRoot,
      secretsRoot: context.secretsRoot
    });
    const current = join(context.secretsRoot, "current");
    const deployEvidence = JSON.parse(readFileSync(evidence, "utf8"));
    assert.equal(readFileSync(join(current, "database_url"), "utf8"), `material-${databaseId}`);
    assert.equal(metadata.secrets[0].id, databaseId);
    assert.deepEqual(deployEvidence, {
      accessTokenPresent: false,
      directSecretPresent: false,
      secretFilePresent: false,
      secretsDirectory: current,
      secretsProvider: "bitwarden"
    });
    assert.match(audit, /"event":"deployment.succeeded"/);
    assert.doesNotMatch(audit, /material-/);
    if (process.platform !== "win32") {
      const secretStat = statSync(join(current, "database_url"));
      assert.equal(secretStat.mode & 0o777, 0o600);
      if (runningAsRoot) assert.equal(secretStat.uid, 1000);
    }
  } finally {
    process.stdout.write = write;
    rmSync(context.root, { force: true, recursive: true });
  }
});

test("provider failure leaves the live release untouched", () => {
  const context = fixture();
  const current = join(context.secretsRoot, "current");
  mkdirSync(current, { recursive: true });
  writeFileSync(join(current, "sentinel"), "previous-release");
  try {
    expectCode("BWS_FETCH_FAILED", () =>
      deployWithBitwarden({
        bwsCommand: [process.execPath, context.fakeBws],
        command: [process.execPath, context.deploy],
        environment: environment({ BWS_FAIL_ID: authId, DEPLOY_EVIDENCE: join(context.root, "evidence.json") }),
        manifestPath: context.manifestPath,
        requireRoot: false,
        secretsRoot: context.secretsRoot
      })
    );
    assert.equal(readFileSync(join(current, "sentinel"), "utf8"), "previous-release");
  } finally {
    rmSync(context.root, { force: true, recursive: true });
  }
});

test("provider timeout fails closed before activation", () => {
  const context = fixture();
  const current = join(context.secretsRoot, "current");
  mkdirSync(current, { recursive: true });
  writeFileSync(join(current, "sentinel"), "previous-release");
  try {
    expectCode("BWS_FETCH_FAILED", () =>
      deployWithBitwarden({
        bwsCommand: [process.execPath, context.fakeBws],
        bwsTimeoutMs: 1000,
        command: [process.execPath, context.deploy],
        environment: environment({ BWS_DELAY_ID: databaseId }),
        manifestPath: context.manifestPath,
        requireRoot: false,
        secretsRoot: context.secretsRoot
      })
    );
    assert.equal(readFileSync(join(current, "sentinel"), "utf8"), "previous-release");
  } finally {
    rmSync(context.root, { force: true, recursive: true });
  }
});

test("failed deployment restores the previous secret release", () => {
  const context = fixture();
  const current = join(context.secretsRoot, "current");
  mkdirSync(current, { recursive: true });
  writeFileSync(join(current, "sentinel"), "previous-release");
  try {
    expectCode("DEPLOY_COMMAND_FAILED", () =>
      deployWithBitwarden({
        bwsCommand: [process.execPath, context.fakeBws],
        command: [process.execPath, context.deploy],
        environment: environment({
          DEPLOY_EVIDENCE: join(context.root, "rollback-evidence.json"),
          DEPLOY_FAIL_ONCE: join(context.root, "fail-once")
        }),
        manifestPath: context.manifestPath,
        requireRoot: false,
        secretsRoot: context.secretsRoot
      })
    );
    assert.equal(readFileSync(join(current, "sentinel"), "utf8"), "previous-release");
  } finally {
    rmSync(context.root, { force: true, recursive: true });
  }
});

test("reports a rollback failure without losing the previous secret directory", () => {
  const context = fixture();
  const current = join(context.secretsRoot, "current");
  mkdirSync(current, { recursive: true });
  writeFileSync(join(current, "sentinel"), "previous-release");
  try {
    expectCode("DEPLOY_ROLLBACK_FAILED", () =>
      deployWithBitwarden({
        bwsCommand: [process.execPath, context.fakeBws],
        command: [process.execPath, context.deploy],
        environment: environment({ DEPLOY_FAIL: "1" }),
        manifestPath: context.manifestPath,
        requireRoot: false,
        secretsRoot: context.secretsRoot
      })
    );
    assert.equal(readFileSync(join(current, "sentinel"), "utf8"), "previous-release");
  } finally {
    rmSync(context.root, { force: true, recursive: true });
  }
});

test("pins the bws version and refuses duplicate or ambiguous mappings", () => {
  const context = fixture();
  try {
    expectCode("BWS_VERSION_MISMATCH", () =>
      deployWithBitwarden({
        bwsCommand: [process.execPath, context.fakeBws],
        command: [process.execPath, context.deploy],
        environment: environment({ BWS_FAKE_VERSION: "bws 3.0.0" }),
        manifestPath: context.manifestPath,
        requireRoot: false,
        secretsRoot: context.secretsRoot
      })
    );
    const invalid = join(context.root, "invalid.json");
    writeFileSync(
      invalid,
      JSON.stringify({
        schemaVersion: 1,
        cliVersion: "2.1.0",
        projectId,
        secrets: [
          { name: "database_url", id: databaseId },
          { name: "database_url", id: authId }
        ]
      })
    );
    expectCode("MANIFEST_INVALID", () => parseManifest(invalid));
  } finally {
    rmSync(context.root, { force: true, recursive: true });
  }
});

test("rejects the wrong project and concurrent deployments", () => {
  const context = fixture();
  try {
    expectCode("BWS_IDENTITY_MISMATCH", () =>
      deployWithBitwarden({
        bwsCommand: [process.execPath, context.fakeBws],
        command: [process.execPath, context.deploy],
        environment: environment({ BWS_FAKE_PROJECT: "99999999-9999-4999-8999-999999999999" }),
        manifestPath: context.manifestPath,
        requireRoot: false,
        secretsRoot: context.secretsRoot
      })
    );
    mkdirSync(context.secretsRoot, { recursive: true });
    writeFileSync(join(context.secretsRoot, ".deploy.lock"), "active");
    expectCode("DEPLOY_LOCKED", () =>
      deployWithBitwarden({
        bwsCommand: [process.execPath, context.fakeBws],
        command: [process.execPath, context.deploy],
        environment: environment(),
        manifestPath: context.manifestPath,
        requireRoot: false,
        secretsRoot: context.secretsRoot
      })
    );
  } finally {
    rmSync(context.root, { force: true, recursive: true });
  }
});

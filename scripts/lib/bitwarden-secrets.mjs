import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  chmodSync,
  chownSync,
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const VERSION = /^\d+\.\d+\.\d+$/;
const allowedSecretNames = new Set([
  "database_url",
  "migration_database_url",
  "better_auth_secret",
  "postgres_admin_password",
  "postgres_app_password",
  "connector_key_ring",
  "google_oauth_client_secret",
  "microsoft_oauth_client_secret"
]);
const secretOwnerUid = new Map([
  ["postgres_admin_password", 70],
  ["postgres_app_password", 70]
]);
const directSecretName = /(?:PASSWORD|SECRET|TOKEN|KEY_RING|DATABASE_URL|REDIS_URL|CREDENTIALS_FILE)$/;

export class BitwardenDeployError extends Error {
  constructor(code) {
    super(code);
    this.name = "BitwardenDeployError";
    this.code = code;
  }
}

function fail(code) {
  throw new BitwardenDeployError(code);
}

function safeJsonFile(path, maxBytes = 64 * 1024) {
  if (!isAbsolute(path)) fail("MANIFEST_PATH_INVALID");
  // Opened before anything is asked about the name, so there is no interval between judging the
  // file acceptable and reading it -- the previous shape stat'ed the path first and compared
  // device and inode numbers afterwards to catch a swap, which worked but left a window that had
  // to be argued about rather than removed. `O_NOFOLLOW` refuses a symlink at the syscall, and
  // `parseManifest` has already refused any path whose realpath differs from the path itself,
  // which is what covers Windows, where the flag does not exist.
  let descriptor;
  try {
    const noFollow = process.platform === "win32" ? 0 : (constants.O_NOFOLLOW ?? 0);
    descriptor = openSync(path, constants.O_RDONLY | noFollow);
  } catch {
    fail("MANIFEST_UNREADABLE");
  }
  try {
    const stats = fstatSync(descriptor);
    if (!stats.isFile() || stats.size > maxBytes) fail("MANIFEST_UNREADABLE");
    return JSON.parse(readFileSync(descriptor, "utf8"));
  } catch (error) {
    if (error instanceof BitwardenDeployError) throw error;
    fail("MANIFEST_INVALID");
  } finally {
    closeSync(descriptor);
  }
}

export function parseManifest(path) {
  const resolvedPath = resolve(path);
  try {
    if (realpathSync(resolvedPath) !== resolvedPath) fail("MANIFEST_PATH_INVALID");
  } catch (error) {
    if (error instanceof BitwardenDeployError) throw error;
    fail("MANIFEST_UNREADABLE");
  }
  const raw = safeJsonFile(resolvedPath);
  if (!raw || raw.schemaVersion !== 1 || !UUID.test(raw.projectId) || !VERSION.test(raw.cliVersion))
    fail("MANIFEST_INVALID");
  if (!Array.isArray(raw.secrets) || raw.secrets.length === 0) fail("MANIFEST_INVALID");
  const names = new Set();
  const ids = new Set();
  const secrets = raw.secrets.map((secret) => {
    if (
      !secret ||
      typeof secret.name !== "string" ||
      !allowedSecretNames.has(secret.name) ||
      !UUID.test(secret.id) ||
      names.has(secret.name) ||
      ids.has(secret.id)
    )
      fail("MANIFEST_INVALID");
    names.add(secret.name);
    ids.add(secret.id);
    return { id: secret.id, name: secret.name };
  });
  return { cliVersion: raw.cliVersion, projectId: raw.projectId, secrets };
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    env: options.env,
    maxBuffer: options.maxBuffer ?? 128 * 1024,
    shell: false,
    timeout: options.timeout ?? 30_000
  });
  if (result.error || result.status !== 0) fail(options.errorCode ?? "COMMAND_FAILED");
  return result.stdout.trim();
}

function executable(command) {
  const parts = Array.isArray(command) ? command : [command];
  if (parts.length === 0 || parts.some((part) => typeof part !== "string") || !isAbsolute(parts[0]))
    fail("COMMAND_PATH_INVALID");
  return parts;
}

function runBws(command, args, options) {
  const [program, ...prefix] = executable(command);
  return run(program, [...prefix, ...args], options);
}

function cliVersion(command, environment, timeout) {
  const output = runBws(command, ["--version"], { env: environment, errorCode: "BWS_VERSION_FAILED", timeout });
  const match = output.match(/\b(\d+\.\d+\.\d+)\b/);
  if (!match) fail("BWS_VERSION_INVALID");
  return match[1];
}

function fetchSecret(command, secret, projectId, environment, timeout) {
  const output = runBws(command, ["secret", "get", secret.id, "--output", "json"], {
    env: environment,
    errorCode: "BWS_FETCH_FAILED",
    timeout
  });
  let record;
  try {
    record = JSON.parse(output);
    if (Array.isArray(record)) [record] = record;
  } catch {
    fail("BWS_RESPONSE_INVALID");
  }
  if (!record || record.id !== secret.id || record.projectId !== projectId) fail("BWS_IDENTITY_MISMATCH");
  if (
    typeof record.value !== "string" ||
    record.value.length === 0 ||
    record.value.includes("\0") ||
    Buffer.byteLength(record.value, "utf8") > 64 * 1024 ||
    typeof record.revisionDate !== "string" ||
    Number.isNaN(Date.parse(record.revisionDate))
  )
    fail("BWS_RESPONSE_INVALID");
  return { id: record.id, name: secret.name, revisionDate: record.revisionDate, value: record.value };
}

function writeRelease(directory, records, assignOwners) {
  mkdirSync(directory, { mode: 0o700 });
  chmodSync(directory, 0o700);
  for (const record of records) {
    const path = join(directory, record.name);
    writeFileSync(path, record.value, { encoding: "utf8", flag: "wx", mode: 0o600 });
    if (assignOwners) chownSync(path, secretOwnerUid.get(record.name) ?? 1000, secretOwnerUid.get(record.name) ?? 1000);
    chmodSync(path, 0o600);
  }
  const metadata = {
    schemaVersion: 1,
    loadedAt: new Date().toISOString(),
    secrets: records.map(({ id, name, revisionDate }) => ({ id, name, revisionDate }))
  };
  writeFileSync(join(directory, ".control-hub-secrets.json"), `${JSON.stringify(metadata, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600
  });
  return metadata;
}

function sanitizedDeploymentEnvironment(environment, currentDirectory) {
  const clean = {};
  for (const [name, value] of Object.entries(environment)) {
    if (name === "BWS_ACCESS_TOKEN" || directSecretName.test(name) || name.endsWith("_FILE")) continue;
    clean[name] = value;
  }
  clean.SECRETS_DIRECTORY = currentDirectory;
  clean.SECRETS_PROVIDER = "bitwarden";
  return clean;
}

function audit(event, details = {}) {
  process.stdout.write(`${JSON.stringify({ event, timestamp: new Date().toISOString(), ...details })}\n`);
}

export function deployWithBitwarden({
  bwsCommand,
  bwsTimeoutMs = 30_000,
  command,
  deployTimeoutMs = 15 * 60_000,
  environment = process.env,
  manifestPath,
  requireRoot = true,
  secretsRoot
}) {
  if (process.platform === "win32" && requireRoot) fail("PLATFORM_UNSUPPORTED");
  if (requireRoot && typeof process.getuid === "function" && process.getuid() !== 0) fail("ROOT_REQUIRED");
  if (!environment.BWS_ACCESS_TOKEN) fail("BWS_ACCESS_TOKEN_MISSING");
  if (!Array.isArray(command) || command.length === 0 || command.some((part) => typeof part !== "string"))
    fail("DEPLOY_COMMAND_MISSING");
  if (!isAbsolute(command[0])) fail("COMMAND_PATH_INVALID");
  if (
    !isAbsolute(secretsRoot) ||
    basename(secretsRoot) === "" ||
    resolve(secretsRoot) === resolve(dirname(secretsRoot))
  )
    fail("SECRETS_ROOT_INVALID");

  const manifest = parseManifest(manifestPath);
  const actualVersion = cliVersion(bwsCommand, environment, bwsTimeoutMs);
  if (actualVersion !== manifest.cliVersion) fail("BWS_VERSION_MISMATCH");

  mkdirSync(secretsRoot, { recursive: true, mode: 0o700 });
  const rootStat = lstatSync(secretsRoot);
  if (
    rootStat.isSymbolicLink() ||
    !rootStat.isDirectory() ||
    realpathSync(secretsRoot) !== resolve(secretsRoot) ||
    (requireRoot && process.platform !== "win32" && rootStat.uid !== 0)
  )
    fail("SECRETS_ROOT_UNSAFE");
  chmodSync(secretsRoot, 0o700);
  const lockPath = join(secretsRoot, ".deploy.lock");
  let lock;
  try {
    lock = openSync(lockPath, "wx", 0o600);
  } catch {
    fail("DEPLOY_LOCKED");
  }

  const deploymentId = randomUUID();
  const staging = join(secretsRoot, `.staging-${deploymentId}`);
  const current = join(secretsRoot, "current");
  const previous = join(secretsRoot, `.previous-${deploymentId}`);
  let currentMoved = false;
  let stagingActivated = false;
  try {
    const records = manifest.secrets.map((secret) =>
      fetchSecret(bwsCommand, secret, manifest.projectId, environment, bwsTimeoutMs)
    );
    const metadata = writeRelease(staging, records, requireRoot);
    audit("secrets.prepared", {
      deploymentId,
      secrets: metadata.secrets.map(({ id, name, revisionDate }) => ({ id, name, revisionDate }))
    });

    if (existsSync(current)) {
      renameSync(current, previous);
      currentMoved = true;
    }
    renameSync(staging, current);
    stagingActivated = true;

    const deployEnvironment = sanitizedDeploymentEnvironment(environment, current);
    const result = spawnSync(command[0], command.slice(1), {
      env: deployEnvironment,
      shell: false,
      stdio: "inherit",
      timeout: deployTimeoutMs
    });
    if (result.error || result.status !== 0) {
      const failed = join(secretsRoot, `.failed-${deploymentId}`);
      renameSync(current, failed);
      stagingActivated = false;
      let rollbackSucceeded = false;
      if (currentMoved) {
        renameSync(previous, current);
        const rollback = spawnSync(command[0], command.slice(1), {
          env: deployEnvironment,
          shell: false,
          stdio: "inherit",
          timeout: deployTimeoutMs
        });
        rollbackSucceeded = !rollback.error && rollback.status === 0;
      }
      rmSync(failed, { force: true, recursive: true });
      audit("deployment.failed", { deploymentId, rollbackAttempted: currentMoved, rollbackSucceeded });
      if (currentMoved && !rollbackSucceeded) fail("DEPLOY_ROLLBACK_FAILED");
      fail("DEPLOY_COMMAND_FAILED");
    }

    if (currentMoved) rmSync(previous, { force: true, recursive: true });
    audit("deployment.succeeded", { deploymentId, secretCount: records.length });
    return metadata;
  } catch (error) {
    if (existsSync(staging)) rmSync(staging, { force: true, recursive: true });
    if (stagingActivated && existsSync(current)) rmSync(current, { force: true, recursive: true });
    if (currentMoved && existsSync(previous) && !existsSync(current)) renameSync(previous, current);
    throw error;
  } finally {
    if (lock !== undefined) closeSync(lock);
    if (existsSync(lockPath)) unlinkSync(lockPath);
  }
}

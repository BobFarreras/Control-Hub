import { execFileSync, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";

const protectedResources = [
  "package.json",
  "pnpm-lock.yaml",
  "packages/database/migrations/**",
  ".github/workflows/**",
  "deploy/**"
];

function fail(message) {
  console.error(`\n${message}\n`);
  process.exit(1);
}

function git(args, options = {}) {
  return execFileSync("git", args, {
    cwd: options.cwd,
    encoding: "utf8",
    stdio: options.stdio ?? ["ignore", "pipe", "pipe"]
  }).trim();
}

function repositoryRoot(cwd = process.cwd()) {
  return git(["rev-parse", "--show-toplevel"], { cwd });
}

function parseEnv(source) {
  const values = new Map();
  for (const line of source.split(/\r?\n/)) {
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if (match) values.set(match[1], match[2]);
  }
  return values;
}

function serializeEnv(template, overrides) {
  const seen = new Set();
  const lines = template.split(/\r?\n/).map((line) => {
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if (!match || !overrides.has(match[1])) return line;
    seen.add(match[1]);
    const value = overrides.get(match[1]);
    return value === null ? "" : `${match[1]}=${value}`;
  });
  for (const [key, value] of overrides) if (!seen.has(key)) lines.push(`${key}=${value}`);
  return `${lines.join("\n").trimEnd()}\n`;
}

function slug(value, label) {
  const normalized = value.toLowerCase();
  if (!/^[a-z][a-z0-9-]*$/.test(normalized)) fail(`${label} ha de ser ASCII kebab-case.`);
  return normalized;
}

function taskId(value) {
  const normalized = value.toUpperCase();
  if (!/^[A-Z][A-Z0-9]+-[0-9]+$/.test(normalized)) fail("La tasca ha de tenir format CH-123.");
  return normalized;
}

function validateTaskManifest(task, source) {
  const errors = [];
  if (task.schemaVersion !== 1) errors.push("schemaVersion");
  if (!/^[A-Z][A-Z0-9]+-[0-9]+$/.test(task.taskId ?? "")) errors.push("taskId");
  if (!/^[a-z][a-z0-9-]*$/.test(task.agent ?? "")) errors.push("agent");
  if (!/^agent\/[a-z][a-z0-9-]*\/[a-z0-9-]+$/.test(task.branch ?? "")) errors.push("branch");
  if (typeof task.baseRef !== "string" || task.baseRef.length === 0) errors.push("baseRef");
  for (const field of ["scope", "protectedResources"]) {
    if (!Array.isArray(task[field]) || task[field].some((value) => typeof value !== "string" || value.length === 0)) {
      errors.push(field);
    }
  }
  if (errors.length > 0) fail(`Manifest de tasca invalid (${source}): ${errors.join(", ")}`);
  return task;
}

function portSlot(task) {
  const digest = createHash("sha256").update(task).digest();
  return 10 + (digest.readUInt16BE(0) % 80);
}

function worktreePaths(root = repositoryRoot()) {
  const output = git(["worktree", "list", "--porcelain"], { cwd: root });
  return output
    .split(/\r?\n/)
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length));
}

function activeWorkspaceMetadata(root = repositoryRoot()) {
  return worktreePaths(root).flatMap((path) => {
    const manifest = join(path, ".agent", "workspace.json");
    const taskManifest = join(path, ".agent", "task.json");
    if (!existsSync(manifest)) return [];
    try {
      const workspace = JSON.parse(readFileSync(manifest, "utf8"));
      const task = existsSync(taskManifest)
        ? validateTaskManifest(JSON.parse(readFileSync(taskManifest, "utf8")), taskManifest)
        : {};
      return [{ ...workspace, ...task, path: workspace.path, ports: workspace.ports }];
    } catch {
      fail(`Manifest de workspace invalid: ${manifest}`);
    }
  });
}

function availablePortSlot(task, root) {
  const used = new Set(activeWorkspaceMetadata(root).map((item) => item.ports.slot));
  const preferred = portSlot(task);
  for (let offset = 0; offset < 80; offset += 1) {
    const candidate = 10 + ((preferred - 10 + offset) % 80);
    if (!used.has(candidate)) return candidate;
  }
  fail("No queda cap bloc de ports disponible per a un workspace nou.");
}

function workspaceConfiguration(task, agentName, taskSlug, slot) {
  const webPort = 3100 + slot;
  const apiPort = 4100 + slot;
  const postgresPort = 5500 + slot;
  const redisPort = 6500 + slot;
  const smtpPort = 1100 + slot;
  const mailpitPort = 8100 + slot;
  const composeProject = `control-hub-${task.toLowerCase()}-${agentName}`.slice(0, 63);
  return { slot, webPort, apiPort, postgresPort, redisPort, smtpPort, mailpitPort, composeProject, taskSlug };
}

function metadata(root) {
  const path = join(root, ".agent", "workspace.json");
  if (!existsSync(path)) fail("Aquest directori no es un workspace d'agent provisionat.");
  const workspace = JSON.parse(readFileSync(path, "utf8"));
  const taskPath = join(root, ".agent", "task.json");
  const task = existsSync(taskPath) ? validateTaskManifest(JSON.parse(readFileSync(taskPath, "utf8")), taskPath) : {};
  return { ...workspace, ...task, path: workspace.path, ports: workspace.ports };
}

function createWorkspace(args) {
  if (args.length < 3 || args.length > 4) {
    fail("Us: pnpm agent:workspace create CH-123 codex slug [base-ref]");
  }
  const [rawTask, rawAgent, rawSlug, baseRef = "develop"] = args;
  const task = taskId(rawTask);
  const agent = slug(rawAgent, "L'agent");
  const taskSlug = slug(rawSlug, "L'slug");
  const sourceRoot = repositoryRoot();
  const parent = dirname(sourceRoot);
  const target = join(parent, `Control-Hub-${task.toLowerCase()}-${taskSlug}`);
  const branch = `agent/${agent}/${task.toLowerCase()}-${taskSlug}`;

  if (activeWorkspaceMetadata(sourceRoot).some((item) => item.taskId === task)) {
    fail(`Ja existeix un workspace actiu per a ${task}.`);
  }
  if (existsSync(target)) fail(`El workspace ja existeix: ${target}`);
  try {
    git(["show-ref", "--verify", "--quiet", `refs/heads/${branch}`]);
    fail(`La branca ja existeix: ${branch}`);
  } catch (error) {
    if (error?.status === 1) {
      // Expected: the branch does not exist.
    } else if (error?.message === undefined) {
      throw error;
    }
  }

  git(["rev-parse", "--verify", `${baseRef}^{commit}`]);
  execFileSync("git", ["worktree", "add", "-b", branch, target, baseRef], { cwd: sourceRoot, stdio: "inherit" });

  const config = workspaceConfiguration(task, agent, taskSlug, availablePortSlot(task, sourceRoot));
  const envTemplate = readFileSync(join(target, ".env.example"), "utf8");
  const env = parseEnv(envTemplate);
  const adminPassword = randomBytes(24).toString("base64url");
  const appPassword = randomBytes(24).toString("base64url");
  const authSecret = randomBytes(32).toString("base64url");
  const connectorKey = randomBytes(32).toString("base64");
  const origin = `http://127.0.0.1:${config.webPort}`;
  const apiOrigin = `http://127.0.0.1:${config.apiPort}`;
  const overrides = new Map(env);
  for (const [key, value] of Object.entries({
    COMPOSE_PROJECT_NAME: config.composeProject,
    WEB_PORT: String(config.webPort),
    API_PORT: String(config.apiPort),
    POSTGRES_PORT: String(config.postgresPort),
    REDIS_PORT: String(config.redisPort),
    MAILPIT_SMTP_PORT: String(config.smtpPort),
    MAILPIT_UI_PORT: String(config.mailpitPort),
    API_INTERNAL_URL: apiOrigin,
    MCP_ISSUER: apiOrigin,
    DATABASE_URL: `postgres://control_hub_app:${appPassword}@127.0.0.1:${config.postgresPort}/control_hub`,
    MIGRATION_DATABASE_URL: `postgres://control_hub_admin:${adminPassword}@127.0.0.1:${config.postgresPort}/control_hub`,
    POSTGRES_ADMIN_PASSWORD: adminPassword,
    POSTGRES_APP_PASSWORD: appPassword,
    REDIS_URL: `redis://127.0.0.1:${config.redisPort}`,
    APP_ORIGIN: origin,
    BETTER_AUTH_SECRET: authSecret,
    SMTP_HOST: "127.0.0.1",
    SMTP_PORT: String(config.smtpPort),
    WEBAUTHN_RP_ID: "127.0.0.1",
    WEBAUTHN_ORIGIN: origin,
    CONNECTOR_KEY_RING: JSON.stringify({ activeKeyId: "workspace", keys: { workspace: connectorKey } }),
    BOOTSTRAP_OWNER_EMAIL: `${task.toLowerCase()}@controlhub.test`,
    BOOTSTRAP_OWNER_PASSWORD: randomBytes(18).toString("base64url"),
    BOOTSTRAP_OWNER_NAME: `${agent} ${task}`,
    BOOTSTRAP_TENANT_NAME: `Workspace ${task}`,
    BOOTSTRAP_TENANT_SLUG: `workspace-${task.toLowerCase()}`,
    NEXT_DIST_DIR: ".next-agent"
  })) {
    overrides.set(key, value);
  }
  for (const key of [
    "GOOGLE_OAUTH_CLIENT_ID",
    "GOOGLE_OAUTH_CLIENT_SECRET",
    "MICROSOFT_OAUTH_CLIENT_ID",
    "MICROSOFT_OAUTH_CLIENT_SECRET",
    "NEXT_PUBLIC_SENTRY_DSN",
    "SENTRY_AUTH_TOKEN"
  ]) {
    overrides.set(key, null);
  }
  writeFileSync(join(target, ".env"), serializeEnv(envTemplate, overrides), { mode: 0o600 });

  const localDir = join(target, ".agent");
  mkdirSync(localDir, { recursive: true });
  const taskManifest = {
    schemaVersion: 1,
    taskId: task,
    agent,
    branch,
    baseRef,
    scope: [],
    protectedResources
  };
  writeFileSync(join(localDir, "task.json"), `${JSON.stringify(taskManifest, null, 2)}\n`);
  writeFileSync(
    join(localDir, "workspace.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        ...taskManifest,
        path: target,
        composeProject: config.composeProject,
        ports: config,
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
      },
      null,
      2
    )}\n`
  );

  console.log(`\nWorkspace creat: ${target}`);
  console.log(`Branca: ${branch}`);
  console.log(`Web: ${origin}`);
  console.log(`Mailpit: http://127.0.0.1:${config.mailpitPort}`);
  console.log("\nSeguent pas:");
  console.log(`  cd "${target}"`);
  console.log("  corepack enable");
  console.log("  pnpm agent:provision");
  console.log("  pnpm dev");
}

function run(command, args, cwd, env) {
  const result = spawnSync(command, args, { cwd, env, stdio: "inherit", shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const generatedDirectoryNames = new Set([
  "node_modules",
  ".next",
  ".next-agent",
  ".next-verify",
  ".turbo",
  ".turbo-workspace",
  "dist",
  "coverage",
  "playwright-report",
  "test-results",
  ".e2e"
]);

function removeGeneratedTrees(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === ".git") continue;
    const path = join(directory, entry.name);
    if (generatedDirectoryNames.has(entry.name)) {
      rmSync(path, { recursive: true, force: true, maxRetries: 3 });
    } else {
      removeGeneratedTrees(path);
    }
  }
}

function provision() {
  const root = repositoryRoot();
  const data = metadata(root);
  validateWorkspace(root, data);
  const env = { ...process.env, ...Object.fromEntries(parseEnv(readFileSync(join(root, ".env"), "utf8"))) };
  const pnpm = process.env.npm_execpath;
  if (!pnpm) fail("Executa aquesta ordre mitjancant pnpm agent:provision.");
  run(process.execPath, [pnpm, "install", "--frozen-lockfile"], root, env);
  run("docker", ["compose", "--env-file", ".env", "up", "-d", "--wait", "postgres", "valkey", "mailpit"], root, env);
  run(process.execPath, [pnpm, "db:migrate"], root, env);
  console.log(`\nWorkspace preparat. Web: http://127.0.0.1:${data.ports.webPort}`);
}

function validateWorkspace(root = repositoryRoot(), data = metadata(root)) {
  const branch = git(["branch", "--show-current"], { cwd: root });
  const failures = [];
  if (branch !== data.branch) failures.push(`branca actual ${branch}; esperada ${data.branch}`);
  if (["main", "develop"].includes(branch)) failures.push(`la branca protegida ${branch} no es valida per treballar`);
  if (resolve(root) !== resolve(data.path)) failures.push("el manifest pertany a un altre filesystem");
  if (!existsSync(join(root, ".env"))) failures.push("falta .env local");
  const status = git(["status", "--porcelain"], { cwd: root });
  if (
    status
      .split(/\r?\n/)
      .map((line) => line.slice(3).trim())
      .some((path) => /^\.env(?:\..+)?$/.test(path) && path !== ".env.example")
  )
    failures.push("un fitxer .env apareix a git status");
  const currentScope = new Set(data.scope ?? []);
  for (const other of activeWorkspaceMetadata(root)) {
    if (resolve(other.path) === resolve(root)) continue;
    const overlap = (other.scope ?? []).filter((entry) => currentScope.has(entry));
    if (overlap.length > 0) failures.push(`SCOPE_COLLISION amb ${other.taskId}: ${overlap.join(", ")}`);
    if (other.ports?.slot === data.ports?.slot) failures.push(`PORT_COLLISION amb ${other.taskId}`);
  }
  if (failures.length > 0) fail(`Workspace invalid:\n- ${failures.join("\n- ")}`);
  console.log(`Workspace valid: ${data.taskId} · ${data.agent} · ${data.branch}`);
  console.log(`Web http://127.0.0.1:${data.ports.webPort} · API http://127.0.0.1:${data.ports.apiPort}`);
}

function listWorkspaces() {
  const root = repositoryRoot();
  const items = activeWorkspaceMetadata(root);
  if (items.length === 0) {
    console.log("No hi ha workspaces d'agent actius.");
    return;
  }
  for (const item of items) {
    const lifecycle = Date.parse(item.expiresAt) < Date.now() ? "EXPIRED" : "ACTIVE";
    console.log(
      `${lifecycle}\t${item.taskId}\t${item.agent}\t${item.branch}\thttp://127.0.0.1:${item.ports.webPort}\t${item.path}`
    );
  }
}

function destroyWorkspace(args) {
  if (args.length !== 2 || args[1] !== "--confirm") {
    fail('Us: pnpm agent:workspace destroy "<ruta-workspace>" --confirm');
  }
  const sourceRoot = repositoryRoot();
  const target = resolve(args[0]);
  const allowed = worktreePaths(sourceRoot).map((path) => resolve(path));
  if (!allowed.includes(target)) fail("La ruta no es un worktree registrat d'aquest repositori.");
  if (target === resolve(sourceRoot)) fail("No es pot destruir el workspace des de dins seu.");
  const data = metadata(target);
  if (!data.branch.startsWith("agent/")) fail("La branca del workspace no es una branca temporal d'agent.");
  const dirty = git(["status", "--porcelain"], { cwd: target });
  if (dirty) fail("El workspace te canvis sense commit. No s'ha destruit res.");
  const env = { ...process.env, ...Object.fromEntries(parseEnv(readFileSync(join(target, ".env"), "utf8"))) };
  run("docker", ["compose", "--env-file", ".env", "down", "--volumes", "--remove-orphans"], target, env);
  // Git for Windows can unregister a worktree but fail to delete it once pnpm has created paths
  // beyond MAX_PATH. Remove only allowlisted dependency/build trees first; source remains under
  // Git's control and `git worktree remove` performs the final deletion.
  removeGeneratedTrees(target);
  rmSync(join(target, ".env"), { force: true });
  rmSync(join(target, ".agent"), { recursive: true, force: true });
  execFileSync("git", ["worktree", "remove", target], { cwd: sourceRoot, stdio: "inherit" });
  console.log(`Workspace eliminat. La branca ${data.branch} es conserva fins que confirmis el merge.`);
}

function showStatus() {
  const root = repositoryRoot();
  const data = metadata(root);
  validateWorkspace(root, data);
  console.log(git(["status", "--short"], { cwd: root }) || "Worktree net.");
}

const [command = "help", ...args] = process.argv.slice(2);
switch (command) {
  case "create":
    createWorkspace(args);
    break;
  case "provision":
    provision();
    break;
  case "validate":
    validateWorkspace();
    break;
  case "status":
    showStatus();
    break;
  case "list":
    listWorkspaces();
    break;
  case "destroy":
    destroyWorkspace(args);
    break;
  default:
    console.log("Us:");
    console.log("  pnpm agent:workspace create CH-123 codex slug [base-ref]");
    console.log("  pnpm agent:provision");
    console.log("  pnpm agent:validate");
    console.log("  pnpm agent:workspace status");
    console.log("  pnpm agent:workspace list");
    console.log('  pnpm agent:workspace destroy "<ruta>" --confirm');
}

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

const sourceScript = new URL("./agent-workspace.mjs", import.meta.url);

function command(program, args, cwd) {
  return execFileSync(program, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

test("create provisions an isolated branch, environment and workspace manifest", () => {
  const sandbox = mkdtempSync(join(tmpdir(), "control-hub-agent-workspace-"));
  const repository = join(sandbox, "source");
  mkdirSync(join(repository, "scripts"), { recursive: true });
  cpSync(sourceScript, join(repository, "scripts", "agent-workspace.mjs"));
  writeFileSync(
    join(repository, ".env.example"),
    [
      "WEB_PORT=3001",
      "API_PORT=4000",
      "POSTGRES_PORT=5432",
      "REDIS_PORT=6379",
      "MAILPIT_SMTP_PORT=1025",
      "MAILPIT_UI_PORT=8025",
      "DATABASE_URL=postgres://control_hub_app:local@127.0.0.1:5432/control_hub",
      "MIGRATION_DATABASE_URL=postgres://control_hub_admin:admin@127.0.0.1:5432/control_hub",
      "BETTER_AUTH_SECRET=replace-me",
      "GOOGLE_OAUTH_CLIENT_SECRET=",
      ""
    ].join("\n")
  );
  writeFileSync(join(repository, ".gitignore"), ".env\n.agent/\n");
  writeFileSync(join(repository, "README.md"), "fixture\n");
  command("git", ["init", "-b", "develop"], repository);
  command("git", ["config", "user.email", "test@controlhub.test"], repository);
  command("git", ["config", "user.name", "Control Hub Test"], repository);
  command("git", ["add", "."], repository);
  command("git", ["commit", "-m", "test: fixture"], repository);

  try {
    const output = command(
      process.execPath,
      ["scripts/agent-workspace.mjs", "create", "CH-123", "codex", "mailbox"],
      repository
    );
    const workspace = join(dirname(repository), "Control-Hub-ch-123-mailbox");
    const task = JSON.parse(readFileSync(join(workspace, ".agent", "task.json"), "utf8"));
    const metadata = JSON.parse(readFileSync(join(workspace, ".agent", "workspace.json"), "utf8"));
    const env = readFileSync(join(workspace, ".env"), "utf8");

    assert.match(output, /Workspace creat/);
    assert.equal(task.branch, "agent/codex/ch-123-mailbox");
    assert.equal(metadata.taskId, "CH-123");
    assert.notEqual(metadata.ports.webPort, 3001);
    assert.match(env, new RegExp(`WEB_PORT=${metadata.ports.webPort}`));
    assert.match(env, /COMPOSE_PROJECT_NAME=control-hub-ch-123-codex/);
    assert.doesNotMatch(env, /GOOGLE_OAUTH_CLIENT_SECRET=/);
    assert.doesNotMatch(command("git", ["status", "--short"], workspace), /\.env|\.agent/);
    assert.match(command(process.execPath, ["scripts/agent-workspace.mjs", "validate"], workspace), /Workspace valid/);

    command(process.execPath, ["scripts/agent-workspace.mjs", "create", "CH-124", "claude", "tickets"], repository);
    const secondWorkspace = join(dirname(repository), "Control-Hub-ch-124-tickets");
    const secondMetadata = JSON.parse(readFileSync(join(secondWorkspace, ".agent", "workspace.json"), "utf8"));
    assert.notEqual(metadata.ports.slot, secondMetadata.ports.slot);
    for (const path of [workspace, secondWorkspace]) {
      const taskPath = join(path, ".agent", "task.json");
      const manifest = JSON.parse(readFileSync(taskPath, "utf8"));
      manifest.scope = ["packages/i18n/src/index.ts"];
      writeFileSync(taskPath, `${JSON.stringify(manifest, null, 2)}\n`);
    }
    assert.throws(
      () => command(process.execPath, ["scripts/agent-workspace.mjs", "validate"], workspace),
      /SCOPE_COLLISION/
    );

    command("git", ["worktree", "remove", "--force", secondWorkspace], repository);
    command("git", ["branch", "-D", "agent/claude/ch-124-tickets"], repository);
    command("git", ["worktree", "remove", "--force", workspace], repository);
    command("git", ["branch", "-D", task.branch], repository);
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

test("create rejects identifiers that cannot produce a safe branch", () => {
  const sandbox = mkdtempSync(join(tmpdir(), "control-hub-agent-invalid-"));
  const repository = join(sandbox, "source");
  mkdirSync(join(repository, "scripts"), { recursive: true });
  cpSync(sourceScript, join(repository, "scripts", "agent-workspace.mjs"));
  writeFileSync(join(repository, ".env.example"), "WEB_PORT=3001\n");
  writeFileSync(join(repository, "README.md"), "fixture\n");
  command("git", ["init", "-b", "develop"], repository);
  command("git", ["config", "user.email", "test@controlhub.test"], repository);
  command("git", ["config", "user.name", "Control Hub Test"], repository);
  command("git", ["add", "."], repository);
  command("git", ["commit", "-m", "test: fixture"], repository);

  try {
    assert.throws(
      () =>
        command(process.execPath, ["scripts/agent-workspace.mjs", "create", "../bad", "codex", "mailbox"], repository),
      /Command failed/
    );
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

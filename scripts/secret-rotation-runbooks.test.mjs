import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const platform = readFileSync(new URL("docs/runbooks/platform-secret-rotation.md", root), "utf8");
const connector = readFileSync(new URL("docs/runbooks/connector-key-rotation.md", root), "utf8");

test("S5 covers every current platform rotation class", () => {
  for (const heading of [
    "`BETTER_AUTH_SECRET`",
    "`CONNECTOR_KEY_RING`",
    "Client secrets OAuth de Google i Microsoft",
    "PostgreSQL",
    "SMTP autenticat",
    "Token de machine account de Bitwarden"
  ]) {
    assert.match(platform, new RegExp(`^## ${heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m"));
  }
});

test("the platform procedure retains validation, rollback, recovery and audit evidence", () => {
  for (const control of ["Precondicions", "Validacio", "Rollback", "Recuperacio", "evidencia d'auditoria"])
    assert.match(platform.toLocaleLowerCase("ca"), new RegExp(control.toLocaleLowerCase("ca")));

  assert.match(platform, /Better Auth rep una sola clau/);
  assert.match(platform, /no hi ha cap secret SMTP que S5 pugui rotar/);
  assert.match(platform, /no desplegar/);
  assert.doesNotMatch(platform, /BWS_ACCESS_TOKEN\s*=/);
});

test("connector key rotation stays additive and distinguishes compromise recovery", () => {
  assert.match(connector, /una rotacio no reescriu cap fila/);
  assert.match(connector, /Si la clau s'ha filtrat/);
  assert.match(platform, /La rotacio preventiva es additiva[\s\S]+no es re-xifra cap fila/);
});

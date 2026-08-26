import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const production = readFileSync(new URL("../compose.production.yaml", import.meta.url), "utf8");
const connectors = readFileSync(new URL("../compose.production.connectors.yaml", import.meta.url), "utf8");
const google = readFileSync(new URL("../compose.production.google.yaml", import.meta.url), "utf8");
const microsoft = readFileSync(new URL("../compose.production.microsoft.yaml", import.meta.url), "utf8");
const compose = readFileSync(new URL("../compose.yaml", import.meta.url), "utf8");
const dockerfile = readFileSync(new URL("../deploy/Dockerfile", import.meta.url), "utf8");
const migrationEntrypoint = readFileSync(new URL("../deploy/load-secret-and-exec.sh", import.meta.url), "utf8");

function serviceBlock(source, service, nextService) {
  const end = nextService ? `(?=^  ${nextService}:)` : "(?=^secrets:)";
  const match = source.match(new RegExp(`^  ${service}:[\\s\\S]*?${end}`, "m"));
  assert.ok(match, `missing ${service} service block`);
  return match[0];
}

test("production grants each runtime only the secret files it consumes", () => {
  const web = serviceBlock(production, "web", "api");
  const api = serviceBlock(production, "api", "worker");
  const worker = serviceBlock(production, "worker", "migrate");
  const migrate = serviceBlock(production, "migrate", "postgres");

  assert.match(web, /secrets: \[\]/);
  assert.doesNotMatch(web, /_FILE|key_ring|oauth|database_url|better_auth/i);
  assert.match(api, /DATABASE_URL_FILE: \/run\/secrets\/database_url/);
  assert.match(api, /BETTER_AUTH_SECRET_FILE: \/run\/secrets\/better_auth_secret/);
  assert.doesNotMatch(api, /migration_database_url|postgres_admin_password/);
  assert.match(worker, /DATABASE_URL_FILE: \/run\/secrets\/database_url/);
  assert.doesNotMatch(worker, /better_auth_secret|migration_database_url|postgres_admin_password/);
  assert.match(migrate, /MIGRATION_DATABASE_URL_FILE: \/run\/secrets\/migration_database_url/);
  assert.doesNotMatch(migrate, /^\s+DATABASE_URL_FILE:|better_auth_secret|connector_key_ring/m);
  for (const variable of ["DATABASE_URL", "BETTER_AUTH_SECRET", "POSTGRES_PASSWORD", "POSTGRES_APP_PASSWORD"]) {
    assert.match(production, new RegExp(`${variable}: !reset null`));
  }
});

test("connector and provider overlays grant only the selected integration", () => {
  const api = serviceBlock(connectors, "api", "worker");
  const worker = serviceBlock(connectors, "worker");

  assert.doesNotMatch(connectors, /^ {2}web:/m);
  assert.match(api, /CONNECTOR_KEY_RING_FILE: \/run\/secrets\/connector_key_ring/);
  assert.doesNotMatch(api, /OAUTH_CLIENT_SECRET_FILE/);
  assert.doesNotMatch(worker, /OAUTH_CLIENT_SECRET_FILE/);
  assert.match(connectors, /CONNECTOR_KEY_RING: !reset null/);

  assert.match(google, /GOOGLE_OAUTH_CLIENT_SECRET_FILE: \/run\/secrets\/google_oauth_client_secret/);
  assert.match(google, /GOOGLE_OAUTH_CLIENT_SECRET: !reset null/);
  assert.doesNotMatch(google, /MICROSOFT/);
  assert.match(microsoft, /MICROSOFT_OAUTH_CLIENT_SECRET_FILE: \/run\/secrets\/microsoft_oauth_client_secret/);
  assert.match(microsoft, /MICROSOFT_OAUTH_CLIENT_SECRET: !reset null/);
  assert.doesNotMatch(microsoft, /GOOGLE/);
});

test("images receive no secret through build arguments or copied environment files", () => {
  assert.doesNotMatch(dockerfile, /\bARG\s+\w*(?:SECRET|PASSWORD|TOKEN|KEY)/i);
  assert.doesNotMatch(dockerfile, /COPY\s+.*\.env/i);
  assert.match(dockerfile, /COPY --chmod=0555 .*load-secret-and-exec\.sh/);
  assert.match(migrationEntrypoint, /exec "\$@"/);
  assert.doesNotMatch(migrationEntrypoint, /echo.*secret_value/);
});

test("base services retain container hardening", () => {
  for (const service of ["web", "api", "worker", "migrate"]) {
    const next = { web: "api", api: "worker", worker: "migrate", migrate: "postgres" }[service];
    const block = serviceBlock(compose, service, next);
    assert.match(block, /read_only: true/);
    assert.match(block, /no-new-privileges:true/);
    assert.match(block, /cap_drop: \[ALL\]/);
  }
  assert.match(dockerfile, /^USER node$/m);
});

import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { featureFlags } from "./flags.js";
import { runtimeSecretVariables, secretFileVariable } from "./secret-file.js";
import {
  apiEnvironmentSchema,
  connectorKeyRingWarning,
  mcpIssuerWarning,
  parseApiEnvironment,
  parseWorkerEnvironment,
  workerEnvironmentSchema
} from "./index.js";

const base = {
  DATABASE_URL: "postgres://localhost/db",
  REDIS_URL: "redis://localhost:6379",
  BETTER_AUTH_SECRET: "development-only-secret-with-32-chars"
};

const oneKey = JSON.stringify({
  activeKeyId: "2026-08",
  keys: { "2026-08": Buffer.alloc(32, 1).toString("base64") }
});

describe("the connector key ring at boot", () => {
  it("is absent when nothing supplied one, and connectors are off", () => {
    const environment = parseApiEnvironment(base);
    expect(environment.connectorKeyRing).toBeNull();
    expect(connectorKeyRingWarning(environment)).toBeNull();
  });

  it("is read when supplied, whether or not the flag is on", () => {
    const environment = parseApiEnvironment({ ...base, CONNECTOR_KEY_RING: oneKey });
    expect(environment.connectorKeyRing?.activeKeyId).toBe("2026-08");
    expect(connectorKeyRingWarning(environment)).toBeNull();
  });

  it("refuses a malformed ring on the day it is deployed, flag or no flag", () => {
    expect(() => parseApiEnvironment({ ...base, CONNECTOR_KEY_RING: "{ nope" })).toThrow("KEY_RING_NOT_JSON");
    expect(() =>
      parseApiEnvironment({ ...base, CONNECTOR_KEY_RING: oneKey, CONTROL_HUB_FLAGS: "connectors" })
    ).not.toThrow();
  });

  it("still starts with connectors on and no ring, and says why", () => {
    const environment = parseApiEnvironment({ ...base, CONTROL_HUB_FLAGS: "connectors" });
    expect(environment.connectorKeyRing).toBeNull();
    expect(connectorKeyRingWarning(environment)).toContain("CONNECTOR_KEY_RING");
  });

  it("treats a ring of only whitespace as no ring rather than as a broken one", () => {
    expect(parseApiEnvironment({ ...base, CONNECTOR_KEY_RING: "   " }).connectorKeyRing).toBeNull();
  });

  it("never lets the environment print the key material it holds", () => {
    const environment = parseApiEnvironment({ ...base, CONNECTOR_KEY_RING: oneKey });
    expect(JSON.stringify(environment)).not.toContain(Buffer.alloc(32, 1).toString("base64"));
  });
});

describe("parseApiEnvironment", () => {
  it("parses a valid local environment", () => {
    expect(
      parseApiEnvironment({
        DATABASE_URL: "postgres://localhost/db",
        REDIS_URL: "redis://localhost:6379",
        BETTER_AUTH_SECRET: "development-only-secret-with-32-chars"
      }).API_PORT
    ).toBe(4000);
  });

  it("exposes provider identifiers to the API but never provider secrets", () => {
    const secret = "provider-secret-value";
    const environment = parseApiEnvironment({
      ...base,
      GOOGLE_OAUTH_CLIENT_ID: "google-client",
      GOOGLE_OAUTH_CLIENT_SECRET: secret
    });
    expect(environment.oauthClientIds.google).toBe("google-client");
    expect(JSON.stringify(environment)).not.toContain(secret);
  });

  it("loads a secret file without retaining its path or serializing sensitive configuration", async () => {
    const directory = join(tmpdir(), `control-hub-config-${randomUUID()}`);
    await mkdir(directory, { mode: 0o700 });
    const databaseFile = join(directory, "database");
    await writeFile(databaseFile, "postgres://user:file-password@localhost/db\n", { mode: 0o600 });
    await chmod(databaseFile, 0o600);

    const environment = parseApiEnvironment({
      DATABASE_URL_FILE: databaseFile,
      REDIS_URL: base.REDIS_URL,
      BETTER_AUTH_SECRET: base.BETTER_AUTH_SECRET
    });
    expect(environment.DATABASE_URL).toContain("file-password");
    expect(JSON.stringify(environment)).not.toContain("file-password");
    expect(JSON.stringify(environment)).not.toContain(databaseFile);
  });

  it("takes the relay password from a file and keeps it out of anything serialized", async () => {
    const directory = join(tmpdir(), `control-hub-config-${randomUUID()}`);
    await mkdir(directory, { mode: 0o700 });
    const passwordFile = join(directory, "smtp_password");
    await writeFile(passwordFile, "relay-password\n", { mode: 0o600 });
    await chmod(passwordFile, 0o600);

    const environment = parseApiEnvironment({
      ...base,
      SMTP_USER: "control-hub@example.com",
      SMTP_PASSWORD_FILE: passwordFile
    });
    expect(environment.SMTP_PASSWORD).toBe("relay-password");
    // Every other mounted secret is held to this, and a relay password is a password somebody
    // else chose: it is likelier to be reused elsewhere than any value this installation generates.
    expect(JSON.stringify(environment)).not.toContain("relay-password");
    expect(JSON.stringify(environment)).not.toContain(passwordFile);
  });

  it("refuses half a relay credential, in either direction", () => {
    // Half of it is not a smaller version of it: a user with no password authenticates with an
    // empty one and the relay refuses every message, and a password with no user is a value
    // mounted into the process that nothing will ever read. Both are silent until the first mail
    // matters, and the first mail that matters is the Owner's only way into the installation.
    expect(() => parseApiEnvironment({ ...base, SMTP_USER: "relay-user" })).toThrow(/SMTP_USER/);
    expect(() => parseApiEnvironment({ ...base, SMTP_PASSWORD: "relay-password" })).toThrow(/SMTP_USER/);
  });

  it("authenticates nothing when neither half is configured", () => {
    const environment = parseApiEnvironment(base);
    expect(environment.SMTP_USER).toBeUndefined();
    expect(environment.SMTP_PASSWORD).toBeUndefined();
  });

  it("reads a blank half as no half rather than as a broken one", () => {
    // `SMTP_USER=` in a .env file and an unset variable interpolated by compose both arrive here
    // as an empty string. Refusing to boot over one would be refusing to boot over a commented
    // intention -- and, worse, the pair check above would report it as half a credential.
    const environment = parseApiEnvironment({ ...base, SMTP_USER: "", SMTP_PASSWORD: "  " });
    expect(environment.SMTP_USER).toBeUndefined();
    expect(environment.SMTP_PASSWORD).toBeUndefined();
  });

  it("keeps worker OAuth secrets callable but non-enumerable", () => {
    const secret = "microsoft-secret-value";
    const environment = parseWorkerEnvironment({
      ...base,
      MICROSOFT_OAUTH_CLIENT_ID: "microsoft-client",
      MICROSOFT_OAUTH_CLIENT_SECRET: secret
    });
    expect(environment.oauthClients.microsoft?.clientSecret).toBe(secret);
    expect(JSON.stringify(environment)).not.toContain(secret);
  });

  it("requires complete provider credential pairs in the worker", () => {
    expect(() => parseWorkerEnvironment({ ...base, GOOGLE_OAUTH_CLIENT_ID: "google-client" })).toThrow(
      "GOOGLE_OAUTH_CLIENT_ID"
    );
    expect(
      parseWorkerEnvironment({
        ...base,
        MICROSOFT_OAUTH_CLIENT_ID: "microsoft-client",
        MICROSOFT_OAUTH_CLIENT_SECRET: "microsoft-secret"
      }).oauthClients.microsoft?.clientId
    ).toBe("microsoft-client");
  });

  it("rejects a non-postgres database URL", () => {
    expect(() =>
      parseApiEnvironment({
        DATABASE_URL: "https://example.com",
        REDIS_URL: "redis://localhost:6379",
        BETTER_AUTH_SECRET: "development-only-secret-with-32-chars"
      })
    ).toThrow();
  });
});

/**
 * Every variable this package reads has to survive the task runner.
 *
 * Turbo runs tasks in strict env mode: a variable it was not told about is not passed on, and the
 * process sees it as unset. Nothing fails — the schema simply takes the absent branch — so the
 * symptom is a feature that quietly does not exist in development while the deployment that
 * injects the same variable directly works fine. That is how `CONNECTOR_KEY_RING` went missing
 * long enough for a credential form to be impossible to reach.
 *
 * The schema is read at runtime rather than listed here again, so a variable added tomorrow is
 * covered by this test the moment it is declared.
 */
describe("the variables the task runner has to carry", () => {
  it("declares in turbo.json every variable the environment schemas read", async () => {
    const turbo = JSON.parse(await readFile(new URL("../../../turbo.json", import.meta.url), "utf8")) as {
      globalEnv: string[];
    };
    const declared = new Set(turbo.globalEnv);
    const read = [...Object.keys(apiEnvironmentSchema.shape), ...Object.keys(workerEnvironmentSchema.shape)];
    const secretFiles = runtimeSecretVariables.map(secretFileVariable);

    expect([...read, ...secretFiles].filter((name) => !declared.has(name))).toEqual([]);
  });

  it("lists in the installation runbook every module the installer can be asked for", async () => {
    // `deploy/install.sh` asks which modules to turn on and sends the reader to the runbook for the
    // list, because a shell script cannot hold one without it drifting from this registry. The
    // runbook can drift too -- so it does not get to. A flag added here and not written there is a
    // capability nobody installing can discover exists.
    const runbook = await readFile(new URL("../../../docs/runbooks/installation.md", import.meta.url), "utf8");
    const start = runbook.indexOf("#### Moduls");
    expect(start, "the runbook has no modules section").toBeGreaterThan(-1);
    const section = runbook.slice(start, runbook.indexOf("####", start + 1));
    const listed = new Set([...section.matchAll(/^\| `([a-z_]+)` \|/gm)].flatMap(([, name]) => name ?? []));

    expect([...Object.keys(featureFlags)].filter((flag) => !listed.has(flag))).toEqual([]);
    expect([...listed].filter((name) => !(name in featureFlags))).toEqual([]);
  });
});

describe("the MCP issuer at boot", () => {
  it("is absent when nothing supplied one, and MCP is off", () => {
    const environment = parseApiEnvironment(base);
    expect(environment.MCP_ISSUER).toBeUndefined();
    expect(mcpIssuerWarning(environment)).toBeNull();
  });

  it("says so when the flag is on and nobody said what this server is called", () => {
    // Without it the server cannot mint an audience, and the alternative -- reading the Host
    // header -- is precisely the confused-deputy hole the audience exists to close. Refusing to
    // start would take the whole API down over one optional capability, so it warns and the
    // routes are not declared.
    const environment = parseApiEnvironment({ ...base, CONTROL_HUB_FLAGS: "mcp" });
    expect(mcpIssuerWarning(environment)).toContain("MCP_ISSUER");
  });

  it("refuses an issuer that is not an absolute origin", () => {
    // RFC 8414 section 2: the issuer is what the metadata document is fetched from and what a
    // client compares its token against. A path or a bare host makes both comparisons ambiguous.
    for (const value of ["hub.example.com", "https://hub.example.com/mcp", "not a url"]) {
      expect(() => parseApiEnvironment({ ...base, MCP_ISSUER: value }), value).toThrow();
    }
  });

  it("accepts an origin and keeps no trailing slash, so the audience concatenates cleanly", () => {
    // `https://hub.example.com/` plus `/mcp` is `https://hub.example.com//mcp`, which is a
    // different string from the one in every token, and string equality is the whole check.
    const environment = parseApiEnvironment({ ...base, MCP_ISSUER: "https://hub.example.com/" });
    expect(environment.MCP_ISSUER).toBe("https://hub.example.com");
    expect(mcpIssuerWarning(environment)).toBeNull();
  });
});

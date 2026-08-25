import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The invariants of the MCP OAuth schema, checked against the file rather than against a database.
 *
 * A table that reaches production without `force row level security` is a tenant boundary that
 * exists in the specification and nowhere else, and the integration tests that would catch it need
 * a database this machine cannot always give them. These checks need nothing: they read the SQL and
 * refuse the shapes that have gone wrong before.
 *
 * Specification: `docs/specifications/mcp-and-client-portal.md`.
 */
const source = readFileSync(new URL("../migrations/0049_mcp_oauth.sql", import.meta.url), "utf8");

/** The `create table` body of each table this migration adds, keyed by name. */
const tables = new Map<string, string>();
for (const match of source.matchAll(/create table (mcp_[a-z_]+) \(([\s\S]*?)\n\);/g)) {
  tables.set(match[1]!, match[2]!);
}

describe("the tables the MCP OAuth migration adds", () => {
  it("adds the ones the specification names", () => {
    expect([...tables.keys()].sort()).toEqual([
      "mcp_access_tokens",
      "mcp_authorization_requests",
      "mcp_clients",
      "mcp_grants",
      "mcp_refresh_tokens",
      "mcp_service_accounts"
    ]);
  });

  it("scopes every one of them to a tenant, in the column and in the key", () => {
    for (const [name, body] of tables) {
      expect(body, name).toMatch(/tenant_id uuid not null references tenants\(id\)/);
      expect(body, name).toContain("unique (tenant_id, id)");
    }
  });

  it("isolates every one of them with row level security that even the owner obeys", () => {
    for (const name of tables.keys()) {
      expect(source, name).toContain(`alter table ${name} enable row level security`);
      // `force` is the half that is easy to forget and the half that matters: without it the
      // table's owner reads every tenant's rows, and the owner is who runs the migrations.
      expect(source, name).toContain(`alter table ${name} force row level security`);
      expect(source, name).toContain(`create policy ${name}_isolation on ${name}`);
    }
  });
});

describe("what the schema is allowed to store", () => {
  it("stores no credential in a form anybody could replay", () => {
    // Every secret in this migration is a SHA-256 hash of the value we handed out once. A column
    // holding the value itself would turn a database read into a working token for somebody
    // else's tenant, which is the whole reason the tokens are opaque references.
    for (const [name, body] of tables) {
      for (const line of body.split("\n")) {
        const column = /^\s*([a-z_]+) (text|bytea)\b/.exec(line);
        if (!column) continue;
        const field = column[1]!;
        if (!/(secret|token|code|verifier|challenge)/.test(field)) continue;
        expect(field, `${name}.${field}`).toMatch(/(_hash|_challenge_method|code_challenge)$/);
      }
    }
  });

  it("checks every hash is the hexadecimal of a SHA-256 and nothing else", () => {
    const hashes = [...source.matchAll(/^\s*([a-z_]+_hash) text[^\n]*$/gm)].map((match) => match[0]);
    expect(hashes.length).toBeGreaterThan(0);
    for (const declaration of hashes) {
      expect(declaration).toContain("^[a-f0-9]{64}$");
    }
  });

  it("expires everything that is not the audit trail", () => {
    for (const [name, body] of tables) {
      if (name === "mcp_clients") continue;
      expect(body, name).toContain("expires_at timestamptz");
    }
  });
});

describe("the lookups that run before a tenant is known", () => {
  /**
   * An opaque bearer token arrives with no tenant attached, so the row that says which tenant it
   * belongs to has to be found by a query that is not yet inside one. That is what these functions
   * are for, and it is exactly the shape that leaks everything if it is written carelessly.
   */
  const definers = [...source.matchAll(/create function ([a-z_]+)\(([\s\S]*?)\$\$;/g)].filter((match) =>
    match[2]!.includes("security definer")
  );

  it("pins the search path on every one of them", () => {
    expect(definers.length).toBeGreaterThan(0);
    for (const [body, name] of definers.map((match) => [match[2]!, match[1]!] as const)) {
      expect(body, name).toContain("set search_path = public, pg_temp");
    }
  });

  it("finds a row by its hash and never by anything a caller can guess", () => {
    for (const [body, name] of definers.map((match) => [match[2]!, match[1]!] as const)) {
      expect(body, name).toMatch(/where [a-z.]*(token_hash|code_hash|secret_hash|client_id) =/);
    }
  });

  it("grants them to the application role and the table to nobody more than it needs", () => {
    for (const match of definers) {
      expect(source).toContain(`grant execute on function ${match[1]!}`);
    }
    expect(source).not.toMatch(/grant .* to (postgres|public)\b/);
  });
});

describe("what the migration does to what is already there", () => {
  it("drops nothing", () => {
    expect(source).not.toMatch(/\bdrop (table|column|constraint|index)\b/i);
  });

  it("extends the audit trail additively, so every row already written stays valid", () => {
    const added = [...source.matchAll(/alter table audit_log add column ([a-z_]+) text([^;]*);/g)];
    expect(added.map((match) => match[1]!).sort()).toEqual(["actor_id", "actor_type", "source"]);
    for (const match of added) {
      // A `not null` with no default would fail on the first existing row, and the audit table is
      // append-only: there is no backfill that could rescue it.
      if (match[2]!.includes("not null")) expect(match[0]).toContain("default");
    }
  });
});

describe("the refresh lookup widened by 0051", () => {
  const widened = readFileSync(new URL("../migrations/0051_mcp_refresh_lookup.sql", import.meta.url), "utf8");

  it("keeps the pinned search path that makes a definer function safe to own", () => {
    // A `security definer` function without a fixed `search_path` runs whatever the caller put in
    // front of `public`. Recreating the function is exactly where that guard gets forgotten.
    expect(widened).toContain("security definer set search_path = public, pg_temp");
    expect(widened).toContain("grant execute on function lookup_mcp_refresh_token(text) to control_hub_app");
  });

  it("touches the function and nothing else", () => {
    // The only `drop` allowed here is the function being replaced: its result shape changed, and
    // `create or replace` cannot do that. A dropped table or column would be a different migration.
    expect(widened).not.toMatch(/\bdrop (table|column|constraint|index|policy)\b/i);
    expect(widened).not.toMatch(/\b(alter table|create table|insert into|update|delete from)\b/i);
  });
});

describe("the rotation window opened by 0052", () => {
  const rotation = readFileSync(
    new URL("../migrations/0052_mcp_service_account_rotation.sql", import.meta.url),
    "utf8"
  );

  it("refuses to let either half of the window stand alone", () => {
    // A hash with no expiry is a second permanent key; an expiry with no hash is a window onto
    // nothing. The paired check is what keeps "two keys for a while" from becoming "two keys".
    expect(rotation).toContain("check ((previous_secret_hash is null) = (previous_secret_expires_at is null))");
  });

  it("stops a rotated-away secret from being reusable as somebody else's current one", () => {
    expect(rotation).toMatch(/create unique index mcp_service_accounts_previous_secret_hash_key/);
  });

  it("only honours the old secret while the window is still open", () => {
    // Without the time comparison the previous hash never stops working, which is the whole failure
    // this migration exists to avoid.
    expect(rotation).toContain("previous_secret_hash = p_secret_hash and s.previous_secret_expires_at > now()");
  });

  it("keeps the pinned search path when it recreates the lookup", () => {
    expect(rotation).toContain("security definer set search_path = public, pg_temp");
    expect(rotation).toContain("grant execute on function lookup_mcp_service_account(text) to control_hub_app");
  });

  it("adds its columns nullable, so no account that never rotates is rewritten", () => {
    expect(rotation).not.toMatch(/add column previous_secret_[a-z_]+[^;]*not null/);
    expect(rotation).not.toMatch(/drop (table|column|index|policy)/i);
  });
});

describe("the grant without a client allowed by 0053", () => {
  const grants = readFileSync(new URL("../migrations/0053_mcp_service_account_grants.sql", import.meta.url), "utf8");

  it("ties the client to the actor instead of simply dropping the requirement", () => {
    // Stricter than what it replaces, not looser: before, a service account grant could have
    // carried any client at all, and a user grant can still never be missing one.
    expect(grants).toContain("alter column client_id drop not null");
    expect(grants).toContain("check ((actor_type = 'user') = (client_id is not null))");
  });

  it("leaves every grant already written valid", () => {
    // Every existing row is a user grant with a client, which the new constraint already accepts.
    expect(grants).not.toMatch(/(update|delete from|drop table|drop column)/i);
  });
});

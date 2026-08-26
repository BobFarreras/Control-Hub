import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Two branches numbered a migration `0058` at the same time and nothing noticed.
 *
 * One added `0058_mcp_dynamic_registration.sql`, the other `0058_credential_catalog.sql`, and
 * neither could see the other because each was the only `0058` on its own branch. The merge put
 * them side by side without a conflict -- different filenames -- and the runner would have gone on
 * working: it sorts the whole filename, so `credential` simply lands before `mcp`. That is the
 * part worth stating, because "it still runs" is why this can survive review. What is lost is the
 * total order the numbers exist to record. A database migrated from `develop` applied one of them
 * first; a database migrated from the merge applies the other first, and nothing anywhere says
 * which history a given installation has.
 *
 * A human caught it. This is so the next one does not have to.
 */
const migrationsDirectory = fileURLToPath(new URL("../migrations", import.meta.url));

describe("migration numbering", () => {
  const files = readdirSync(migrationsDirectory)
    .filter((file) => file.endsWith(".sql"))
    .sort();

  it("has migrations to check, so an empty directory cannot pass silently", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("names every migration with a four digit prefix and an underscore", () => {
    expect(files.filter((file) => !/^\d{4}_[a-z0-9_]+\.sql$/.test(file))).toEqual([]);
  });

  it("never gives two migrations the same number", () => {
    const byNumber = new Map<string, string[]>();
    for (const file of files) {
      const number = file.slice(0, 4);
      byNumber.set(number, [...(byNumber.get(number) ?? []), file]);
    }
    // Reported as the whole set rather than the first hit: a merge of two long-lived branches
    // collides on every number they both used, and fixing them one run at a time is the slow way.
    const collisions = [...byNumber.entries()].filter(([, names]) => names.length > 1);
    expect(collisions).toEqual([]);
  });
});

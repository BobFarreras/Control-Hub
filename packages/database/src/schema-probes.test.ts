import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { infrastructureSchemaProbes } from "./schema-probes.js";

/**
 * A probe that has drifted from the migrations is worse than no probe: it reports a migration as
 * missing on a database where everything is applied, and it sends whoever reads it to run a
 * command that changes nothing. The list is small and the files are right here, so the drift is
 * caught at build time rather than by somebody staring at a red checklist.
 */
const migrationsDirectory = dirname(fileURLToPath(new URL("../migrations/.keep", import.meta.url)));
const files = new Set(readdirSync(migrationsDirectory).filter((file) => file.endsWith(".sql")));
const source = (file: string) => readFileSync(join(migrationsDirectory, file), "utf8");

describe("the objects that stand for the module's migrations", () => {
  it("names a migration that exists", () => {
    for (const probe of infrastructureSchemaProbes) expect(files.has(probe.migration), probe.migration).toBe(true);
  });

  it("names an object that migration actually creates", () => {
    for (const probe of infrastructureSchemaProbes) {
      const text = source(probe.migration);
      expect(text, `${probe.relation} in ${probe.migration}`).toContain(probe.relation);
      if (probe.constraintName) {
        expect(text, `${probe.constraintName} in ${probe.migration}`).toContain(probe.constraintName);
      }
    }
  });

  /** Two probes for one file is a checklist that says the same thing twice and means less. */
  it("asks about each migration once", () => {
    const named = infrastructureSchemaProbes.map((probe) => probe.migration);
    expect(new Set(named).size).toBe(named.length);
  });

  /**
   * A migration that adds no relation of its own has to be answered by something else, or it is
   * silently outside the check -- which is how `0039` would have been missed: it only widens a
   * constraint, and nothing about it is a table.
   */
  it("answers a migration that creates no relation with a constraint instead", () => {
    const kinds = infrastructureSchemaProbes.find((probe) => probe.migration === "0039_infrastructure_alert_kinds.sql");
    expect(kinds?.constraintName).toBe("infra_alert_rules_target_kind_check");
  });
});

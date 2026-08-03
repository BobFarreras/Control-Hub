import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { migrationFingerprint } from "./migration-fingerprint.js";

const checksum = (source: string) => createHash("sha256").update(migrationFingerprint(source)).digest("hex");

describe("migration fingerprint", () => {
  it("gives the same checksum whatever the checkout did to the line endings", () => {
    const unix = "create table t (\n  id uuid primary key\n);\n";
    const windows = unix.replace(/\n/g, "\r\n");
    expect(checksum(windows)).toBe(checksum(unix));
  });

  it("still notices a real edit", () => {
    const before = "create table t (\n  id uuid primary key\n);\n";
    const after = "create table t (\n  id text primary key\n);\n";
    expect(checksum(after)).not.toBe(checksum(before));
  });

  it("does not collapse a lone carriage return inside a string literal", () => {
    // \r on its own is not a line ending here, and changing it would change the statement.
    expect(migrationFingerprint("select '\r';")).toBe("select '\r';");
  });
});

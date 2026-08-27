import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveSecretFiles, SecretFileError, secretFileVariable } from "./secret-file.js";

function fixture(content = "from-file\n", mode = 0o600): string {
  const directory = join(tmpdir(), `control-hub-secret-${randomUUID()}`);
  mkdirSync(directory, { mode: 0o700 });
  const file = join(directory, "value");
  writeFileSync(file, content, { encoding: "utf8", mode });
  chmodSync(file, mode);
  return file;
}

function code(action: () => unknown): string | undefined {
  try {
    action();
  } catch (error) {
    if (error instanceof SecretFileError) return error.code;
    throw error;
  }
  return undefined;
}

describe("resolveSecretFiles", () => {
  it("keeps direct development values for backwards compatibility", () => {
    expect(resolveSecretFiles({ DATABASE_URL: "direct" }, ["DATABASE_URL"]).DATABASE_URL).toBe("direct");
  });

  it("reads a file once, removes one editor newline and drops the path", () => {
    const path = fixture("file-value\r\n");
    const resolved = resolveSecretFiles({ DATABASE_URL_FILE: path }, ["DATABASE_URL"]);
    expect(resolved.DATABASE_URL).toBe("file-value");
    expect(resolved.DATABASE_URL_FILE).toBeUndefined();
  });

  it("refuses an ambiguous direct and file source", () => {
    expect(
      code(() => resolveSecretFiles({ DATABASE_URL: "direct", DATABASE_URL_FILE: fixture() }, ["DATABASE_URL"]))
    ).toBe("SECRET_SOURCE_CONFLICT");
  });

  it.each([
    ["relative path", "relative/value", "SECRET_FILE_PATH_INVALID"],
    ["missing file", join(tmpdir(), randomUUID(), "missing"), "SECRET_FILE_NOT_FOUND"],
    ["empty file", fixture(""), "SECRET_FILE_EMPTY"],
    ["NUL content", fixture("before\0after"), "SECRET_FILE_EMPTY"],
    ["oversized file", fixture("x".repeat(65)), "SECRET_FILE_TOO_LARGE"]
  ])("refuses a %s without exposing its value", (_case, path, expected) => {
    const result = code(() => resolveSecretFiles({ API_TOKEN_FILE: path }, ["API_TOKEN"], { maxBytes: 64 }));
    expect(result).toBe(expected);
  });

  it("refuses group-readable production files", () => {
    expect(
      code(() =>
        resolveSecretFiles({ API_TOKEN_FILE: fixture("secret", 0o640) }, ["API_TOKEN"], {
          environment: "production",
          platform: "linux"
        })
      )
    ).toBe("SECRET_FILE_PERMISSIONS");
  });

  it("refuses symlinks instead of following a replaceable path", () => {
    const target = fixture();
    const link = `${target}-link`;
    try {
      symlinkSync(target, link, "file");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EPERM") return;
      throw error;
    }
    expect(code(() => resolveSecretFiles({ API_TOKEN_FILE: link }, ["API_TOKEN"]))).toBe("SECRET_FILE_SYMLINK");
  });

  it("uses stable redacted errors", () => {
    const path = join(tmpdir(), randomUUID(), "sensitive-path");
    try {
      resolveSecretFiles({ API_TOKEN_FILE: path }, ["API_TOKEN"]);
    } catch (error) {
      expect(error).toBeInstanceOf(SecretFileError);
      expect(String(error)).toBe("SecretFileError: API_TOKEN: SECRET_FILE_NOT_FOUND");
      expect(String(error)).not.toContain(path);
    }
  });

  it("derives the companion variable consistently", () => {
    expect(secretFileVariable("BETTER_AUTH_SECRET")).toBe("BETTER_AUTH_SECRET_FILE");
  });
});

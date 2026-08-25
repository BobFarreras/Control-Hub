import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("connector OAuth schema", () => {
  it("does not use a PostgreSQL repetition bound above 255 for redirect paths", async () => {
    const migration = await readFile(
      new URL("../migrations/0055_connector_oauth_redirect_path_constraint.sql", import.meta.url),
      "utf8"
    );
    expect(migration).toContain("char_length(redirect_path) between 1 and 500");
    expect(migration).not.toMatch(/redirect_path[^;]*\{1,500\}/s);
  });
});

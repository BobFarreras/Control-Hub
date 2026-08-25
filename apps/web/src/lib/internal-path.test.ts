import { describe, expect, it } from "vitest";
import { internalPath } from "./internal-path.js";

describe("what a sign-in may send somebody back to", () => {
  it("accepts a path inside the panel, query and all", () => {
    expect(internalPath("/ca/mcp/consent?client_id=abc&state=1")).toBe("/ca/mcp/consent?client_id=abc&state=1");
  });

  it("refuses anywhere that is not this panel", () => {
    // The destination comes from a link somebody else composed. Every one of these is a working
    // open redirect against a check that only looked at the first character.
    for (const value of [
      "https://attacker.test/collect",
      "//attacker.test/collect",
      "/\\attacker.test/collect",
      "\\\\attacker.test",
      "javascript:alert(1)",
      "ca/mcp/consent"
    ]) {
      expect(internalPath(value), value).toBeNull();
    }
  });

  it("refuses a path carrying a control character", () => {
    expect(internalPath("/ca\r\nSet-Cookie: a=b")).toBeNull();
  });

  it("refuses nothing at all rather than inventing a destination", () => {
    for (const value of [null, undefined, ""]) expect(internalPath(value), String(value)).toBeNull();
  });
});

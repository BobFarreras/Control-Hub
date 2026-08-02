import { describe, expect, it } from "vitest";
import { parseCsv, stringifyCsv } from "./index.js";

describe("CSV contract", () => {
  it("round trips quoted commas, quotes and newlines", () => {
    const rows = [["name", "note"], ["Avant, SL", "Line 1\nLine \"2\""]];
    expect(parseCsv(stringifyCsv(rows))).toEqual(rows);
  });
  it("rejects unterminated quoted fields", () => expect(() => parseCsv('name\n"broken')).toThrow("CSV_UNCLOSED_QUOTE"));
  it("neutralizes spreadsheet formulas on export", () => expect(stringifyCsv([["=HYPERLINK(\"https://example.test\")"]])).toBe("\"'=HYPERLINK(\"\"https://example.test\"\")\"\r\n"));
});

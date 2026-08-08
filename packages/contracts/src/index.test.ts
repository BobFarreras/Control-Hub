import { describe, expect, it } from "vitest";
import { parseCsv, sanitizeSpreadsheetText, stringifyCsv } from "./index.js";

describe("CSV contract", () => {
  it("round trips quoted commas, quotes and newlines", () => {
    const rows = [
      ["name", "note"],
      ["Avant, SL", 'Line 1\nLine "2"']
    ];
    expect(parseCsv(stringifyCsv(rows))).toEqual(rows);
  });
  it("rejects unterminated quoted fields", () => expect(() => parseCsv('name\n"broken')).toThrow("CSV_UNCLOSED_QUOTE"));
  it("neutralizes spreadsheet formulas on export", () =>
    expect(stringifyCsv([['=HYPERLINK("https://example.test")']])).toBe(
      '"\'=HYPERLINK(""https://example.test"")"\r\n'
    ));
});

describe("spreadsheet text", () => {
  it("neutralizes formulas without changing ordinary business text", () => {
    expect(sanitizeSpreadsheetText("=1+1")).toBe("'=1+1");
    expect(sanitizeSpreadsheetText("Avant Business")).toBe("Avant Business");
  });
});

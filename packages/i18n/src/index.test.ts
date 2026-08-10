import { describe, expect, it } from "vitest";
import { getAttendanceDictionary, getDictionary, locales } from "./index.js";

describe("dictionaries", () => {
  it("has a title for every locale", () => {
    for (const locale of locales) expect(getDictionary(locale).dashboard.title.length).toBeGreaterThan(0);
  });

  /**
   * A key added to one locale and forgotten in the others renders the key name at somebody, or
   * nothing at all, and only in the language nobody on the team reads back. Comparing the shapes
   * catches it here instead.
   */
  it("gives every locale the same keys, with nothing left empty", () => {
    const [first, ...rest] = locales.map((locale) => getAttendanceDictionary(locale));
    const expected = Object.keys(first!).sort();
    for (const dictionary of rest) expect(Object.keys(dictionary).sort()).toEqual(expected);
    for (const dictionary of [first!, ...rest])
      for (const [key, value] of Object.entries(dictionary)) expect(value.trim(), key).not.toBe("");
  });
});

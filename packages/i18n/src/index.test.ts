import { describe, expect, it } from "vitest";
import { getAttendanceDictionary, getDictionary, getIntegrationsDictionary, locales } from "./index.js";

/**
 * A key added to one locale and forgotten in the others renders the key name at somebody, or
 * nothing at all, and only in the language nobody on the team reads back. Comparing the shapes
 * catches it here instead.
 */
function expectSameShapeInEveryLocale(read: (locale: (typeof locales)[number]) => Record<string, string>) {
  const [first, ...rest] = locales.map(read);
  const expected = Object.keys(first!).sort();
  for (const dictionary of rest) expect(Object.keys(dictionary).sort()).toEqual(expected);
  for (const dictionary of [first!, ...rest])
    for (const [key, value] of Object.entries(dictionary)) expect(value.trim(), key).not.toBe("");
}

describe("dictionaries", () => {
  it("has a title for every locale", () => {
    for (const locale of locales) expect(getDictionary(locale).dashboard.title.length).toBeGreaterThan(0);
  });

  it("gives every locale the same keys, with nothing left empty", () => {
    expectSameShapeInEveryLocale(getAttendanceDictionary);
  });

  it("does the same for the connector platform", () => {
    expectSameShapeInEveryLocale(getIntegrationsDictionary);
  });
});

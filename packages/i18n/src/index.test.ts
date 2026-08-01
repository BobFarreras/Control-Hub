import { describe, expect, it } from "vitest";
import { getDictionary, locales } from "./index.js";

describe("dictionaries", () => {
  it("has a title for every locale", () => {
    for (const locale of locales) expect(getDictionary(locale).dashboard.title.length).toBeGreaterThan(0);
  });
});

import { describe, expect, it } from "vitest";
import { negotiateLocale } from "./negotiate-locale.js";

describe("choosing a language for an address that carries none", () => {
  it("takes the language the browser prefers most", () => {
    expect(negotiateLocale("es-ES,es;q=0.9,en;q=0.8")).toBe("es");
  });

  it("reads the quality values rather than the order they appear in", () => {
    // A browser may list them in any order. Answering in the first one it happens to mention is
    // how somebody who prefers English gets a Catalan screen.
    expect(negotiateLocale("ca;q=0.2,en;q=0.9")).toBe("en");
  });

  it("ignores the region, because the language is what the screen is written in", () => {
    // `es-MX` is Spanish. Matching whole tags would fall through to the default and answer a
    // Spanish speaker in Catalan.
    expect(negotiateLocale("es-MX")).toBe("es");
  });

  it("skips languages this panel does not speak and takes the next one it does", () => {
    expect(negotiateLocale("de-DE,de;q=0.9,en;q=0.4")).toBe("en");
  });

  it("treats q=0 as a refusal and not as a last resort", () => {
    // RFC 9110 section 12.5.4: zero means "not this one".
    expect(negotiateLocale("en;q=0,es;q=0.5")).toBe("es");
  });

  it("falls back to Catalan when the header says nothing usable", () => {
    for (const header of [null, undefined, "", "   ", "de,fr", "*", "not a header;q=nonsense"]) {
      expect(negotiateLocale(header), String(header)).toBe("ca");
    }
  });

  it("renders in the default language rather than failing on a header it cannot parse", () => {
    // The header comes from the client, so it can be anything at all. A screen that throws on it
    // is a screen an agent can stop a person from ever reaching.
    expect(negotiateLocale(";;;;")).toBe("ca");
    expect(negotiateLocale("en;q=;;")).toBe("en");
  });
});

import { describe, expect, it } from "vitest";
import { toServiceCode } from "./slug.js";

describe("toServiceCode", () => {
  it("writes the dashes so nobody has to", () => {
    expect(toServiceCode("Pagina web")).toBe("pagina-web");
    expect(toServiceCode("Software a mida")).toBe("software-a-mida");
  });

  it("strips accents instead of turning them into separators", () => {
    // Without dropping the mark first, `Pàgina` splits into `pa` and `gina`.
    expect(toServiceCode("Pàgina web")).toBe("pagina-web");
    expect(toServiceCode("Automatització")).toBe("automatitzacio");
  });

  it("gives the same code however the name was typed", () => {
    const expected = "agent-ia";
    for (const written of ["Agent IA", "agent ia", "  AGENT   IA  ", "Agent-IA", "Agent, IA"])
      expect(toServiceCode(written)).toBe(expected);
  });

  it("never starts or ends with a dash", () => {
    expect(toServiceCode("  web  ")).toBe("web");
    expect(toServiceCode("!!! web ???")).toBe("web");
    expect(toServiceCode("---")).toBe("");
  });

  it("keeps digits, which are part of real service names", () => {
    expect(toServiceCode("Web 3 amb IA")).toBe("web-3-amb-ia");
  });

  it("cuts long names without leaving a trailing dash", () => {
    // The column accepts 48 characters and the check refuses a trailing dash, so a name that is cut
    // exactly on a separator has to lose it.
    const code = toServiceCode(`${"a".repeat(48)} b`);
    expect(code).toHaveLength(48);
    expect(code.endsWith("-")).toBe(false);
  });

  it("returns nothing when there is nothing to build a code from", () => {
    // The caller treats this as "no code yet" rather than sending an empty one.
    expect(toServiceCode("")).toBe("");
    expect(toServiceCode("///")).toBe("");
  });
});

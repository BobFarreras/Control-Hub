import { describe, expect, it } from "vitest";
import { minorToAmountInput, parseAmountToMinor } from "./money";

const minor = (input: string) => {
  const parsed = parseAmountToMinor(input);
  return "minor" in parsed ? parsed.minor : parsed.error;
};

describe("parseAmountToMinor", () => {
  it("reads whole amounts", () => {
    expect(minor("45")).toBe(4500);
    expect(minor("0")).toBe(0);
  });

  it("reads both separators, because people type both", () => {
    expect(minor("45,50")).toBe(4550);
    expect(minor("45.50")).toBe(4550);
  });

  it("pads a single decimal", () => {
    expect(minor("45,5")).toBe(4550);
  });

  it("survives grouped thousands, pasted or typed", () => {
    // Built from escapes so the test says which space it means.
    expect(minor("1\u00a0234,56")).toBe(123456);
    expect(minor("1\u2009234,56")).toBe(123456);
  });

  it("refuses a third decimal instead of rounding it away", () => {
    // Somebody who typed three digits meant something. Dropping one silently is how a rate ends
    // up wrong with nobody to blame.
    expect(minor("45,505")).toBe("too-precise");
  });

  it("refuses what is not a number", () => {
    expect(minor("quaranta")).toBe("not-a-number");
    expect(minor("45,5,5")).toBe("not-a-number");
    expect(minor("4a5")).toBe("not-a-number");
    expect(minor(",")).toBe("not-a-number");
  });

  it("refuses an empty field and a negative rate", () => {
    expect(minor("")).toBe("empty");
    expect(minor("   ")).toBe("empty");
    expect(minor("-45")).toBe("negative");
  });

  /**
   * The reason this module exists. Through a float, `39.29 * 100` is 3928.9999999999995, so a
   * truncating conversion stores 3928: one cent short on every hour, for as long as nobody checks.
   */
  it("does not lose a cent to binary floating point", () => {
    for (const value of ["39.29", "1.15", "8.11", "0.07", "2.675", "19.99"]) {
      const parsed = parseAmountToMinor(value);
      if (value.split(".")[1]!.length > 2) {
        expect(parsed).toEqual({ error: "too-precise" });
        continue;
      }
      const [whole, fraction = "0"] = value.split(".");
      expect(parsed).toEqual({ minor: Number(whole) * 100 + Number(fraction.padEnd(2, "0")) });
    }
    expect(minor("39.29")).toBe(3929);
    expect(minor("0.07")).toBe(7);
  });
});

describe("minorToAmountInput", () => {
  it("always writes both decimals so the field can be read back", () => {
    expect(minorToAmountInput(4550)).toBe("45.50");
    expect(minorToAmountInput(4500)).toBe("45.00");
    expect(minorToAmountInput(7)).toBe("0.07");
    expect(minorToAmountInput(0)).toBe("0.00");
  });

  it("round trips through the parser", () => {
    for (const value of [0, 7, 100, 4550, 123456, 999999]) {
      expect(parseAmountToMinor(minorToAmountInput(value))).toEqual({ minor: value });
    }
  });
});

import { describe, expect, it } from "vitest";
import { attendanceYear, yearRange } from "./year-range";

describe("attendance year range", () => {
  it("builds the complete natural year", () => {
    expect(yearRange(2027)).toEqual({ from: "2027-01-01", to: "2027-12-31", year: 2027 });
  });

  it("rejects malformed and implausibly distant values", () => {
    const current = new Date().getUTCFullYear();
    expect(attendanceYear("20x7")).toBe(current);
    expect(attendanceYear(String(current + 6))).toBe(current);
  });
});

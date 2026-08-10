import { describe, expect, it } from "vitest";
import { adjustOpportunityProbability, opportunityProbabilityBand } from "./opportunity-probability";

describe("opportunity probability", () => {
  it("moves in ten-point steps and stays inside the accepted range", () => {
    expect(adjustOpportunityProbability(50, 1)).toBe(60);
    expect(adjustOpportunityProbability(0, -1)).toBe(0);
    expect(adjustOpportunityProbability(100, 1)).toBe(100);
  });

  it("classifies values for their semantic progress colour", () => {
    expect(opportunityProbabilityBand(39)).toBe("low");
    expect(opportunityProbabilityBand(40)).toBe("medium");
    expect(opportunityProbabilityBand(69)).toBe("medium");
    expect(opportunityProbabilityBand(70)).toBe("high");
  });
});

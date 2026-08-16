import { describe, expect, it } from "vitest";
import { featureFlags, isFeatureEnabled, parseFeatureFlags, unknownFeatureFlags } from "./flags.js";

describe("feature flags", () => {
  it("is off when nothing is configured", () => {
    expect(parseFeatureFlags(undefined).size).toBe(0);
    expect(parseFeatureFlags("").size).toBe(0);
    expect(isFeatureEnabled(parseFeatureFlags(""), "projects_and_time")).toBe(false);
  });

  it("reads a comma-separated list and tolerates the spaces people type", () => {
    expect(isFeatureEnabled(parseFeatureFlags("projects_and_time"), "projects_and_time")).toBe(true);
    expect(isFeatureEnabled(parseFeatureFlags(" projects_and_time , "), "projects_and_time")).toBe(true);
  });

  it("ignores a name nobody declared rather than refusing to boot", () => {
    const flags = parseFeatureFlags("projects_and_time,invented_flag");
    expect(flags.size).toBe(1);
    expect(isFeatureEnabled(flags, "projects_and_time")).toBe(true);
  });

  it("reports the undeclared names so a typo is not mistaken for a capability being off", () => {
    expect(unknownFeatureFlags("projects_and_time,projcts_and_time")).toEqual(["projcts_and_time"]);
    expect(unknownFeatureFlags("projects_and_time")).toEqual([]);
  });

  it("declares infrastructure, off until somebody asks for it", () => {
    expect(isFeatureEnabled(parseFeatureFlags(""), "infrastructure")).toBe(false);
    expect(isFeatureEnabled(parseFeatureFlags("infrastructure"), "infrastructure")).toBe(true);
    expect(unknownFeatureFlags("infrastructure")).toEqual([]);
  });

  it("gives every declared flag an owner and a date to be gone by", () => {
    for (const [name, flag] of Object.entries(featureFlags)) {
      expect(flag.owner, name).toBeTruthy();
      expect(flag.retireOn, name).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(flag.description, name).toBeTruthy();
    }
  });
});

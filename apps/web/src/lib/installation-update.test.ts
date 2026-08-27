import type { ReleaseSummary } from "@control-hub/contracts/release";
import { describe, expect, it } from "vitest";
import { releaseNotesUrl, updateWorkItems } from "./installation-update";

const summary = (overrides: Partial<ReleaseSummary> = {}): ReleaseSummary => ({
  version: "1.1.0",
  released: "2026-08-27T10:00:00Z",
  migrations: 0,
  configuration: false,
  ...overrides
});

describe("what the update notice says the work is", () => {
  it("names migrations first, because that is what decides when somebody does it", () => {
    expect(updateWorkItems(summary({ migrations: 3, configuration: true }))).toEqual(["migrations", "configuration"]);
  });

  it("leaves out what does not apply", () => {
    expect(updateWorkItems(summary({ migrations: 2 }))).toEqual(["migrations"]);
    expect(updateWorkItems(summary({ configuration: true }))).toEqual(["configuration"]);
  });

  it("says nothing rather than nothing-in-particular when the update is a restart", () => {
    // An empty list is a real answer and a useful one: no migrations and no configuration change
    // is the case where somebody may reasonably do it now rather than on Saturday.
    expect(updateWorkItems(summary())).toEqual([]);
  });
});

describe("where the notice sends somebody to read", () => {
  it("builds the address from the version rather than carrying a link", () => {
    // The manifest deliberately contains no URLs. A predictable address costs nothing and means
    // the file cannot carry a link somebody else chose.
    expect(releaseNotesUrl("1.2.3")).toBe("https://github.com/BobFarreras/Control-Hub/releases/tag/v1.2.3");
  });

  it("refuses to interpolate anything that is not a version", () => {
    // This value ends up in an `href`. Nothing that is not `1.2.3` gets to reach one.
    for (const version of ["", "latest", "1.2", "1.2.3 ", "../../evil", "1.2.3?x=1", "javascript:alert(1)"]) {
      expect(releaseNotesUrl(version), version).toBeNull();
    }
  });
});

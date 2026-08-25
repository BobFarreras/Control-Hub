import { describe, expect, it } from "vitest";
import { agentsSection, redirectUriLines } from "./mcp-agents";

describe("whether the agents section is there at all", () => {
  it("hides itself when the surface is not mounted here", () => {
    // The feature flag is read from the environment, which a client component cannot see. The
    // API's 404 is the only honest source of that fact, and it is read rather than guessed.
    expect(agentsSection(404)).toBe("hidden");
  });

  it("hides itself from a reader who may not administer it", () => {
    // Not an empty panel: "no agents registered" and "you may not see the agents" are different
    // statements, and showing the first for the second is a lie the reader cannot detect.
    expect(agentsSection(403)).toBe("hidden");
  });

  it("stays visible when the section exists and could not be read", () => {
    // The opposite mistake: an outage that hides the section looks exactly like a tenant with no
    // agents, and somebody would go on believing nothing is connected while it still is.
    expect(agentsSection(500)).toBe("failed");
    expect(agentsSection(502)).toBe("failed");
  });

  it("loads on any success", () => {
    expect(agentsSection(200)).toBe("loaded");
  });
});

describe("the return addresses a client will be held to", () => {
  it("takes one per line and trims each", () => {
    expect(redirectUriLines("http://127.0.0.1:51763/callback \n  https://app.test/cb")).toEqual([
      "http://127.0.0.1:51763/callback",
      "https://app.test/cb"
    ]);
  });

  it("drops the blank line a paste leaves behind", () => {
    // Sent as an empty string it is refused, and the refusal takes the good addresses with it --
    // for a newline nobody typed on purpose and nobody can see in the field.
    expect(redirectUriLines("http://127.0.0.1:51763/callback\n\n")).toEqual(["http://127.0.0.1:51763/callback"]);
  });

  it("yields nothing for a field somebody left empty", () => {
    expect(redirectUriLines("   ")).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import { connectionRecipes } from "./mcp-connection";

const resource = "https://hub.example/api/v1/mcp";

describe("the configuration somebody pastes into an assistant", () => {
  it("puts the server's own address in every recipe", () => {
    // The one thing that must be right in all of them. A snippet missing it, or carrying an
    // address composed on the screen, fails as a rejected audience much later and reads like a
    // bug in the server rather than a typo in a config file.
    for (const recipe of connectionRecipes(resource)) {
      expect(recipe.snippet, recipe.key).toContain(resource);
    }
  });

  it("names four assistants, each with a line explaining where the snippet goes", () => {
    const recipes = connectionRecipes(resource);
    expect(recipes.map((recipe) => recipe.key)).toEqual([
      "connectClaudeCode",
      "connectClaudeApp",
      "connectOpenai",
      "connectOpencode"
    ]);
    // A block of JSON with no sentence saying which file it belongs in is a puzzle, not help.
    expect(recipes.every((recipe) => recipe.hint === `${recipe.key}Hint`)).toBe(true);
  });

  it("carries no client identifier, invented or otherwise", () => {
    // These assistants obtain one by registering themselves. A field added so the panel could show
    // something would be pasted, ignored, and then blamed on the address.
    const everything = connectionRecipes(resource)
      .map((recipe) => recipe.snippet)
      .join("\n");
    expect(everything).not.toContain("client_id");
    expect(everything).not.toContain("clientId");
  });

  it("emits JSON that parses, for the two recipes that are JSON", () => {
    const [, , openai, opencode] = connectionRecipes(resource);
    expect(() => {
      JSON.parse(openai!.snippet);
    }).not.toThrow();
    expect(JSON.parse(opencode!.snippet)).toMatchObject({ mcp: { "control-hub": { url: resource } } });
  });
});

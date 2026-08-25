/**
 * The configuration each assistant needs to reach this server, built as data rather than written
 * into the component.
 *
 * Kept here for the same reason the scope vocabularies are kept out of the browser: these are
 * exact strings somebody will paste into a config file, and a snippet that is subtly wrong costs
 * an evening. As data they can be asserted -- above all that the address really appears in every
 * one of them.
 *
 * No snippet carries a client identifier. Every assistant listed here obtains one by registering
 * itself, and a field invented so the panel could show something would be pasted, ignored, and
 * then blamed on the address. The identifier is shown beside these recipes as a fact, for the
 * clients that ask for one.
 */
export type ConnectionRecipe = {
  key: "connectClaudeCode" | "connectClaudeApp" | "connectOpenai" | "connectOpencode";
  hint: "connectClaudeCodeHint" | "connectClaudeAppHint" | "connectOpenaiHint" | "connectOpencodeHint";
  snippet: string;
};

export function connectionRecipes(resource: string): ConnectionRecipe[] {
  return [
    {
      key: "connectClaudeCode",
      hint: "connectClaudeCodeHint",
      snippet: `claude mcp add --transport http control-hub ${resource}`
    },
    {
      key: "connectClaudeApp",
      hint: "connectClaudeAppHint",
      snippet: resource
    },
    {
      key: "connectOpenai",
      hint: "connectOpenaiHint",
      snippet: JSON.stringify(
        { type: "mcp", server_label: "control-hub", server_url: resource, authorization: "<access token>" },
        null,
        2
      )
    },
    {
      key: "connectOpencode",
      hint: "connectOpencodeHint",
      snippet: JSON.stringify({ mcp: { "control-hub": { type: "remote", url: resource, enabled: true } } }, null, 2)
    }
  ];
}

/**
 * Formatting is enforced by a formatter, not by review. The repository previously had no
 * linter or formatter at all, which is how routes grew to several hundred characters on a
 * single line with the permission check buried in the middle.
 *
 * `printWidth` is deliberately generous: the goal is to make a missing authorisation check
 * visible, not to win an argument about eighty columns.
 *
 * `endOfLine` is `auto`, not `lf`, and that is not a surrender. Line endings already have an
 * owner: `.gitattributes` says `text=auto`, so the repository stores LF and Windows checks out
 * CRLF. With `lf` here, a second authority disagreed with the first and `pnpm format:check` was
 * red on every file of a Windows checkout -- which meant nobody could read it, and a real
 * violation hid among three hundred false ones for the whole of phase 6. A gate that is always
 * red is not a gate.
 */

/** @type {import("prettier").Config} */
export default {
  printWidth: 120,
  semi: true,
  singleQuote: false,
  trailingComma: "none",
  arrowParens: "always",
  endOfLine: "auto"
};

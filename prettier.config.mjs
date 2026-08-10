/**
 * Formatting is enforced by a formatter, not by review. The repository previously had no
 * linter or formatter at all, which is how routes grew to several hundred characters on a
 * single line with the permission check buried in the middle.
 *
 * `printWidth` is deliberately generous: the goal is to make a missing authorisation check
 * visible, not to win an argument about eighty columns.
 */

/** @type {import("prettier").Config} */
export default {
  printWidth: 120,
  semi: true,
  singleQuote: false,
  trailingComma: "none",
  arrowParens: "always",
  endOfLine: "lf"
};

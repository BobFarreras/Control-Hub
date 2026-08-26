/**
 * Where a sign-in may send somebody afterwards.
 *
 * The consent screen is reached from a link an agent composed, so somebody who is not signed in
 * lands on the login form and has to come back to a request that would otherwise be lost. Carrying
 * the destination in the address is how that works everywhere -- and it is also how open redirects
 * are built, because the address is then chosen by whoever wrote the link.
 *
 * So a destination is only ever a path inside this panel. Anything that could leave it is refused
 * outright rather than repaired: an authority (`//host`, which a browser reads as protocol-relative)
 * or a backslash, which some browsers normalise into a slash and which is the classic way past a
 * check that only looked at the first character. A scheme cannot survive the leading-slash rule.
 *
 * Returns `null` for anything it will not vouch for, so every caller has to say what it does
 * instead. There is no "clean it up and use it anyway".
 */
export function internalPath(value: string | null | undefined): string | null {
  if (!value || !value.startsWith("/")) return null;
  if (value.startsWith("//") || value.includes("\\")) return null;
  // A control character can end a line in a log or a header on the way somewhere else. Neither
  // belongs in an address this code hands to a router.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(value)) return null;
  return value;
}

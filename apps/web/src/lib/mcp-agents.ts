/**
 * The two decisions the agents section makes before it draws anything, kept out of the component
 * so they can be stated as rules and proved as rules.
 */

/** What the first listing's status means for the section as a whole. */
export type AgentsSectionState = "hidden" | "failed" | "loaded";

/**
 * A 404 and a 403 both mean "this section does not exist for you".
 *
 * The first is the surface not being mounted on this installation, the second is a reader who may
 * not administer it, and neither deserves an empty panel: a section headed "registered agents"
 * with nothing under it says there are none, which is a different and false statement. Any other
 * failure is the opposite case -- the section does exist and could not be read -- and hiding it
 * there would turn an outage into a silent disappearance.
 */
export function agentsSection(status: number): AgentsSectionState {
  if (status === 404 || status === 403) return "hidden";
  return status >= 200 && status < 300 ? "loaded" : "failed";
}

/**
 * The return addresses, one per line.
 *
 * They are compared character by character at `/authorize`, so a trailing space is a client that
 * mysteriously cannot connect. Blank lines are dropped rather than sent as empty strings, which
 * the API would refuse as a whole and take the four good addresses down with the one stray
 * newline at the end of a paste.
 */
export function redirectUriLines(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

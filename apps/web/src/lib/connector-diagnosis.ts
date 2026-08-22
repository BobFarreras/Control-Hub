/**
 * The half of the guided check that is composed on this side of the wire.
 *
 * The diagnosis the API answers carries migration file names and `instance` labels and nothing
 * else -- no base address, no credential, no provider hostname -- because a panel that repeats a
 * stored address is a panel that leaks one to everybody who can open it. So the one sentence that
 * needs an address, the command that opens a tunnel to a Prometheus listening only on its own
 * loopback, is built here out of what the person has just typed into the form.
 *
 * Everything below therefore treats its input as a string somebody typed, not as configuration:
 * it is parsed rather than interpolated, and anything that is not plainly an address comes back
 * as `null` instead of as a command with a hole in it.
 */

/** The furthest a port number goes, and the lowest that is a port at all. */
const lowestPort = 1;
const highestPort = 65535;

/** What the scheme means when nobody wrote a port. */
const impliedPort: Record<string, string> = { "http:": "80", "https:": "443" };

/** The addresses that mean "the machine this is running on", which cannot name the far machine. */
const loopbacks = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

/**
 * A hostname we are willing to put in front of a shell.
 *
 * Letters, digits, dots and hyphens, or an IPv6 literal in its brackets. Anything else -- a
 * space, a quote, a semicolon -- is either a typo or a second command riding along, and the
 * command this module returns is one a screen invites somebody to paste into a terminal.
 */
const safeHost = /^(?:[a-z0-9.-]+|\[[0-9a-f:]+\])$/i;

/**
 * What was typed, reduced to the parts an address is made of, or `null` when it is not one.
 *
 * Everything the two composers below emit is built from this and from nothing else, which is how
 * a password pasted in front of the `@` reaches neither a terminal nor an `.env`: `URL` parses it
 * into `username` and `password`, and no field of theirs is read here.
 */
function typedAddress(baseUrl: string): { origin: string; host: string; port: string } | null {
  const typed = baseUrl.trim();
  if (!typed) return null;

  let address: URL;
  try {
    address = new URL(typed);
  } catch {
    return null;
  }
  if (!(address.protocol in impliedPort)) return null;

  const host = address.hostname;
  if (!host || !safeHost.test(host)) return null;

  const port = address.port || impliedPort[address.protocol]!;
  const numeric = Number(port);
  if (!Number.isInteger(numeric) || numeric < lowestPort || numeric > highestPort) return null;

  // `URL.origin` drops the credentials, the path, the query and the fragment, and keeps the port
  // only when it is not the scheme's own -- which is exactly the shape `parseEgressAllowlist`
  // accepts, and it refuses an entry with a path rather than ignoring it.
  return { origin: address.origin, host, port };
}

/**
 * The line that admits this origin to the deployment's allowlist, or `null` when what was typed
 * is not an address.
 *
 * It is offered to be copied and never written from here: the allowlist belongs to whoever
 * administers the installation, and a tenant able to add an entry could aim a connector at the
 * panel's own database.
 */
export function allowlistLine(baseUrl: string): string | null {
  const address = typedAddress(baseUrl);
  return address && `CONNECTOR_INTERNAL_ALLOWLIST=${address.origin}`;
}

/**
 * The command that forwards the typed port to the same port on the far machine's loopback, or
 * `null` when what was typed is not an address this can speak about.
 *
 * `needsHost` is the honest half: when the address typed is itself a loopback, the far machine is
 * exactly what this module does not know, and inventing a plausible one is the failure mode the
 * whole increment exists to remove. The placeholder stays visible and the screen says to fill it.
 */
export function tunnelCommand(baseUrl: string): { command: string; needsHost: boolean } | null {
  const address = typedAddress(baseUrl);
  if (!address) return null;

  const needsHost = loopbacks.has(address.host.toLowerCase());
  const far = needsHost ? "VPS_ADDRESS" : address.host;

  return { command: `ssh -N -L ${address.port}:127.0.0.1:${address.port} user@${far}`, needsHost };
}

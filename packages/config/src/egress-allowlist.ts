/**
 * Destinations this installation allows a connector to reach besides the public internet.
 *
 * It exists because of one real case: an n8n or a Prometheus on the same VPS, which a connector
 * has to reach and which `isAllowedEgressAddress` refuses by design. The list comes from the
 * environment and never from a tenant's configuration — that asymmetry is the whole control. A
 * tenant that could add an entry could point a connector at the panel's own database.
 *
 * Specification: `docs/specifications/connector-security.md`.
 */

export class EgressAllowlistError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}

export type AllowedDestination = {
  scheme: "http:" | "https:";
  hostname: string;
  port: number;
};

const defaultPorts: Record<string, number> = { "http:": 80, "https:": 443 };

/**
 * Reads a comma-separated list of origins.
 *
 * Origins, not hostnames: a bare host would allow every port on that machine, and on a host that
 * runs our own services that is most of what there is to protect. The port is explicit or it is
 * the scheme's default, and a path is refused rather than ignored, because an entry with a path
 * reads like a restriction that this list cannot enforce.
 */
export function parseEgressAllowlist(raw: string | undefined): readonly AllowedDestination[] {
  const entries = (raw ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  return entries.map((entry) => {
    let url: URL;
    try {
      url = new URL(entry);
    } catch {
      throw new EgressAllowlistError("EGRESS_ENTRY_NOT_AN_ORIGIN");
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new EgressAllowlistError("EGRESS_SCHEME_REFUSED");
    if (url.username || url.password) throw new EgressAllowlistError("EGRESS_ENTRY_HAS_CREDENTIALS");
    if (url.pathname !== "/" || url.search || url.hash) throw new EgressAllowlistError("EGRESS_ENTRY_HAS_PATH");
    if (!url.hostname) throw new EgressAllowlistError("EGRESS_ENTRY_NOT_AN_ORIGIN");

    return {
      scheme: url.protocol,
      hostname: normalizeHostname(url.hostname),
      port: url.port ? Number(url.port) : defaultPorts[url.protocol]!
    };
  });
}

/** `URL` already lowercases and punycodes; the brackets around an IPv6 literal are ours to drop. */
function normalizeHostname(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
}

/**
 * Whether an address was named by the operator, which is the only thing that can override the
 * address rules. Compared on scheme, host and port together: allowing `https://host:8443` must
 * not allow `http://host:80`.
 */
export function isAllowlistedDestination(allowlist: readonly AllowedDestination[], url: URL): boolean {
  const port = url.port ? Number(url.port) : defaultPorts[url.protocol];
  if (port === undefined) return false;
  const hostname = normalizeHostname(url.hostname);
  return allowlist.some((entry) => entry.scheme === url.protocol && entry.hostname === hostname && entry.port === port);
}

/**
 * Which addresses a connector may be pointed at.
 *
 * This is a rule, not plumbing, so it lives here and is decided once: the guard in the worker
 * asks this question of every address it resolves and of every redirect, and a test can ask it
 * of a thousand addresses without a network.
 *
 * The verdict is on the *address*, never on the name. A hostname proves nothing — `evil.test`
 * can resolve to `127.0.0.1` today and to a public address a second later, which is the whole
 * point of DNS rebinding. The caller resolves first, classifies what it got, and then connects
 * to that exact address.
 *
 * Specification: `docs/specifications/connector-security.md`.
 */

export const addressClasses = [
  "public",
  "unspecified",
  "loopback",
  "private",
  "link_local",
  "shared",
  "multicast",
  "documentation",
  "reserved",
  "invalid"
] as const;
export type AddressClass = (typeof addressClasses)[number];

function parseIpv4(value: string): number[] | null {
  const parts = value.split(".");
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const part of parts) {
    // Not `Number(part)`: that accepts "0x7f", " 12" and "1e2", and an address parsed one way
    // here and another way by the operating system is exactly the gap a bypass lives in.
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    octets.push(octet);
  }
  return octets;
}

/** The eight groups of an IPv6 address, with `::` expanded and a trailing IPv4 form accepted. */
function parseIpv6(value: string): number[] | null {
  let text = value;
  if (text.startsWith("[") && text.endsWith("]")) text = text.slice(1, -1);
  // A zone index ("%eth0") names an interface, which is a local concept. Whatever follows it
  // cannot be a public destination, and parsing it away would hide that.
  if (text.includes("%")) return null;

  const halves = text.split("::");
  if (halves.length > 2) return null;

  const expand = (half: string): number[] | null => {
    if (half === "") return [];
    const groups: number[] = [];
    const parts = half.split(":");
    for (const [index, part] of parts.entries()) {
      if (index === parts.length - 1 && part.includes(".")) {
        const octets = parseIpv4(part);
        if (!octets) return null;
        groups.push((octets[0]! << 8) | octets[1]!, (octets[2]! << 8) | octets[3]!);
        continue;
      }
      if (!/^[0-9a-f]{1,4}$/i.test(part)) return null;
      groups.push(Number.parseInt(part, 16));
    }
    return groups;
  };

  const head = expand(halves[0] ?? "");
  const tail = halves.length === 2 ? expand(halves[1] ?? "") : [];
  if (!head || !tail) return null;

  if (halves.length === 1) return head.length === 8 ? head : null;
  const missing = 8 - head.length - tail.length;
  if (missing < 1) return null;
  return [...head, ...Array<number>(missing).fill(0), ...tail];
}

function classifyIpv4(octets: readonly number[]): AddressClass {
  const [a = 0, b = 0, c = 0] = octets;
  if (a === 0) return "unspecified";
  if (a === 127) return "loopback";
  if (a === 10) return "private";
  if (a === 172 && b >= 16 && b <= 31) return "private";
  if (a === 192 && b === 168) return "private";
  // Carrier-grade NAT. Not ours, not the public internet, and reachable from a hosted machine.
  if (a === 100 && b >= 64 && b <= 127) return "shared";
  // 169.254.0.0/16, which is where every cloud keeps its instance metadata service.
  if (a === 169 && b === 254) return "link_local";
  if (a === 192 && b === 0 && c === 0) return "reserved";
  if (a === 192 && b === 0 && c === 2) return "documentation";
  if (a === 198 && b === 51 && c === 100) return "documentation";
  if (a === 203 && b === 0 && c === 113) return "documentation";
  if (a === 198 && (b === 18 || b === 19)) return "reserved";
  if (a >= 224 && a <= 239) return "multicast";
  if (a >= 240) return "reserved";
  return "public";
}

function classifyIpv6(groups: readonly number[]): AddressClass {
  const [g0 = 0, g1 = 0, g2 = 0, g3 = 0, g4 = 0, g5 = 0, g6 = 0, g7 = 0] = groups;
  const embeddedIpv4 = (high: number, low: number) => classifyIpv4([high >> 8, high & 0xff, low >> 8, low & 0xff]);

  if (groups.every((group) => group === 0)) return "unspecified";
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0 && g6 === 0 && g7 === 1) return "loopback";

  // ::ffff:a.b.c.d and 64:ff9b::a.b.c.d carry an IPv4 address inside. The verdict has to be the
  // one that address would get on its own, or the mapping becomes a way around this function.
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0xffff) return embeddedIpv4(g6, g7);
  if (g0 === 0x64 && g1 === 0xff9b) return embeddedIpv4(g6, g7);
  // 6to4: the IPv4 address it tunnels to sits in the next 32 bits.
  if (g0 === 0x2002) return embeddedIpv4(g1, g2);

  if (g0 === 0x100 && g1 === 0 && g2 === 0 && g3 === 0) return "reserved";
  if (g0 === 0x2001 && g1 === 0xdb8) return "documentation";
  if ((g0 & 0xfe00) === 0xfc00) return "private";
  if ((g0 & 0xffc0) === 0xfe80) return "link_local";
  if ((g0 & 0xff00) === 0xff00) return "multicast";
  return "public";
}

export function classifyAddress(address: string): AddressClass {
  const trimmed = address.trim();
  const ipv4 = parseIpv4(trimmed);
  if (ipv4) return classifyIpv4(ipv4);
  const ipv6 = parseIpv6(trimmed);
  if (ipv6) return classifyIpv6(ipv6);
  return "invalid";
}

/**
 * Whether a connector may connect to this address.
 *
 * An allowlist is the only way to reach anything else, and it is administrative: it comes from
 * the installation's environment, never from a tenant's configuration. Without that asymmetry a
 * tenant could point a connector at the machine the panel itself runs on.
 */
export function isAllowedEgressAddress(address: string): boolean {
  return classifyAddress(address) === "public";
}

/**
 * Headers that must not survive a redirect to a different origin.
 *
 * A provider that answers `302` to a host it does not control would otherwise be handed the
 * credential meant for it. Matched case-insensitively because header names are.
 */
const originBoundHeaders = new Set(["authorization", "proxy-authorization", "cookie", "x-api-key"]);

export function isOriginBoundHeader(name: string): boolean {
  return originBoundHeaders.has(name.toLowerCase());
}

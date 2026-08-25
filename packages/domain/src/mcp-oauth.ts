/**
 * The rules of the MCP authorization flow, decided without touching anything.
 *
 * Where `mcp.ts` answers "may this call happen", this file answers the questions asked earlier: how
 * long a credential lives, where a client may be sent back to, what a consent may grant, and what to
 * do when a refresh token comes back. All four are pure decisions over data, which is why they live
 * here and not in a route: a redirect rule that can only be tested by driving a browser is a
 * redirect rule nobody tests.
 *
 * There is no hashing in this file on purpose. Comparing a PKCE verifier means computing a SHA-256,
 * and the domain owns no platform: the caller recomputes the challenge and the comparison happens
 * where the crypto already lives.
 *
 * Specification: `docs/specifications/mcp-and-client-portal.md`, decisions D4, D5 and D7.
 */

import { grantableMcpScopes, mcpScopes, type McpGrantStatus, type McpScope } from "./mcp.js";
import type { Permission } from "./index.js";

export const mcpOauthDenialCodes = [
  "MCP_CLIENT_UNKNOWN",
  "MCP_CLIENT_SUSPENDED",
  "MCP_REDIRECT_URI_MISMATCH",
  "MCP_SCOPE_UNAVAILABLE",
  "MCP_CODE_INVALID",
  "MCP_PKCE_INVALID",
  "MCP_CLIENT_AUTH_FAILED",
  "MCP_REQUEST_INVALID",
  "MCP_REFRESH_INVALID",
  "MCP_REFRESH_REUSED",
  "MCP_GRANT_REVOKED"
] as const;
export type McpOauthDenialCode = (typeof mcpOauthDenialCodes)[number];

/**
 * How long each credential lives, in seconds. Decision D5 set the access token at thirty minutes.
 *
 * The code is the shortest by an order of magnitude because it is the only one that travels through
 * a browser redirect, where it can end up in history, in a referrer or in somebody's screen share.
 */
export const mcpLifetimes = {
  authorizationCode: 60,
  accessToken: 30 * 60,
  refreshToken: 30 * 24 * 60 * 60,
  grant: 90 * 24 * 60 * 60,
  serviceAccountSecret: 365 * 24 * 60 * 60
} as const;
export type McpLifetimeKind = keyof typeof mcpLifetimes;

export function mcpExpiry(kind: McpLifetimeKind, now: Date): Date {
  return new Date(now.getTime() + mcpLifetimes[kind] * 1000);
}

/** Granted to every client, never asked for: see `negotiateMcpScopes`. */
const listing: McpScope = "mcp:tools.list";

/** The two literal loopback hosts RFC 8252 allows. `localhost` is deliberately not one of them. */
const loopbackHosts = new Set(["127.0.0.1", "[::1]"]);

function parse(uri: string): URL | null {
  try {
    const url = new URL(uri);
    // A redirect carrying credentials is a redirect that can be made to look like ours in a link.
    return url.username === "" && url.password === "" ? url : null;
  } catch {
    return null;
  }
}

/**
 * Whether a client may be sent back to this address.
 *
 * Exact match, with one exception the owner approved in D4: a client running on this machine cannot
 * reserve a port before it starts, so a registered loopback address matches a request that differs
 * **only** in the port. Host, scheme, path and query still have to be identical, and the host has to
 * be the literal address -- `localhost` is a name that somebody else's resolver answers, and the
 * whole point of the rule is that nothing between the browser and the client can collect the code.
 *
 * Outside the loopback, plain `http` is refused whatever was registered: a redirect over http hands
 * the authorization code to whoever is on the path.
 */
export function matchesRegisteredRedirect(requested: string, registered: readonly string[]): boolean {
  const target = parse(requested);
  if (!target) return false;
  if (target.hash !== "") return false;

  for (const candidate of registered) {
    const allowed = parse(candidate);
    if (!allowed) continue;
    if (allowed.protocol !== target.protocol) continue;
    if (allowed.hostname !== target.hostname) continue;
    if (allowed.pathname !== target.pathname) continue;
    if (allowed.search !== target.search) continue;

    const loopback = loopbackHosts.has(target.host.replace(/:\d+$/, ""));
    if (target.protocol === "https:") {
      if (allowed.port === target.port) return true;
      continue;
    }
    // http, so it has to be the loopback and nothing else. The port is the one field free to move.
    if (target.protocol === "http:" && loopback) return true;
  }
  return false;
}

/**
 * Whether an address may be written down as a client's redirect in the first place.
 *
 * `matchesRegisteredRedirect` answers the question at the moment a code would be handed over, when
 * refusing means a client that mysteriously does not work. This answers it while somebody is typing
 * it into a form, where the refusal is a sentence they can act on. The two agree on purpose: an
 * address this function accepts is one that function can match, and `localhost` fails both.
 */
export function isRegistrableRedirect(uri: string): boolean {
  const url = parse(uri);
  if (!url) return false;
  // A fragment never survives the round trip and a query would have to be reproduced exactly, so
  // both are refused rather than silently ignored later.
  if (url.hash !== "" || url.search !== "") return false;
  if (url.protocol === "https:") return true;
  return url.protocol === "http:" && loopbackHosts.has(url.host.replace(/:\d+$/, ""));
}

export type McpScopeRequest = {
  /** Exactly what the client asked for. Unknown names are refused rather than dropped. */
  readonly requested: readonly string[];
  /** The ceiling set when the client was registered. */
  readonly clientMax: readonly McpScope[];
  readonly actorPermissions: readonly Permission[];
};

export type McpScopeVerdict =
  { readonly granted: readonly McpScope[] } | { readonly code: Extract<McpOauthDenialCode, "MCP_SCOPE_UNAVAILABLE"> };

/**
 * What a consent may grant: the intersection of what was asked, what the client is allowed and what
 * the person can actually do.
 *
 * A scope outside any of the three is refused outright rather than quietly dropped. A partial grant
 * reads as success to the client, which then discovers that half its calls fail with a code it did
 * not expect at a moment nobody is watching; saying no here happens in front of the person giving
 * the consent, which is the only place the answer is useful.
 */
export function negotiateMcpScopes(request: McpScopeRequest): McpScopeVerdict {
  const ceiling = grantableMcpScopes(request.actorPermissions).filter(
    (scope) => scope !== listing && request.clientMax.includes(scope)
  );
  // Listing is not negotiated. It unlocks no data -- `visibleMcpTools` still shows only what this
  // token could actually call -- and a client registered without it could never discover a single
  // tool, which is a way of registering a client that does not work.
  if (request.requested.length === 0) return { granted: [listing, ...ceiling] };

  const granted: McpScope[] = [listing];
  for (const name of request.requested) {
    const scope = mcpScopes.find((known) => known === name);
    if (!scope) return { code: "MCP_SCOPE_UNAVAILABLE" };
    if (scope === listing) continue;
    if (!ceiling.includes(scope)) return { code: "MCP_SCOPE_UNAVAILABLE" };
    if (!granted.includes(scope)) granted.push(scope);
  }
  return { granted };
}

export type McpRefreshRecord = {
  readonly usedAt: Date | null;
  readonly revokedAt: Date | null;
  readonly expiresAt: Date;
  readonly grantStatus: McpGrantStatus;
};

export type McpRefreshVerdict =
  | { readonly action: "rotate" }
  | { readonly action: "revoke_family"; readonly code: Extract<McpOauthDenialCode, "MCP_REFRESH_REUSED"> }
  | { readonly action: "deny"; readonly code: McpOauthDenialCode };

/**
 * What to do when a refresh token is presented.
 *
 * Reuse is checked before anything else, expiry included. A token that has already been rotated and
 * comes back is evidence that two parties hold it, and which of them is the thief is not knowable
 * from here -- so the whole family goes, including the one the honest client is using. Answering
 * "expired" to a replayed old token would throw away exactly the signal the family exists to give.
 */
export function refreshTokenVerdict(token: McpRefreshRecord, now: Date): McpRefreshVerdict {
  if (token.usedAt !== null) return { action: "revoke_family", code: "MCP_REFRESH_REUSED" };
  if (token.revokedAt !== null) return { action: "deny", code: "MCP_REFRESH_INVALID" };
  if (token.grantStatus !== "active") return { action: "deny", code: "MCP_GRANT_REVOKED" };
  if (token.expiresAt.getTime() <= now.getTime()) return { action: "deny", code: "MCP_REFRESH_INVALID" };
  return { action: "rotate" };
}

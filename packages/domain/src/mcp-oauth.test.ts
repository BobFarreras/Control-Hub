import { describe, expect, it } from "vitest";
import {
  isRegistrableRedirect,
  matchesRegisteredRedirect,
  mcpExpiry,
  mcpLifetimes,
  negotiateMcpScopes,
  refreshTokenVerdict
} from "./mcp-oauth.js";

const now = new Date("2026-08-24T10:00:00.000Z");

describe("how long a credential lives", () => {
  it("gives an access token the half hour the owner approved", () => {
    expect(mcpLifetimes.accessToken).toBe(30 * 60);
    expect(mcpExpiry("accessToken", now)).toEqual(new Date("2026-08-24T10:30:00.000Z"));
  });

  it("keeps the authorization code far shorter than anything else", () => {
    // A code travels through a browser redirect, which is the least trustworthy leg of the flow.
    expect(mcpLifetimes.authorizationCode).toBeLessThan(mcpLifetimes.accessToken);
    expect(mcpExpiry("authorizationCode", now)).toEqual(new Date("2026-08-24T10:01:00.000Z"));
  });

  it("keeps the rotation window far shorter than the secret it succeeds", () => {
    // Two live keys for a day, not two keys forever. The window is there so a rotation can be
    // deployed, not so an old secret can be left lying around.
    expect(mcpLifetimes.serviceAccountPreviousSecret).toBeLessThan(mcpLifetimes.serviceAccountSecret / 100);
    expect(mcpExpiry("serviceAccountPreviousSecret", now)).toEqual(new Date("2026-08-25T10:00:00.000Z"));
  });

  it("never lets a refresh token outlive the grant that justifies it", () => {
    expect(mcpLifetimes.refreshToken).toBeLessThanOrEqual(mcpLifetimes.grant);
  });
});

describe("which redirect a client may be sent back to", () => {
  const https = ["https://agent.example.com/oauth/callback"];

  it("accepts the registered URI exactly and nothing near it", () => {
    expect(matchesRegisteredRedirect("https://agent.example.com/oauth/callback", https)).toBe(true);
    expect(matchesRegisteredRedirect("https://agent.example.com/oauth/callback/", https)).toBe(false);
    expect(matchesRegisteredRedirect("https://agent.example.com/oauth/callback?next=/", https)).toBe(false);
    expect(matchesRegisteredRedirect("https://agent.example.com.evil.test/oauth/callback", https)).toBe(false);
    expect(matchesRegisteredRedirect("https://agent.example.com/oauth/callback/../../x", https)).toBe(false);
  });

  it("lets a desktop client keep its own path but pick its own port", () => {
    // RFC 8252: a client on this machine cannot reserve a port in advance, so the port is the one
    // field allowed to differ. Everything else still has to match exactly.
    const loopback = ["http://127.0.0.1/callback"];
    expect(matchesRegisteredRedirect("http://127.0.0.1:51763/callback", loopback)).toBe(true);
    expect(matchesRegisteredRedirect("http://127.0.0.1:1/callback", loopback)).toBe(true);
    expect(matchesRegisteredRedirect("http://127.0.0.1:51763/other", loopback)).toBe(false);
    expect(matchesRegisteredRedirect("http://127.0.0.2:51763/callback", loopback)).toBe(false);
    expect(matchesRegisteredRedirect("https://127.0.0.1:51763/callback", loopback)).toBe(false);
  });

  it("does the same for the IPv6 loopback and for nothing that merely looks like it", () => {
    expect(matchesRegisteredRedirect("http://[::1]:8080/cb", ["http://[::1]/cb"])).toBe(true);
    // `localhost` is a name somebody else's resolver answers. RFC 8252 asks for the literal
    // address precisely so that a poisoned name cannot collect the code.
    expect(matchesRegisteredRedirect("http://localhost:8080/cb", ["http://localhost/cb"])).toBe(false);
  });

  it("refuses plain http anywhere but the loopback", () => {
    expect(matchesRegisteredRedirect("http://agent.example.com/cb", ["http://agent.example.com/cb"])).toBe(false);
  });

  it("refuses what is not a URI at all, and what carries a user in it", () => {
    expect(matchesRegisteredRedirect("not a uri", https)).toBe(false);
    expect(matchesRegisteredRedirect("https://user:pw@agent.example.com/oauth/callback", https)).toBe(false);
    expect(matchesRegisteredRedirect("https://agent.example.com/oauth/callback", [])).toBe(false);
  });
});

describe("which scopes a consent may grant", () => {
  const clientMax = ["crm.read", "support.read", "usage.read"] as const;
  const permissions = ["customers:read", "tickets:read"] as const;

  it("grants what the client may ask for and the person may give, and no more", () => {
    const verdict = negotiateMcpScopes({ requested: ["crm.read"], clientMax, actorPermissions: permissions });
    expect(verdict).toEqual({ granted: ["mcp:tools.list", "crm.read"] });
  });

  it("always lets a client list the tools, whatever it was registered with", () => {
    // Listing unlocks no data: the catalogue a token sees is already filtered down to what that
    // token could call. A client that cannot list is a client that cannot find anything to call.
    expect(negotiateMcpScopes({ requested: ["mcp:tools.list"], clientMax: [], actorPermissions: [] })).toEqual({
      granted: ["mcp:tools.list"]
    });
    expect(negotiateMcpScopes({ requested: [], clientMax: [], actorPermissions: [] })).toEqual({
      granted: ["mcp:tools.list"]
    });
  });

  it("refuses a scope the person's own permissions do not back", () => {
    // `usage.read` is inside the client's maximum, but this actor cannot read usage. Granting it
    // would mint a token that fails on every call, which is worse than saying no now.
    const verdict = negotiateMcpScopes({ requested: ["usage.read"], clientMax, actorPermissions: permissions });
    expect(verdict).toEqual({ code: "MCP_SCOPE_UNAVAILABLE" });
  });

  it("refuses a scope outside what the client was registered for", () => {
    const verdict = negotiateMcpScopes({
      requested: ["infrastructure.read"],
      clientMax,
      actorPermissions: ["infrastructure:read"]
    });
    expect(verdict).toEqual({ code: "MCP_SCOPE_UNAVAILABLE" });
  });

  it("refuses a name that is not a scope of this product", () => {
    const verdict = negotiateMcpScopes({ requested: ["admin"], clientMax, actorPermissions: permissions });
    expect(verdict).toEqual({ code: "MCP_SCOPE_UNAVAILABLE" });
  });

  it("says no rather than quietly granting less than was asked for", () => {
    // A partial grant looks like success to the client, which then discovers half its calls fail.
    const verdict = negotiateMcpScopes({
      requested: ["crm.read", "usage.read"],
      clientMax,
      actorPermissions: permissions
    });
    expect(verdict).toEqual({ code: "MCP_SCOPE_UNAVAILABLE" });
  });

  it("falls back to everything both sides allow when the client asks for nothing", () => {
    const verdict = negotiateMcpScopes({ requested: [], clientMax, actorPermissions: permissions });
    expect(verdict).toEqual({ granted: ["mcp:tools.list", "crm.read", "support.read"] });
  });
});

describe("what to do when a refresh token comes back", () => {
  const live = {
    usedAt: null,
    revokedAt: null,
    expiresAt: new Date("2026-09-24T10:00:00.000Z"),
    grantStatus: "active"
  } as const;

  it("rotates a token that has never been used", () => {
    expect(refreshTokenVerdict(live, now)).toEqual({ action: "rotate" });
  });

  it("treats a second use as a compromised lineage, not as one bad token", () => {
    // Somebody holds a copy. Which of the two holders is the thief is not knowable, so the whole
    // family goes -- including the one the honest client is using right now.
    expect(refreshTokenVerdict({ ...live, usedAt: new Date("2026-08-24T09:00:00.000Z") }, now)).toEqual({
      action: "revoke_family",
      code: "MCP_REFRESH_REUSED"
    });
  });

  it("still calls a replayed expired token a reuse", () => {
    const stale = {
      ...live,
      usedAt: new Date("2026-07-01T00:00:00.000Z"),
      expiresAt: new Date("2026-08-01T00:00:00.000Z")
    };
    expect(refreshTokenVerdict(stale, now)).toEqual({ action: "revoke_family", code: "MCP_REFRESH_REUSED" });
  });

  it("refuses a revoked token and an expired one, in that order", () => {
    expect(refreshTokenVerdict({ ...live, revokedAt: now }, now)).toEqual({
      action: "deny",
      code: "MCP_REFRESH_INVALID"
    });
    expect(refreshTokenVerdict({ ...live, expiresAt: now }, now)).toEqual({
      action: "deny",
      code: "MCP_REFRESH_INVALID"
    });
  });

  it("refuses to refresh against a grant that is no longer good", () => {
    for (const grantStatus of ["revoked", "expired", "suspended"] as const) {
      expect(refreshTokenVerdict({ ...live, grantStatus }, now), grantStatus).toEqual({
        action: "deny",
        code: "MCP_GRANT_REVOKED"
      });
    }
  });
});

describe("which redirect may be registered at all", () => {
  it("accepts https anywhere and http only on the literal loopback", () => {
    expect(isRegistrableRedirect("https://agent.example.com/oauth/callback")).toBe(true);
    expect(isRegistrableRedirect("http://127.0.0.1/callback")).toBe(true);
    expect(isRegistrableRedirect("http://127.0.0.1:51763/callback")).toBe(true);
    expect(isRegistrableRedirect("http://[::1]/cb")).toBe(true);
    expect(isRegistrableRedirect("http://agent.example.com/cb")).toBe(false);
    expect(isRegistrableRedirect("http://localhost/cb")).toBe(false);
  });

  it("refuses what a round trip would not reproduce, and what is not a URI", () => {
    expect(isRegistrableRedirect("https://agent.example.com/cb#part")).toBe(false);
    expect(isRegistrableRedirect("https://agent.example.com/cb?next=/")).toBe(false);
    expect(isRegistrableRedirect("https://user:pw@agent.example.com/cb")).toBe(false);
    expect(isRegistrableRedirect("not a uri")).toBe(false);
    expect(isRegistrableRedirect("ftp://agent.example.com/cb")).toBe(false);
  });

  it("agrees with the matcher: anything registrable can be matched back", () => {
    // The two rules drifting apart would mean an address the form accepts and the flow refuses,
    // which is the worst place to discover a disagreement.
    for (const uri of ["https://agent.example.com/cb", "http://127.0.0.1/cb", "http://[::1]/cb"]) {
      expect(isRegistrableRedirect(uri), uri).toBe(true);
      expect(matchesRegisteredRedirect(uri, [uri]), uri).toBe(true);
    }
  });
});

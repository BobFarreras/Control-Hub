import { describe, expect, it } from "vitest";
import {
  authoriseMcpToolCall,
  grantableMcpScopes,
  mcpScopes,
  registrableMcpScopes,
  verifyMcpToken,
  visibleMcpTools,
  type McpToolAuthority,
  type McpTokenRecord
} from "./mcp.js";

const resource = { issuer: "https://hub.example", audience: "https://hub.example/mcp" };
const now = new Date("2026-08-24T10:00:00.000Z");

function token(overrides: Partial<McpTokenRecord> = {}): McpTokenRecord {
  return {
    issuer: "https://hub.example",
    audience: "https://hub.example/mcp",
    tenantId: "tenant-a",
    scopes: ["support.read"],
    expiresAt: new Date("2026-08-24T10:15:00.000Z"),
    revokedAt: null,
    grantStatus: "active",
    ...overrides
  };
}

const ticketsList: McpToolAuthority = {
  name: "support.tickets.list",
  version: "v1",
  scope: "support.read",
  permission: "tickets:read",
  mutating: false
};

const customersList: McpToolAuthority = {
  name: "crm.customers.list",
  version: "v1",
  scope: "crm.read",
  permission: "customers:read",
  mutating: false
};

describe("verifying an MCP access token", () => {
  it("accepts a token this installation issued for its own MCP resource", () => {
    expect(verifyMcpToken(token(), resource, now)).toEqual({ allowed: true });
  });

  it("refuses a token issued for another audience before looking at anything else", () => {
    // The token is otherwise perfect: right issuer, live, in scope. Audience alone decides,
    // and it decides before tenant, permission or tool are ever resolved.
    const other = token({ audience: "https://hub.example/portal" });
    expect(verifyMcpToken(other, resource, now)).toEqual({ allowed: false, code: "MCP_AUDIENCE_INVALID" });
  });

  it("refuses a token from another issuer", () => {
    const foreign = token({ issuer: "https://accounts.google.com" });
    expect(verifyMcpToken(foreign, resource, now)).toEqual({ allowed: false, code: "MCP_TOKEN_INVALID" });
  });

  it("compares the audience exactly, without normalising it into a match", () => {
    for (const audience of [
      "https://hub.example/mcp/",
      "https://hub.example/MCP",
      "https://hub.example/mcp/tools",
      "http://hub.example/mcp"
    ]) {
      expect(verifyMcpToken(token({ audience }), resource, now)).toEqual({
        allowed: false,
        code: "MCP_AUDIENCE_INVALID"
      });
    }
  });

  it("refuses an expired token, and treats the expiry instant as already past", () => {
    const expired = token({ expiresAt: new Date("2026-08-24T09:59:59.999Z") });
    expect(verifyMcpToken(expired, resource, now)).toEqual({ allowed: false, code: "MCP_TOKEN_EXPIRED" });
    expect(verifyMcpToken(token({ expiresAt: now }), resource, now)).toEqual({
      allowed: false,
      code: "MCP_TOKEN_EXPIRED"
    });
  });

  it("refuses a revoked token on the very next call, and does not call it expired", () => {
    // Reporting a revoked token as expired would invite the client to refresh, which is both a
    // wasted round trip and a misleading answer. Revocation is reported as invalid.
    const revoked = token({ revokedAt: new Date("2026-08-24T09:30:00.000Z") });
    expect(verifyMcpToken(revoked, resource, now)).toEqual({ allowed: false, code: "MCP_TOKEN_INVALID" });
    const bothRevokedAndExpired = token({
      revokedAt: new Date("2026-08-24T09:30:00.000Z"),
      expiresAt: new Date("2026-08-24T09:40:00.000Z")
    });
    expect(verifyMcpToken(bothRevokedAndExpired, resource, now)).toEqual({
      allowed: false,
      code: "MCP_TOKEN_INVALID"
    });
  });

  it("refuses a token whose grant is no longer active", () => {
    for (const grantStatus of ["revoked", "expired", "suspended"] as const) {
      expect(verifyMcpToken(token({ grantStatus }), resource, now)).toEqual({
        allowed: false,
        code: "MCP_TOKEN_INVALID"
      });
    }
  });

  it("accepts a token with no scopes at all: it is valid and can do nothing", () => {
    // Deny by default lives in the tool decision, not here. A scopeless token is not malformed.
    expect(verifyMcpToken(token({ scopes: [] }), resource, now)).toEqual({ allowed: true });
  });
});

describe("authorising one tool call", () => {
  const actor = { permissions: ["tickets:read", "customers:read"] as const };

  it("allows a deployed tool the token scopes and the actor may use", () => {
    expect(
      authoriseMcpToolCall({
        tool: ticketsList,
        deployed: true,
        token: { tenantId: "tenant-a", scopes: ["support.read"] },
        actor
      })
    ).toEqual({ allowed: true });
  });

  it("refuses an argument that names another tenant, whatever the token may do", () => {
    expect(
      authoriseMcpToolCall({
        tool: ticketsList,
        deployed: true,
        token: { tenantId: "tenant-a", scopes: ["support.read"] },
        actor,
        targetTenantId: "tenant-b"
      })
    ).toEqual({ allowed: false, code: "MCP_TENANT_MISMATCH" });
  });

  it("accepts an argument that names the token's own tenant", () => {
    expect(
      authoriseMcpToolCall({
        tool: ticketsList,
        deployed: true,
        token: { tenantId: "tenant-a", scopes: ["support.read"] },
        actor,
        targetTenantId: "tenant-a"
      })
    ).toEqual({ allowed: true });
  });

  it("hides a tool whose module is not deployed here", () => {
    expect(
      authoriseMcpToolCall({
        tool: ticketsList,
        deployed: false,
        token: { tenantId: "tenant-a", scopes: ["support.read"] },
        actor
      })
    ).toEqual({ allowed: false, code: "TOOL_NOT_PUBLISHED" });
  });

  it("hides a mutating tool while writes are unpublished", () => {
    const reply: McpToolAuthority = { ...ticketsList, name: "support.tickets.reply", mutating: true };
    expect(
      authoriseMcpToolCall({
        tool: reply,
        deployed: true,
        token: { tenantId: "tenant-a", scopes: ["support.read"] },
        actor
      })
    ).toEqual({ allowed: false, code: "TOOL_NOT_PUBLISHED" });
  });

  it("reports an insufficient scope before consulting the actor's permissions", () => {
    // The token is the credential presented, so its authority is decided first. The answer is
    // actionable: a client that lacks a scope can ask for it.
    expect(
      authoriseMcpToolCall({
        tool: ticketsList,
        deployed: true,
        token: { tenantId: "tenant-a", scopes: ["crm.read"] },
        actor: { permissions: [] }
      })
    ).toEqual({ allowed: false, code: "MCP_SCOPE_INSUFFICIENT" });
  });

  it("gives the same answer REST gives when the permission is missing", () => {
    expect(
      authoriseMcpToolCall({
        tool: customersList,
        deployed: true,
        token: { tenantId: "tenant-a", scopes: ["crm.read"] },
        actor: { permissions: ["tickets:read"] }
      })
    ).toEqual({ allowed: false, code: "PERMISSION_DENIED" });
  });

  it("stops allowing a tool the moment the actor loses the permission, with the same token", () => {
    const call = (permissions: readonly ("tickets:read" | "customers:read")[]) =>
      authoriseMcpToolCall({
        tool: ticketsList,
        deployed: true,
        token: { tenantId: "tenant-a", scopes: ["support.read"] },
        actor: { permissions }
      });
    expect(call(["tickets:read"])).toEqual({ allowed: true });
    expect(call([])).toEqual({ allowed: false, code: "PERMISSION_DENIED" });
  });
});

describe("listing the tools a token may call", () => {
  const catalogue: readonly McpToolAuthority[] = [ticketsList, customersList];

  it("lists exactly what is callable, and nothing else", () => {
    const visible = visibleMcpTools({
      catalogue,
      deployed: () => true,
      token: { tenantId: "tenant-a", scopes: ["support.read"] },
      actor: { permissions: ["tickets:read", "customers:read"] }
    });
    expect(visible.map((tool) => tool.name)).toEqual(["support.tickets.list"]);
  });

  it("drops a tool whose module is switched off in this installation", () => {
    const visible = visibleMcpTools({
      catalogue,
      deployed: (tool) => tool.name !== "support.tickets.list",
      token: { tenantId: "tenant-a", scopes: ["support.read", "crm.read"] },
      actor: { permissions: ["tickets:read", "customers:read"] }
    });
    expect(visible.map((tool) => tool.name)).toEqual(["crm.customers.list"]);
  });

  it("lists nothing for a token with no scopes", () => {
    expect(
      visibleMcpTools({
        catalogue,
        deployed: () => true,
        token: { tenantId: "tenant-a", scopes: [] },
        actor: { permissions: ["tickets:read", "customers:read"] }
      })
    ).toEqual([]);
  });
});

describe("which scopes a person may consent to", () => {
  it("offers only the scopes the actor's own permissions can back", () => {
    expect(grantableMcpScopes(["tickets:read"])).toEqual(["mcp:tools.list", "support.read"]);
  });

  it("always offers the catalogue scope, which unlocks no data by itself", () => {
    expect(grantableMcpScopes([])).toEqual(["mcp:tools.list"]);
  });

  it("offers every read scope to an owner-shaped permission set", () => {
    const everything = [
      "customers:read",
      "tickets:read",
      "projects:read",
      "products:manage",
      "infrastructure:read",
      "usage:read"
    ] as const;
    expect(grantableMcpScopes(everything)).toEqual([...mcpScopes]);
  });

  it("never invents a scope outside the declared list", () => {
    for (const scope of grantableMcpScopes(["customers:read", "usage:read"])) {
      expect(mcpScopes).toContain(scope);
    }
  });
});

describe("which scopes a client may record as its ceiling", () => {
  it("is every scope that can be asked for, and listing is not one of them", () => {
    // Derived from `mcpScopes` rather than written out again: a scope added there must appear in
    // the registration form and in dynamic registration without anybody remembering to add it.
    expect(registrableMcpScopes).toEqual(mcpScopes.filter((scope) => scope !== "mcp:tools.list"));
    expect(registrableMcpScopes).not.toContain("mcp:tools.list");
    expect(registrableMcpScopes.length).toBeGreaterThan(0);
  });

  it("offers nothing a consent could not negotiate", () => {
    // A ceiling naming something outside the vocabulary would be a promise the tool decision
    // refuses to keep, discovered at the first call rather than at registration.
    for (const scope of registrableMcpScopes) {
      expect(mcpScopes).toContain(scope);
    }
  });
});

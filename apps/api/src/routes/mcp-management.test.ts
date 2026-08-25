import type { McpOauthService } from "@control-hub/application";
import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import type { ControlHubAuth } from "../auth.js";
import { describeConnectorError, problemContentType, problemDetails } from "../problem.js";
import type { ControlHubApp } from "../server-instance.js";
import {
  mcpClientResponse,
  mcpGrantResponse,
  mcpServiceAccountResponse,
  registerMcpManagementRoutes
} from "./mcp-management.js";

const tenantId = "11111111-1111-4111-8111-111111111111";
const now = new Date("2026-08-25T10:00:00.000Z");

const client = {
  id: "client-row-1",
  clientId: "generated-1",
  name: "Claude Desktop",
  kind: "confidential" as const,
  redirectUris: ["http://127.0.0.1:51763/callback"],
  maxScopes: ["crm.read"] as const,
  status: "active" as const,
  createdAt: now
};

const grant = {
  id: "grant-1",
  clientId: "client-row-1",
  clientName: "Claude Desktop",
  actorType: "user" as const,
  actorMembershipId: "membership-1",
  actorServiceAccountId: null,
  scopes: ["mcp:tools.list", "crm.read"] as const,
  status: "active" as const,
  consentedAt: now,
  expiresAt: now,
  revokedAt: null,
  lastUsedAt: null
};

const account = {
  id: "account-1",
  name: "Nightly report",
  ownerMembershipId: "membership-1",
  scopes: ["crm.read"] as const,
  permissions: ["customers:read"] as const,
  expiresAt: now,
  disabledAt: null,
  secretRotatedAt: null,
  createdAt: now
};

type Audit = { action: unknown; targetType: unknown; targetId: unknown; outcome: unknown; metadata: unknown };

/**
 * A database that answers the two questions this surface asks of one, and records the second.
 *
 * `resolveTenantContext` reads memberships through a tagged template, and `writeAudit` opens a
 * transaction and inserts. Both are stubbed here rather than reached, because what is under test is
 * which audit rows a handler leaves behind and with what outcome -- not whether Postgres can store
 * them, which the persistence suite settles against a real server.
 */
const databaseFor = (permissions: string[], audits: Audit[]) => {
  const query = vi.fn().mockResolvedValue(
    permissions.map((permission) => ({
      tenant_id: tenantId,
      membership_id: "membership-1",
      role: "owner",
      permission
    }))
  );
  const transaction = Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) => {
      // The positions are the ones `writeAudit` lists in its `values (...)` clause. Reading them
      // back by index is coupling, and it is the coupling worth having: a column reordered there
      // fails here rather than quietly changing what every audit assertion in this file means.
      if (strings[0]?.includes("insert into audit_log"))
        audits.push({
          action: values[3],
          targetType: values[4],
          targetId: values[5],
          outcome: values[6],
          metadata: values[9]
        });
      return Promise.resolve([]);
    },
    { json: (value: unknown) => value }
  );
  return Object.assign(query, {
    begin: (operation: (tx: typeof transaction) => Promise<unknown>) => operation(transaction)
  }) as never;
};

const authFor = (twoFactorEnabled = true) =>
  ({
    api: { getSession: () => Promise.resolve({ user: { id: "user-1", twoFactorEnabled } }) }
  }) as unknown as ControlHubAuth;

type ServiceOverrides = Partial<Record<string, unknown>>;

const serviceStub = (overrides: ServiceOverrides, calls: Array<{ method: string; args: unknown[] }>) => {
  const record =
    (method: string, answer: unknown) =>
    (...args: unknown[]) => {
      calls.push({ method, args });
      if (answer instanceof Error) throw answer;
      return Promise.resolve(answer);
    };
  return {
    listClients: record("listClients", overrides.listClients ?? [client]),
    registerClient: record("registerClient", overrides.registerClient ?? { client, secret: "chm_cs_new" }),
    deleteClient: record("deleteClient", overrides.deleteClient ?? true),
    listGrants: record("listGrants", overrides.listGrants ?? [grant]),
    revokeGrant: record("revokeGrant", overrides.revokeGrant ?? true),
    listServiceAccounts: record("listServiceAccounts", overrides.listServiceAccounts ?? [account]),
    createServiceAccount: record(
      "createServiceAccount",
      overrides.createServiceAccount ?? { account, secret: "chm_sa_new" }
    ),
    rotateServiceAccountSecret: record(
      "rotateServiceAccountSecret",
      overrides.rotateServiceAccountSecret ?? "chm_sa_rotated"
    ),
    retirePreviousSecret: record("retirePreviousSecret", overrides.retirePreviousSecret ?? true),
    disableServiceAccount: record("disableServiceAccount", overrides.disableServiceAccount ?? true)
  } as unknown as McpOauthService;
};

const boot = async (options: { permissions?: string[]; service?: ServiceOverrides } = {}) => {
  const audits: Audit[] = [];
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const app = Fastify();
  /**
   * The application's own error handler, in the one shape this surface relies on.
   *
   * These routes never catch: a permission refused travels as an `ApiSecurityError` and a service
   * refusal as a `McpOauthError`, and both are turned into problem details by the handler in
   * `app.ts`. Wiring the real `describeConnectorError` here rather than a stand-in is what makes
   * these assertions say something about production: a code that handler cannot describe would
   * come back as a 500 in this test too.
   */
  app.setErrorHandler((error, request, reply) => {
    const described = describeConnectorError(error) ?? { status: 500, code: "INTERNAL_ERROR" };
    return reply
      .code(described.status)
      .type(problemContentType)
      .send(problemDetails({ ...described, instance: request.url, requestId: request.id }));
  });
  registerMcpManagementRoutes({
    app: app as unknown as ControlHubApp,
    database: databaseFor(options.permissions ?? ["security:manage"], audits),
    auth: authFor(),
    mcp: serviceStub(options.service ?? {}, calls)
  });
  await app.ready();
  return { app, audits, calls };
};

describe("what the management surface shows a screen", () => {
  it("describes a client without the secret it was registered with", () => {
    // The record does not carry the hash either, and that is the point: the shape is written field
    // by field, so a column added to the table later cannot reach a screen by merely existing.
    expect(Object.keys(mcpClientResponse(client)).sort()).toEqual(
      ["createdAt", "clientId", "id", "kind", "maxScopes", "name", "redirectUris", "status"].sort()
    );
  });

  it("describes a consent with the field that makes it actionable", () => {
    // Without `lastUsedAt` every row in the list looks alike, and the consent worth withdrawing --
    // the one nobody has exercised in two months -- is indistinguishable from the one in daily use.
    expect(mcpGrantResponse(grant)).toMatchObject({ id: "grant-1", lastUsedAt: null, scopes: grant.scopes });
  });

  it("describes a service account with the ceiling its scopes are measured against", () => {
    const response = mcpServiceAccountResponse(account);
    expect(response).toMatchObject({ scopes: account.scopes, permissions: account.permissions });
    expect(JSON.stringify(response)).not.toContain("chm_sa");
  });
});

describe("the vocabularies the screen is told rather than told to know", () => {
  /**
   * The screen offering these lists lives in `apps/web`, which does not depend on the domain. The
   * alternative to sending them is a hand-kept copy over there, and a copy of a closed list goes
   * wrong in the quietest way there is: it offers fewer choices than exist, and nobody notices
   * because nothing fails.
   */
  it("sends the scopes a ceiling may be drawn from, and not the one that is never withheld", async () => {
    const { app } = await boot();
    const body = (await app.inject({ method: "GET", url: "/api/v1/mcp/clients" })).json<{ scopes: string[] }>();
    expect(body.scopes).toContain("crm.read");
    // A ceiling records what may be withheld. Listing what you may call is not one of those.
    expect(body.scopes).not.toContain("mcp:tools.list");
  });

  it("sends only the scopes this reader could actually back", async () => {
    // Not the whole vocabulary: an account cannot be created with more than its creator holds, and
    // offering the rest would be inviting a refusal the form could have foreseen.
    const { app } = await boot({ permissions: ["security:manage", "customers:read"] });
    const body = (await app.inject({ method: "GET", url: "/api/v1/mcp/service-accounts" })).json<{
      grantableScopes: string[];
    }>();
    expect(body.grantableScopes).toEqual(["mcp:tools.list", "crm.read"]);
  });

  it("narrows that list with the reader, not with the route", async () => {
    const { app } = await boot();
    const body = (await app.inject({ method: "GET", url: "/api/v1/mcp/service-accounts" })).json<{
      grantableScopes: string[];
    }>();
    // `security:manage` opens this surface and backs no scope at all, which is exactly right:
    // administering the agents is not the same as being allowed to read what they read.
    expect(body.grantableScopes).toEqual(["mcp:tools.list"]);
  });
});

describe("who may reach the management surface", () => {
  const routes = [
    { method: "GET" as const, url: "/api/v1/mcp/clients" },
    { method: "POST" as const, url: "/api/v1/mcp/clients" },
    { method: "DELETE" as const, url: "/api/v1/mcp/clients/client-row-1" },
    { method: "GET" as const, url: "/api/v1/mcp/grants" },
    { method: "DELETE" as const, url: "/api/v1/mcp/grants/grant-1" },
    { method: "GET" as const, url: "/api/v1/mcp/service-accounts" },
    { method: "POST" as const, url: "/api/v1/mcp/service-accounts" },
    { method: "POST" as const, url: "/api/v1/mcp/service-accounts/account-1/rotate" },
    { method: "POST" as const, url: "/api/v1/mcp/service-accounts/account-1/retire-previous-secret" },
    { method: "DELETE" as const, url: "/api/v1/mcp/service-accounts/account-1" }
  ];

  it("demands security:manage on every route, reads included", async () => {
    // A reader who cannot manage security has no business knowing which agents exist, what they
    // may reach or when their consent lapses. There is no read-only tier here on purpose, and the
    // loop is what keeps a route added later from quietly arriving without the guard.
    const { app, calls } = await boot({ permissions: ["customers:read"] });
    for (const route of routes) {
      const response = await app.inject({ ...route, payload: {} });
      expect(response.statusCode, route.url).toBe(403);
      expect(response.json(), route.url).toMatchObject({ code: "PERMISSION_DENIED" });
    }
    // Nothing reached the service: the refusal happens before any use case is asked to run.
    expect(calls).toEqual([]);
  });

  it("records the refusal under the tenant it was refused in", async () => {
    // A denial nobody wrote down is the one an investigation cannot see afterwards.
    const { app, audits } = await boot({ permissions: ["customers:read"] });
    await app.inject({ method: "DELETE", url: "/api/v1/mcp/grants/grant-1" });
    expect(audits).toEqual([
      { action: "mcp.grant.revoke", targetType: "mcp_grant", targetId: "grant-1", outcome: "denied", metadata: {} }
    ]);
  });

  it("answers in problem details, like the rest of this surface", async () => {
    const { app } = await boot({ permissions: ["customers:read"] });
    const response = await app.inject({ method: "GET", url: "/api/v1/mcp/clients" });
    expect(response.headers["content-type"]).toContain(problemContentType);
    expect(response.json()).toMatchObject({ status: 403, title: "Permission denied" });
  });
});

describe("registering a client and creating an account", () => {
  it("hands the secret back once, and writes down everything except it", async () => {
    const { app, audits } = await boot();
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/mcp/clients",
      payload: {
        name: "Claude Desktop",
        kind: "confidential",
        redirectUris: client.redirectUris,
        maxScopes: ["crm.read"]
      }
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ secret: "chm_cs_new", client: { id: "client-row-1" } });
    expect(audits[0]).toMatchObject({ action: "mcp.client.register", outcome: "success" });
    // The audit row travels to a screen somebody can read months later. What was created belongs
    // there; what was minted does not, and no amount of usefulness makes a secret in a log safe.
    expect(JSON.stringify(audits)).not.toContain("chm_cs_new");
  });

  it("does the same for a service account, and records the permissions it was capped at", async () => {
    const { app, audits } = await boot();
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/mcp/service-accounts",
      payload: { name: "Nightly report", scopes: ["crm.read"], permissions: ["customers:read"] }
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ secret: "chm_sa_new" });
    expect(audits[0]).toMatchObject({
      action: "mcp.service-account.create",
      outcome: "success",
      metadata: { scopes: "crm.read", permissions: "customers:read" }
    });
    expect(JSON.stringify(audits)).not.toContain("chm_sa_new");
  });

  it("rotates a secret and says nothing else about the account", async () => {
    const { app, audits } = await boot();
    const response = await app.inject({ method: "POST", url: "/api/v1/mcp/service-accounts/account-1/rotate" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ secret: "chm_sa_rotated" });
    expect(audits[0]).toMatchObject({ action: "mcp.service-account.rotate", outcome: "success" });
    expect(JSON.stringify(audits)).not.toContain("chm_sa_rotated");
  });
});

describe("withdrawing what was granted", () => {
  it("answers 204 when the consent was there, and records who ended it", async () => {
    const { app, audits, calls } = await boot();
    const response = await app.inject({ method: "DELETE", url: "/api/v1/mcp/grants/grant-1" });

    expect(response.statusCode).toBe(204);
    // The membership that withdrew it is the service's business, not the route's: it takes the one
    // on the context rather than one the caller could name.
    expect(calls).toEqual([{ method: "revokeGrant", args: [expect.objectContaining({ tenantId }), "grant-1"] }]);
    expect(audits[0]).toMatchObject({ action: "mcp.grant.revoke", targetId: "grant-1", outcome: "success" });
  });

  it("answers 404 in problem details when there was nothing to withdraw", async () => {
    // Already withdrawn and never this tenant's are the same non-event, and the caller has nothing
    // to retry in either case.
    const { app, audits } = await boot({ service: { revokeGrant: false } });
    const response = await app.inject({ method: "DELETE", url: "/api/v1/mcp/grants/grant-1" });

    expect(response.statusCode).toBe(404);
    expect(response.headers["content-type"]).toContain(problemContentType);
    expect(response.json()).toMatchObject({ code: "MCP_GRANT_UNKNOWN", title: "No such consent" });
    // Recorded as a failure rather than dropped: somebody aiming at a consent that is not there is
    // a thing worth being able to see afterwards.
    expect(audits[0]).toMatchObject({ outcome: "failure" });
  });

  it("disables a service account rather than deleting it", async () => {
    const { app, calls } = await boot();
    const response = await app.inject({ method: "DELETE", url: "/api/v1/mcp/service-accounts/account-1" });

    expect(response.statusCode).toBe(204);
    expect(calls[0]?.method).toBe("disableServiceAccount");
  });

  it("ends the rotation window when the old secret is known to be compromised", async () => {
    const { app, calls, audits } = await boot();
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/mcp/service-accounts/account-1/retire-previous-secret"
    });

    expect(response.statusCode).toBe(204);
    expect(calls[0]?.method).toBe("retirePreviousSecret");
    expect(audits[0]).toMatchObject({ action: "mcp.service-account.retire-previous-secret", outcome: "success" });
  });
});

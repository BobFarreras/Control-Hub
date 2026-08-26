import type { McpScope, Permission } from "@control-hub/domain";
import { describe, expect, it } from "vitest";
import type { McpAccessTokenResolution } from "./mcp-oauth.js";
import { McpOauthError } from "./mcp-oauth.js";
import { McpSessionService, type McpActorIdentity, type McpSessionRepository } from "./mcp-session.js";
import type { McpToolServices } from "./mcp.js";

const issuer = "https://hub.test";
const identity = { issuer, audience: `${issuer}/mcp` };
const now = new Date("2026-08-25T10:00:00.000Z");
const tenantA = "11111111-1111-4111-8111-111111111111";
const tenantB = "22222222-2222-4222-8222-222222222222";

const resolution: McpAccessTokenResolution = {
  tokenId: "token-1",
  tenantId: tenantA,
  grantId: "grant-1",
  audience: `${issuer}/mcp`,
  scopes: ["mcp:tools.list", "crm.read", "support.read"],
  expiresAt: new Date("2026-08-25T10:30:00.000Z"),
  revokedAt: null,
  grantStatus: "active",
  grantExpiresAt: new Date("2026-11-23T10:00:00.000Z"),
  grantRevokedAt: null,
  actorType: "user",
  actorMembershipId: "membership-1",
  actorServiceAccountId: null,
  clientStatus: "active"
};

const person: McpActorIdentity = {
  membershipId: "membership-1",
  userId: "user-1",
  roles: ["owner"],
  permissions: ["customers:read", "tickets:read"]
};

type Overrides = {
  token?: McpAccessTokenResolution | null;
  actor?: McpActorIdentity | null;
  deployed?: boolean;
  customers?: () => Promise<unknown>;
};

const build = (overrides: Overrides = {}) => {
  const recorded = {
    touched: [] as string[],
    calls: [] as Array<Record<string, unknown>>,
    hashed: [] as string[]
  };
  const tokens = {
    resolveAccessToken: (hash: string) => {
      recorded.hashed.push(hash);
      return Promise.resolve(overrides.token === undefined ? resolution : overrides.token);
    },
    touchAccessToken: (_scope: unknown, tokenId: string) => {
      recorded.touched.push(tokenId);
      return Promise.resolve();
    }
  };
  const sessions = {
    resolveActor: () => Promise.resolve(overrides.actor === undefined ? person : overrides.actor),
    recordToolCall: (_scope: unknown, input: Record<string, unknown>) => {
      recorded.calls.push(input);
      return Promise.resolve();
    }
  } as unknown as McpSessionRepository;

  const services = {
    crm: {
      listCustomers:
        overrides.customers ??
        (() => Promise.resolve({ items: [{ id: "customer-1" }], total: 1, page: 1, pageSize: 25 })),
      getCustomer: () => Promise.resolve({ id: "customer-1" })
    },
    support: {
      listTickets: () => Promise.resolve({ items: [], total: 0, page: 1, pageSize: 25 }),
      ticketDetail: () => Promise.resolve({ id: "ticket-1" })
    },
    infrastructure: { readInventory: () => Promise.resolve({}), listAlerts: () => Promise.resolve([]) },
    usage: { listSources: () => Promise.resolve([]) },
    clock: () => now
  } as unknown as McpToolServices;

  const service = new McpSessionService({
    tokens,
    sessions,
    services,
    crypto: { sha256: (value: string) => `sha256:${value}` },
    identity,
    isDeployed: () => overrides.deployed ?? true,
    clock: () => now
  });
  return { service, recorded };
};

const denialOf = async (run: () => Promise<unknown>) => {
  const error = await run().catch((thrown: unknown) => thrown);
  expect(error).toBeInstanceOf(McpOauthError);
  return (error as McpOauthError).code;
};

describe("turning a bearer token into somebody who may call things", () => {
  it("never lets the token itself reach the store", async () => {
    // The store holds hashes. A token that arrived there would be a credential in a query log, in
    // a slow-query report and in whatever the database ships to.
    const { service, recorded } = build();
    await service.authenticate("chm_at_secret");
    expect(recorded.hashed).toEqual(["sha256:chm_at_secret"]);
  });

  it("builds a context from the membership, not from anything the token carried", async () => {
    // The permissions are read at call time. A token minted an hour ago must not carry authority
    // that was taken away half an hour later.
    const { service } = build();
    const actor = await service.authenticate("chm_at_secret");
    expect(actor.context).toMatchObject({
      tenantId: tenantA,
      membershipId: "membership-1",
      userId: "user-1",
      permissions: ["customers:read", "tickets:read"]
    });
    expect(actor.scopes).toContain("crm.read");
  });

  it("answers an absent, unknown or revoked token identically", async () => {
    // Which of the three it was is what somebody holding a value they found would like to learn.
    for (const token of [undefined, null, { ...resolution, revokedAt: now }]) {
      const { service } = build(token === undefined ? {} : { token });
      const bearer = token === undefined ? undefined : "chm_at_secret";
      expect(await denialOf(() => service.authenticate(bearer))).toBe("MCP_TOKEN_INVALID");
    }
  });

  it("says expired only for a token that was otherwise fine", async () => {
    // A client can act on this one: it refreshes. Reporting a revoked token as expired would send
    // it into a refresh that cannot succeed.
    const { service } = build({ token: { ...resolution, expiresAt: now } });
    expect(await denialOf(() => service.authenticate("chm_at_secret"))).toBe("MCP_TOKEN_EXPIRED");
  });

  it("refuses a token minted for another resource before it looks at anything else", async () => {
    const { service } = build({ token: { ...resolution, audience: "https://elsewhere.test/mcp" } });
    expect(await denialOf(() => service.authenticate("chm_at_secret"))).toBe("MCP_AUDIENCE_INVALID");
  });

  it("treats a suspended client and a withdrawn consent as a token that no longer works", async () => {
    // Suspending a client has to stop every token it holds without deleting a single grant, and an
    // expired consent has to stop one even though the row still says active.
    for (const token of [
      { ...resolution, clientStatus: "suspended" as const },
      { ...resolution, grantStatus: "revoked" as const },
      { ...resolution, grantExpiresAt: now }
    ]) {
      const { service } = build({ token });
      expect(await denialOf(() => service.authenticate("chm_at_secret"))).toBe("MCP_TOKEN_INVALID");
    }
  });

  it("lets in an agent whose grant has no client to be suspended", async () => {
    // A service account opens its grant with a secret, so there is no registered client on it and
    // the store answers null. Reading that as "not active" refused every agent this server issued
    // a token to, with the same answer it gives somebody presenting a value they found.
    const { service } = build({
      token: {
        ...resolution,
        clientStatus: null,
        actorType: "service_account" as const,
        actorServiceAccountId: "account-1",
        actorMembershipId: null
      }
    });
    const actor = await service.authenticate("chm_at_secret");
    expect(actor).toMatchObject({ actorType: "service_account", actorId: "account-1" });
  });

  it("refuses a token whose actor no longer exists", async () => {
    // A membership that was removed leaves live tokens behind. Nothing revokes them at the moment
    // somebody is taken off a tenant, so this is where that has to be noticed.
    const { service } = build({ actor: null });
    expect(await denialOf(() => service.authenticate("chm_at_secret"))).toBe("MCP_TOKEN_INVALID");
  });

  it("records that the token was used, without letting that failure refuse the call", async () => {
    const { service, recorded } = build();
    await service.authenticate("chm_at_secret");
    expect(recorded.touched).toEqual(["token-1"]);
  });
});

describe("what a token may see in the catalogue", () => {
  it("lists only what this token could actually call", async () => {
    // A listing wider than the calls it permits is a map of everything the caller may not touch.
    const { service } = build();
    const actor = await service.authenticate("chm_at_secret");
    const names = service.listTools(actor).map((tool) => tool.name);

    expect(names).toContain("crm.customers.list");
    expect(names).toContain("support.tickets.list");
    // No `usage.read` scope on this token and no `usage:read` permission behind it.
    expect(names).not.toContain("usage.summary");
  });

  it("hides a tool whose module this installation does not deploy", async () => {
    const { service } = build({ deployed: false });
    const actor = await service.authenticate("chm_at_secret");
    expect(service.listTools(actor)).toEqual([]);
  });

  it("gives each tool the schema a client needs to call it", async () => {
    const { service } = build();
    const actor = await service.authenticate("chm_at_secret");
    const tool = service.listTools(actor).find((candidate) => candidate.name === "crm.customers.list");
    expect(tool?.inputSchema).toMatchObject({ type: "object", additionalProperties: false });
    expect(tool?.description.length).toBeGreaterThan(0);
  });
});

describe("calling a tool", () => {
  const actorOf = (service: McpSessionService) => service.authenticate("chm_at_secret");

  it("runs the use case and reports how much came back", async () => {
    const { service } = build();
    const result = await service.callTool(await actorOf(service), "crm.customers.list", {});
    expect(result.items).toBe(1);
  });

  it("writes one audit row for every call, with the count and never the payload", async () => {
    // The record has to say what was read without becoming a second copy of it. A customer list in
    // an append-only table is a customer list nobody can delete.
    const { service, recorded } = build();
    await service.callTool(await actorOf(service), "crm.customers.list", {});

    expect(recorded.calls).toHaveLength(1);
    expect(recorded.calls[0]).toMatchObject({
      tool: "crm.customers.list",
      outcome: "success",
      items: 1,
      actorType: "user",
      actorId: "membership-1",
      grantId: "grant-1"
    });
    expect(JSON.stringify(recorded.calls[0])).not.toContain("customer-1");
  });

  it("records the refusals too, which are the ones worth reading later", async () => {
    // An audit trail that only holds what succeeded cannot answer the question anybody actually
    // asks of it, which is what somebody tried.
    const { service, recorded } = build();
    const actor = await actorOf(service);
    expect(await denialOf(() => service.callTool(actor, "usage.summary", {}))).toBe("MCP_SCOPE_INSUFFICIENT");
    expect(recorded.calls[0]).toMatchObject({
      tool: "usage.summary",
      outcome: "denied",
      code: "MCP_SCOPE_INSUFFICIENT"
    });
  });

  it("answers an unknown name the same as a tool that is not deployed", async () => {
    // Probing the catalogue must not reveal which tools exist somewhere but not here.
    const { service } = build();
    const actor = await actorOf(service);
    expect(await denialOf(() => service.callTool(actor, "crm.customers.delete", {}))).toBe("TOOL_NOT_PUBLISHED");
    const off = build({ deployed: false });
    const offActor = await off.service.authenticate("chm_at_secret");
    expect(await denialOf(() => off.service.callTool(offActor, "crm.customers.list", {}))).toBe("TOOL_NOT_PUBLISHED");
  });

  it("compares a tenant named in the arguments instead of obeying it", async () => {
    // This is the whole of cross-tenant isolation on this surface: an argument can never widen
    // what the token already fixed.
    const { service } = build();
    const actor = await actorOf(service);
    expect(await denialOf(() => service.callTool(actor, "crm.customers.list", { tenantId: tenantB }))).toBe(
      "MCP_TENANT_MISMATCH"
    );
  });

  it("does not let a use case failure look like a permission decision", async () => {
    // A read that threw is a failure of ours. Reporting it as a denial would send somebody looking
    // at roles for a problem that is in the query.
    const { service, recorded } = build({ customers: () => Promise.reject(new Error("connection reset")) });
    const actor = await actorOf(service);
    await expect(service.callTool(actor, "crm.customers.list", {})).rejects.toThrow("connection reset");
    expect(recorded.calls[0]).toMatchObject({ outcome: "failure" });
    // And the message does not travel into the record: it can quote a query, a host or a value.
    expect(JSON.stringify(recorded.calls[0])).not.toContain("connection reset");
  });
});

describe("a service account calling the same tools", () => {
  const agentToken: McpAccessTokenResolution = {
    ...resolution,
    actorType: "service_account",
    actorMembershipId: null,
    actorServiceAccountId: "account-1"
  };

  it("acts with the account's permissions and is recorded as the account", async () => {
    // The context names the owner, because the read use cases need a person and the owner is who
    // answers for the agent. Which agent it actually was is what the audit columns are for.
    const { service, recorded } = build({
      token: agentToken,
      actor: { ...person, permissions: ["customers:read"] as Permission[] }
    });
    const actor = await service.authenticate("chm_at_secret");
    expect(actor.actorType).toBe("service_account");
    expect(actor.actorId).toBe("account-1");

    await service.callTool(actor, "crm.customers.list", {});
    expect(recorded.calls[0]).toMatchObject({ actorType: "service_account", actorId: "account-1" });
  });

  it("cannot reach a tool its narrowed permissions do not back", async () => {
    const { service } = build({
      token: agentToken,
      actor: { ...person, permissions: ["customers:read"] as Permission[] }
    });
    const actor = await service.authenticate("chm_at_secret");
    expect(await denialOf(() => service.callTool(actor, "support.tickets.list", {}))).toBe("PERMISSION_DENIED");
    // And the same narrowing shows in the listing, so the two never disagree.
    expect(service.listTools(actor).map((tool) => tool.name)).not.toContain("support.tickets.list");
  });
});

describe("the scopes a token carries against the permissions behind it", () => {
  it("refuses on scope before it refuses on permission", async () => {
    // `MCP_SCOPE_INSUFFICIENT` is actionable -- a client can ask for the scope -- and
    // `PERMISSION_DENIED` is not. Answering the second when the first applies sends somebody to
    // an administrator for a problem their own client could fix.
    const narrow: McpScope[] = ["mcp:tools.list"];
    const { service } = build({ token: { ...resolution, scopes: narrow } });
    const actor = await service.authenticate("chm_at_secret");
    expect(await denialOf(() => service.callTool(actor, "crm.customers.list", {}))).toBe("MCP_SCOPE_INSUFFICIENT");
  });
});

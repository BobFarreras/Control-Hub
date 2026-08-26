import { McpOauthError, type McpOauthService } from "@control-hub/application";
import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import type { ControlHubAuth } from "../auth.js";
import { describeConnectorError, problemContentType, problemDetails } from "../problem.js";
import type { ControlHubApp } from "../server-instance.js";
import { mcpConsentResponse, registerMcpConsentRoutes } from "./mcp-consent.js";

const tenantId = "11111111-1111-4111-8111-111111111111";
const audience = "https://hub.test/mcp";
const redirectUri = "http://127.0.0.1:51763/callback";

/**
 * What the service says the request really is.
 *
 * Deliberately unlike the query strings below: the client is submitted asking for `crm.write`, and
 * this is what a re-read turns that into. Every assertion about what the screen is told is
 * therefore an assertion that the answer came from here and not from the request.
 */
const description = {
  clientId: "client-1",
  clientName: "Claude Desktop",
  clientKind: "public" as const,
  redirectUri,
  scopes: ["mcp:tools.list", "crm.read"] as const,
  audience,
  grantExpiresAt: new Date("2026-11-23T10:00:00.000Z"),
  unclaimed: false
};

type Audit = { action: unknown; targetType: unknown; targetId: unknown; outcome: unknown; metadata: unknown };

/** The same stand-in the management suite uses: it answers a membership and records audit rows. */
const databaseFor = (audits: Audit[]) => {
  const query = vi
    .fn()
    .mockResolvedValue([
      { tenant_id: tenantId, membership_id: "membership-1", role: "owner", permission: "leads:read" }
    ]);
  const transaction = Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) => {
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

/** A session established `minutesAgo`, which is the only thing the freshness rule looks at. */
const authFor = (minutesAgo: number) =>
  ({
    api: {
      getSession: () =>
        Promise.resolve({
          user: { id: "user-1", twoFactorEnabled: true },
          session: { createdAt: new Date(Date.now() - minutesAgo * 60 * 1000) }
        })
    }
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
    describeAuthorization: record("describeAuthorization", overrides.describeAuthorization ?? description),
    approveAuthorization: record("approveAuthorization", overrides.approveAuthorization ?? { code: "chm_ac_secret" })
  } as unknown as McpOauthService;
};

const boot = async (options: { minutesAgo?: number; service?: ServiceOverrides } = {}) => {
  const audits: Audit[] = [];
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const app = Fastify();
  app.setErrorHandler((error, request, reply) => {
    const described = describeConnectorError(error) ?? { status: 500, code: "INTERNAL_ERROR" };
    return reply
      .code(described.status)
      .type(problemContentType)
      .send(problemDetails({ ...described, instance: request.url, requestId: request.id }));
  });
  registerMcpConsentRoutes({
    app: app as unknown as ControlHubApp,
    database: databaseFor(audits),
    auth: authFor(options.minutesAgo ?? 1),
    mcp: serviceStub(options.service ?? {}, calls)
  });
  await app.ready();
  return { app, audits, calls };
};

/** What the authorization endpoint hands the screen, as the screen hands it back. */
const asked = (overrides: Record<string, string> = {}) => ({
  client_id: "client-1",
  redirect_uri: redirectUri,
  scope: "crm.write",
  state: "s-1",
  code_challenge: "a".repeat(43),
  code_challenge_method: "S256",
  resource: audience,
  ...overrides
});

const get = (query: Record<string, string>) => ({
  method: "GET" as const,
  url: `/api/v1/mcp/consent?${new URLSearchParams(query).toString()}`
});

const post = (body: Record<string, string>) => ({
  method: "POST" as const,
  url: "/api/v1/mcp/consent",
  payload: body
});

describe("what the consent screen is told", () => {
  it("names every field the screen renders, and no code among them", () => {
    expect(Object.keys(mcpConsentResponse(description)).sort()).toEqual(
      [
        "clientId",
        "clientName",
        "clientKind",
        "redirectUri",
        "scopes",
        "resource",
        "grantExpiresAt",
        "unclaimed"
      ].sort()
    );
  });

  it("tells the screen when the client registered itself and nobody has claimed it", async () => {
    // The screen warns on this, and it can only come from the store: a client that introduced
    // itself a moment ago looks exactly like one an administrator set up, in the request.
    const { app } = await boot({ service: { describeAuthorization: { ...description, unclaimed: true } } });
    expect((await app.inject(get(asked()))).json<{ unclaimed: boolean }>().unclaimed).toBe(true);
  });

  it("answers with what the service resolved, not with what the request said", async () => {
    // The request asks for `crm.write` and nothing else. A screen that rendered that would let a
    // client compose a URL which describes itself generously.
    const { app } = await boot();
    const response = await app.inject(get(asked()));

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      clientName: "Claude Desktop",
      scopes: ["mcp:tools.list", "crm.read"],
      redirectUri
    });
  });

  it("reads an absent scope as a request for nothing in particular", async () => {
    // RFC 6749 section 3.3 again. Splitting an empty string naively yields a list holding one
    // empty name, which the service would refuse as a scope nobody offers -- and the person would
    // see a failure where the client made a legal request.
    const { app, calls } = await boot();
    await app.inject(get(asked({ scope: "" })));

    expect(calls[0]).toMatchObject({ method: "describeAuthorization" });
    expect((calls[0]!.args[1] as { scopes: string[] }).scopes).toEqual([]);
  });

  it("does not demand a recent sign-in merely to be told what is being asked", async () => {
    // Sending somebody to authenticate again before they know why would be a worse screen, not a
    // safer one. Nothing is granted by reading this.
    const { app } = await boot({ minutesAgo: 120 });
    expect((await app.inject(get(asked()))).statusCode).toBe(200);
  });

  it("passes a refusal through as problem details, as every other panel call does", async () => {
    const { app } = await boot({
      service: { describeAuthorization: new McpOauthError("MCP_CLIENT_UNKNOWN") }
    });
    const response = await app.inject(get(asked()));

    expect(response.statusCode).toBe(422);
    expect(response.headers["content-type"]).toContain(problemContentType);
    expect(response.json().code).toBe("MCP_CLIENT_UNKNOWN");
  });
});

describe("deciding an authorization", () => {
  it("hands back a code at the registered address when a person approves", async () => {
    const { app, calls } = await boot();
    const response = await app.inject(post({ ...asked(), decision: "approve" }));

    expect(response.statusCode).toBe(200);
    const target = new URL(response.json().redirectTo as string);
    expect(`${target.origin}${target.pathname}`).toBe(redirectUri);
    expect(target.searchParams.get("code")).toBe("chm_ac_secret");
    expect(target.searchParams.get("state")).toBe("s-1");
    expect(calls.map((call) => call.method)).toEqual(["describeAuthorization", "approveAuthorization"]);
  });

  it("builds the address from what the service matched, never from what was submitted", async () => {
    // The body names somewhere else entirely. If that reached the redirect, this endpoint would
    // hand an authorization code to whoever asked for one.
    const { app } = await boot();
    const response = await app.inject(
      post({ ...asked({ redirect_uri: "https://attacker.test/collect" }), decision: "approve" })
    );

    expect(new URL(response.json().redirectTo as string).origin).toBe(new URL(redirectUri).origin);
  });

  it("refuses to approve from a session established too long ago", async () => {
    // Ninety days of read access is not something an unattended laptop should be able to hand
    // over. The window is the one better-auth already uses for changing a password.
    const { app, calls, audits } = await boot({ minutesAgo: 120 });
    const response = await app.inject(post({ ...asked(), decision: "approve" }));

    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe("SESSION_NOT_FRESH");
    expect(calls).toHaveLength(0);
    expect(audits).toHaveLength(0);
  });

  it("lets somebody say no from the session they already have", async () => {
    // Demanding a fresh sign-in to refuse is how a refusal becomes an abandoned tab.
    const { app } = await boot({ minutesAgo: 120 });
    const response = await app.inject(post({ ...asked(), decision: "deny" }));

    expect(response.statusCode).toBe(200);
    const target = new URL(response.json().redirectTo as string);
    expect(target.searchParams.get("error")).toBe("access_denied");
    expect(target.searchParams.has("code")).toBe(false);
    expect(target.searchParams.get("state")).toBe("s-1");
  });

  it("treats anything that is not an approval as a refusal", async () => {
    // A body that arrived without the field, or with a value nobody expected, must not mint a
    // code. The default has to be the harmless one.
    for (const decision of ["", "APPROVE", "maybe"]) {
      const { app, calls } = await boot();
      const response = await app.inject(post({ ...asked(), decision }));

      expect(new URL(response.json().redirectTo as string).searchParams.get("error"), decision).toBe("access_denied");
      expect(
        calls.map((call) => call.method),
        decision
      ).toEqual(["describeAuthorization"]);
    }
  });

  it("validates before refusing too, so no outcome reaches an unchecked address", async () => {
    const { app } = await boot({
      service: { describeAuthorization: new McpOauthError("MCP_REDIRECT_URI_MISMATCH") }
    });
    const response = await app.inject(post({ ...asked(), decision: "deny" }));

    expect(response.statusCode).toBe(422);
    expect(response.json()).not.toHaveProperty("redirectTo");
  });

  it("omits the state when the request carried none", async () => {
    const { app } = await boot();
    const body = asked();
    delete (body as { state?: string }).state;
    const response = await app.inject(post({ ...body, decision: "approve" }));

    expect(new URL(response.json().redirectTo as string).searchParams.has("state")).toBe(false);
  });
});

describe("what the decision leaves behind", () => {
  it("records an approval with the substance of what was agreed", async () => {
    // "Approved Claude Desktop" answers nothing six weeks later. The scopes are the decision.
    const { app, audits } = await boot();
    await app.inject(post({ ...asked(), decision: "approve" }));

    expect(audits).toEqual([
      {
        action: "mcp.consent.approved",
        targetType: "mcp_client",
        targetId: "client-1",
        outcome: "success",
        metadata: { clientName: "Claude Desktop", scopes: "mcp:tools.list crm.read", selfRegistered: "false" }
      }
    ]);
  });

  it("records a refusal as one, because a consent nobody gave is worth knowing about", async () => {
    const { app, audits } = await boot();
    await app.inject(post({ ...asked(), decision: "deny" }));

    expect(audits[0]).toMatchObject({ action: "mcp.consent.denied", outcome: "denied" });
  });

  it("records that the approval was what let a self-registered client in", async () => {
    // The registration itself cannot be audited -- it happens with nobody signed in, and an audit
    // row belongs to a tenant. This is the only place the fact can be written down.
    const { app, audits } = await boot({ service: { describeAuthorization: { ...description, unclaimed: true } } });
    await app.inject(post({ ...asked(), decision: "approve" }));

    expect(audits[0]).toMatchObject({
      action: "mcp.consent.approved",
      metadata: { clientName: "Claude Desktop", selfRegistered: "true" }
    });
  });

  it("says so when the client was one somebody registered by hand", async () => {
    const { app, audits } = await boot();
    await app.inject(post({ ...asked(), decision: "approve" }));

    expect(audits[0]).toMatchObject({ metadata: { selfRegistered: "false" } });
  });

  it("keeps the authorization code out of the trail entirely", async () => {
    // It is a credential for the next sixty seconds, and an audit row outlives it by years.
    const { app, audits } = await boot();
    await app.inject(post({ ...asked(), decision: "approve" }));

    expect(JSON.stringify(audits)).not.toContain("chm_ac_secret");
  });
});

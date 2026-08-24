import { describe, expect, it } from "vitest";
import { ConnectorError, type ConnectorContext, type HttpRequest } from "../contract.js";
import { supabase } from "./supabase.js";

/**
 * The contract tests for the Supabase connector.
 *
 * The fixtures are written from the documented shape of the Management API rather than captured
 * from a live account: no test in this suite touches the network. That is a real limit and worth
 * naming -- what these prove is that the connector honours the contract, projects only the fields
 * it named, and never sends anything but `GET`, not that a particular day's API sends exactly
 * these bytes.
 */

const token = "sbp_SUPERSECRETMANAGEMENTTOKEN";

type Reply = { status?: number; body?: unknown };

function contextWith(config: unknown, replies: Reply[] = []) {
  const requests: HttpRequest[] = [];
  let index = 0;

  const context: ConnectorContext<unknown> = {
    instanceId: "instance-1",
    config,
    http: {
      send: (request) => {
        requests.push(request);
        const reply = replies[Math.min(index, replies.length - 1)] ?? {};
        index += 1;
        return Promise.resolve({
          status: reply.status ?? 200,
          headers: {},
          body: typeof reply.body === "string" ? reply.body : JSON.stringify(reply.body ?? [])
        });
      }
    },
    secrets: { open: () => Promise.resolve(token) },
    logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
    clock: { now: () => new Date("2026-08-24T12:00:00.000Z") }
  };
  return { context, requests };
}

const project = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  name: `client-${id}`,
  region: "eu-west-1",
  status: "ACTIVE_HEALTHY",
  created_at: "2026-01-02T00:00:00.000Z",
  ...overrides
});

describe("configuration", () => {
  it("needs nothing at all, because the only address there is is already known", () => {
    expect(supabase.parseConfig({})).toEqual({
      ok: true,
      config: { baseUrl: "https://api.supabase.com" }
    });
  });

  it("refuses any base but the real one, which is the whole point of pinning it", () => {
    // Each of these would hand the account's full-privilege token to somebody else's host.
    expect(supabase.parseConfig({ baseUrl: "https://api.supabase.com.attacker.test" }).ok).toBe(false);
    expect(supabase.parseConfig({ baseUrl: "http://api.supabase.com" }).ok).toBe(false);
    expect(supabase.parseConfig({ baseUrl: "https://api.supabase.com/" }).ok).toBe(false);
    expect(supabase.parseConfig({ baseUrl: "https://api.supabase.com" }).ok).toBe(true);
  });

  it("refuses a key nobody allowlisted, rather than stripping it", () => {
    expect(supabase.parseConfig({ organizationId: "org_1" }).ok).toBe(false);
  });
});

describe("the manifest", () => {
  it("declares one state pass, with no equivalent to a Vercel deployment", () => {
    expect(supabase.capabilities.operations).toEqual({
      pull_supabase_projects: { shape: "state", everySeconds: 300 }
    });
  });

  it("goes to its own configured base over TLS, and nowhere else", () => {
    expect(supabase.capabilities.egress).toEqual({ schemes: ["https"], destination: "configured_base_url" });
  });

  it("takes no webhook and declares no action, because the token cannot be trusted with one", () => {
    expect(supabase.capabilities.ingress).toBe(false);
    expect(supabase.ingressSignature).toBeNull();
  });

  it("refuses an operation that is not in the manifest", async () => {
    const { context } = contextWith({});
    await expect(supabase.run("pause_project", context, { cursor: null })).rejects.toThrow(ConnectorError);
  });
});

describe("health", () => {
  it("passes when the account answers", async () => {
    const { context } = contextWith({}, [{ status: 200, body: [] }]);
    expect(await supabase.health(context)).toEqual({ status: "ok" });
  });

  it("tells an invalid token apart from one that reaches nothing", async () => {
    const unauthorized = contextWith({}, [{ status: 401 }]);
    expect(await supabase.health(unauthorized.context)).toEqual({ status: "failed", failure: "unauthorized" });

    const forbidden = contextWith({}, [{ status: 403 }]);
    expect(await supabase.health(forbidden.context)).toEqual({ status: "failed", failure: "forbidden" });
  });
});

describe("pulling projects", () => {
  it("keeps the fields we chose and drops everything else the account sent", async () => {
    const noise = {
      database: { host: "db.abcdefgh.supabase.co", version: "15.1", postgres_engine: "15" },
      organization_id: "org_1",
      organization_slug: "arrel-estudi"
    };
    const { context } = contextWith({}, [{ body: [project("abcdefgh", noise)] }]);

    const result = await supabase.run("pull_supabase_projects", context, { cursor: null });

    expect(result.records).toEqual([
      {
        externalId: "project:abcdefgh",
        data: {
          name: "client-abcdefgh",
          region: "eu-west-1",
          status: "ACTIVE_HEALTHY",
          healthy: true,
          createdAt: "2026-01-02T00:00:00.000Z"
        }
      }
    ]);
    // The point of the projection: the connection host never reaches a stored record.
    expect(JSON.stringify(result.records)).not.toContain("db.abcdefgh.supabase.co");
    expect(JSON.stringify(result.records)).not.toContain("org_1");
  });

  it("reads a paused or broken project as unhealthy", () => {
    const cases: Array<[string, boolean]> = [
      ["INACTIVE", false],
      ["ACTIVE_UNHEALTHY", false],
      ["INIT_FAILED", false],
      ["RESTORE_FAILED", false],
      ["PAUSE_FAILED", false],
      ["REMOVED", false]
    ];
    return Promise.all(
      cases.map(async ([status, healthy]) => {
        const { context } = contextWith({}, [{ body: [project("prj", { status })] }]);
        const result = await supabase.run("pull_supabase_projects", context, { cursor: null });
        expect(result.records[0]?.data.healthy).toBe(healthy);
      })
    );
  });

  it("reads a project mid-transition as neither healthy nor unhealthy", () => {
    const transitional = ["COMING_UP", "GOING_DOWN", "RESTORING", "UPGRADING", "PAUSING", "RESTARTING", "RESIZING", "UNKNOWN"];
    return Promise.all(
      transitional.map(async (status) => {
        const { context } = contextWith({}, [{ body: [project("prj", { status })] }]);
        const result = await supabase.run("pull_supabase_projects", context, { cursor: null });
        // Not false: a project resizing has not gone down, and reporting it as an outage would
        // fire an alert every time somebody changed a plan.
        expect(result.records[0]?.data.healthy).toBeNull();
        expect(result.records[0]?.data.status).toBe(status);
      })
    );
  });

  it("says nothing rather than something false about a status it does not recognise", async () => {
    const { context } = contextWith({}, [{ body: [project("prj", { status: "SOME_FUTURE_STATE" })] }]);
    const result = await supabase.run("pull_supabase_projects", context, { cursor: null });
    expect(result.records[0]?.data.healthy).toBeNull();
  });

  it("reads every project in the one call the endpoint offers, and keeps no cursor", async () => {
    const { context, requests } = contextWith({}, [{ body: [project("a"), project("b"), project("c")] }]);

    const result = await supabase.run("pull_supabase_projects", context, { cursor: null });

    expect(result.records.map((record) => record.externalId)).toEqual(["project:a", "project:b", "project:c"]);
    expect(result.cursor).toBeNull();
    expect(requests).toHaveLength(1);
  });

  it("fails rather than silently trimming an account too large for the safety cap", async () => {
    const projects = Array.from({ length: 2001 }, (_, index) => project(`p${index}`));
    const { context } = contextWith({}, [{ body: projects }]);

    await expect(supabase.run("pull_supabase_projects", context, { cursor: null })).rejects.toThrow("INVALID_RESPONSE");
  });

  it("gives the same externalId for the same project, so a re-read updates rather than duplicates", async () => {
    const page = { body: [project("prj-1")] };
    const first = await supabase.run("pull_supabase_projects", contextWith({}, [page]).context, { cursor: null });
    const second = await supabase.run("pull_supabase_projects", contextWith({}, [page]).context, { cursor: null });
    expect(first.records[0]?.externalId).toBe(second.records[0]?.externalId);
  });
});

describe("the token", () => {
  it("is a header on every call there is, never a query string, and every call is a GET", async () => {
    const seen: HttpRequest[] = [];

    const health = contextWith({}, [{ body: [] }]);
    await supabase.health(health.context);
    seen.push(...health.requests);

    const projects = contextWith({}, [{ body: [project("prj-1")] }]);
    await supabase.run("pull_supabase_projects", projects.context, { cursor: null });
    seen.push(...projects.requests);

    expect(seen.length).toBeGreaterThanOrEqual(2);
    for (const request of seen) {
      expect(request.url).not.toContain(token);
      expect(request.url.startsWith("https://api.supabase.com/")).toBe(true);
      expect(request.headers?.authorization).toBe(`Bearer ${token}`);
      expect(request.body).toBeUndefined();
      // The token carries full account privilege; this is the only guard that matters at the
      // connector layer, since the token itself grants far more than a GET.
      expect(request.method).toBe("GET");
    }
  });

  it("does not read anything when the vault will not open", async () => {
    const { context } = contextWith({});
    const broken: ConnectorContext<unknown> = {
      ...context,
      secrets: { open: () => Promise.reject(new ConnectorError("SECRET_UNAVAILABLE")) }
    };

    await expect(supabase.run("pull_supabase_projects", broken, { cursor: null })).rejects.toThrow(ConnectorError);
  });
});

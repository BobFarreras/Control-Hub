import { describe, expect, it } from "vitest";
import { ConnectorError, type ConnectorContext, type HttpRequest } from "../contract.js";
import { vercel } from "./vercel.js";

/**
 * The contract tests for the Vercel connector.
 *
 * The fixtures are written from the documented shape of the REST API rather than captured from a
 * live account: no test in this suite touches the network. That is a real limit and worth naming
 * -- what these prove is that the connector honours the contract, filters what it said it would
 * filter and keeps its token, not that a particular day's API sends exactly these bytes.
 */

const token = "vercel_api_SUPERSECRETTOKENVALUE";
const now = new Date("2026-08-23T12:00:00.000Z");
const teamId = "team_arrel";
const valid = { teamId };

type Reply = { status?: number; body?: unknown };

function contextWith(config: unknown, replies: Reply[] = []) {
  const requests: HttpRequest[] = [];
  const warnings: { fields: Record<string, unknown>; message: string }[] = [];
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
          body: typeof reply.body === "string" ? reply.body : JSON.stringify(reply.body ?? { projects: [] })
        });
      }
    },
    secrets: { open: () => Promise.resolve(token) },
    logger: {
      info: () => undefined,
      warn: (fields, message) => warnings.push({ fields: { ...fields }, message }),
      error: () => undefined
    },
    clock: { now: () => now }
  };
  return { context, requests, warnings };
}

const project = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  name: `site-${id}`,
  framework: "nextjs",
  createdAt: Date.parse("2026-01-01T00:00:00.000Z"),
  targets: {
    production: {
      id: "dpl_ok",
      readyState: "READY",
      createdAt: Date.parse("2026-08-20T09:00:00.000Z"),
      alias: ["arrelestudi.com", "site.vercel.app"]
    }
  },
  ...overrides
});

const deployment = (uid: string, overrides: Record<string, unknown> = {}) => ({
  uid,
  name: "site-prj-1",
  projectId: "prj-1",
  state: "ERROR",
  target: "production",
  created: Date.parse("2026-08-23T10:00:00.000Z"),
  meta: { githubCommitRef: "main", githubCommitSha: "a1b2c3d4" },
  ...overrides
});

/**
 * Twenty pages, each pointing at another one and each cursor different from the last.
 *
 * The distinctness matters: a repeated cursor is its own failure in the connector, and a test
 * that fed the same one twice would pass while proving something else entirely.
 */
const endlessPages = (page: (index: number) => Record<string, unknown>): Reply[] =>
  Array.from({ length: 20 }, (_, index) => ({
    body: { ...page(index), pagination: { next: 1_755_950_000_000 - index * 1_000 } }
  }));

describe("configuration", () => {
  it("needs nothing at all, because the only address there is is already known", () => {
    expect(vercel.parseConfig({})).toEqual({
      ok: true,
      config: {
        baseUrl: "https://api.vercel.com",
        tokenType: false,
        includePreview: false,
        deploymentsWindowHours: 24
      }
    });
  });

  it("refuses any base but the real one, which is the whole point of pinning it", () => {
    // Each of these would hand the account's token to somebody else's host on the first pass.
    expect(vercel.parseConfig({ baseUrl: "https://api.vercel.com.attacker.test" }).ok).toBe(false);
    expect(vercel.parseConfig({ baseUrl: "http://api.vercel.com" }).ok).toBe(false);
    expect(vercel.parseConfig({ baseUrl: "https://api.vercel.com/" }).ok).toBe(false);
    expect(vercel.parseConfig({ baseUrl: "https://api.vercel.com" }).ok).toBe(true);
  });

  it("refuses a key nobody allowlisted, rather than stripping it", () => {
    expect(vercel.parseConfig({ teamId, apiToken: token }).ok).toBe(false);
  });

  it("holds the deployments window inside a week", () => {
    expect(vercel.parseConfig({ deploymentsWindowHours: 0 }).ok).toBe(false);
    expect(vercel.parseConfig({ deploymentsWindowHours: 169 }).ok).toBe(false);
    expect(vercel.parseConfig({ deploymentsWindowHours: 168 }).ok).toBe(true);
  });

  it("reports the path and the code of a bad field, and never the value", () => {
    const result = vercel.parseConfig({ teamId: token, deploymentsWindowHours: 999 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(JSON.stringify(result.issues)).not.toContain(token);
    expect(result.issues.map((issue) => issue.path)).toContain("deploymentsWindowHours");
  });

  it("asks for the team as a connection field, since a team token answers with silence without it", () => {
    const fields = vercel.configFields.map((field) => ({ name: field.name, group: field.group }));
    expect(fields).toContainEqual({ name: "teamId", group: "connection" });
  });
});

describe("the manifest", () => {
  it("declares a state pass and an event pass, with the cadence the specification agreed", () => {
    expect(vercel.capabilities.operations).toEqual({
      pull_projects: { shape: "state", everySeconds: 300 },
      pull_deployments: { shape: "event", everySeconds: 300 }
    });
  });

  it("goes to its own configured base over TLS, and nowhere else", () => {
    expect(vercel.capabilities.egress).toEqual({ schemes: ["https"], destination: "configured_base_url" });
  });

  it("takes no webhook, because there is nowhere to draw one yet", () => {
    expect(vercel.capabilities.ingress).toBe(false);
    expect(vercel.ingressSignature).toBeNull();
  });

  it("refuses an operation that is not in the manifest", async () => {
    const { context } = contextWith(valid);
    await expect(vercel.run("delete_project", context, { cursor: null })).rejects.toThrow(ConnectorError);
  });
});

describe("health", () => {
  it("asks something that needs both the token and the team", async () => {
    const { context, requests } = contextWith(valid, [{ status: 403 }]);

    // `403` and not `unauthorized`: the token is real, it just does not reach this team, and that
    // is a different thing to go and fix.
    expect(await vercel.health(context)).toEqual({ status: "failed", failure: "forbidden" });
    expect(requests[0]?.url).toBe("https://api.vercel.com/v9/projects?limit=1&teamId=team_arrel");
    expect(requests[0]?.headers?.authorization).toBe(`Bearer ${token}`);
  });

  it("passes when the account answers", async () => {
    const { context } = contextWith(valid, [{ status: 200, body: { projects: [] } }]);
    expect(await vercel.health(context)).toEqual({ status: "ok" });
  });

  it("leaves the team out of the call when the account is personal", async () => {
    const { context, requests } = contextWith({}, [{ status: 200, body: { projects: [] } }]);
    await vercel.health(context);
    expect(requests[0]?.url).toBe("https://api.vercel.com/v9/projects?limit=1");
  });
});

describe("pulling projects", () => {
  it("keeps the fields we chose and drops everything else the account sent", async () => {
    const noise = {
      env: [{ key: "DATABASE_URL", value: "postgres://user:CUSTOMER-SECRET@db/app" }],
      link: { repo: "arrel-estudi", org: "BobFarreras" },
      latestDeployments: [{ creator: { username: "someone", email: "someone@example.com" } }]
    };
    const { context } = contextWith(valid, [{ body: { projects: [project("prj-1", noise)] } }]);

    const result = await vercel.run("pull_projects", context, { cursor: null });

    expect(result.records).toEqual([
      {
        externalId: "project:prj-1",
        data: {
          name: "site-prj-1",
          framework: "nextjs",
          productionReady: true,
          productionState: "READY",
          productionDeployedAt: "2026-08-20T09:00:00.000Z",
          productionAlias: "arrelestudi.com",
          createdAt: "2026-01-01T00:00:00.000Z"
        }
      }
    ]);
    // The point of the projection: an environment variable pasted into a project never reaches us.
    expect(JSON.stringify(result.records)).not.toContain("CUSTOMER-SECRET");
    expect(JSON.stringify(result.records)).not.toContain("someone@example.com");
  });

  it("says nothing rather than something false about a production nobody has shipped", async () => {
    const { context } = contextWith(valid, [{ body: { projects: [project("prj-1", { targets: {} })] } }]);

    const [record] = (await vercel.run("pull_projects", context, { cursor: null })).records;

    // Null and not false: the alert engine reacts to `false`, and a project never deployed is not
    // an outage.
    expect(record?.data.productionReady).toBeNull();
    expect(record?.data.productionState).toBeNull();
    expect(record?.data.productionAlias).toBeNull();
  });

  it("reads a broken production as down and a build under way as neither", async () => {
    const withState = (readyState: string) =>
      contextWith(valid, [{ body: { projects: [project("prj-1", { targets: { production: { readyState } } })] } }]);

    const failed = await vercel.run("pull_projects", withState("ERROR").context, { cursor: null });
    expect(failed.records[0]?.data.productionReady).toBe(false);

    // A deploy in flight is not an outage: what is being served is still the one before it, and
    // reporting otherwise would fire an alert every time somebody pushed.
    const building = await vercel.run("pull_projects", withState("BUILDING").context, { cursor: null });
    expect(building.records[0]?.data.productionReady).toBeNull();
    expect(building.records[0]?.data.productionState).toBe("BUILDING");
  });

  it("walks every page, because a partial inventory would expire the projects it missed", async () => {
    const { context, requests } = contextWith(valid, [
      { body: { projects: [project("prj-1")], pagination: { next: 1755950000000 } } },
      { body: { projects: [project("prj-2")], pagination: { next: null } } }
    ]);

    const result = await vercel.run("pull_projects", context, { cursor: null });

    expect(result.records.map((record) => record.externalId)).toEqual(["project:prj-1", "project:prj-2"]);
    expect(requests[1]?.url).toContain("until=1755950000000");
    // No cursor kept: the next pass starts from the top, which is how a deleted project leaves.
    expect(result.cursor).toBeNull();
  });

  it("fails rather than truncating, because a short state pass expires the rest", async () => {
    // Twenty pages that each promise another one. The cursor moves every time, so this is the
    // page limit talking and not the loop guard below it.
    const { context } = contextWith(
      valid,
      endlessPages((index) => ({ projects: [project(`prj-${index}`)] }))
    );

    await expect(vercel.run("pull_projects", context, { cursor: null })).rejects.toThrow("TOO_MANY_PAGES");
  });

  it("refuses a cursor that does not move, instead of asking for it forever", async () => {
    const page = { body: { projects: [project("prj-1")], pagination: { next: 1755950000000 } } };
    const { context, requests } = contextWith(valid, [page, page]);

    await expect(vercel.run("pull_projects", context, { cursor: null })).rejects.toThrow("INVALID_RESPONSE");
    expect(requests).toHaveLength(2);
  });
});

describe("pulling failed deployments", () => {
  it("asks only for what it wants: failures, production, and inside the window", async () => {
    const { context, requests } = contextWith(valid, [{ body: { deployments: [] } }]);

    await vercel.run("pull_deployments", context, { cursor: null });

    const url = requests[0]?.url ?? "";
    expect(url).toContain("state=ERROR");
    expect(url).toContain("target=production");
    expect(url).toContain(`since=${now.getTime() - 24 * 60 * 60 * 1000}`);
  });

  it("keeps the build and the branch, and neither the person nor what they wrote", async () => {
    const meta = {
      githubCommitRef: "main",
      githubCommitSha: "a1b2c3d4",
      githubCommitMessage: "fix: hardcode the ADMIN-PASSWORD until monday",
      githubCommitAuthorName: "Somebody Real"
    };
    const creator = { uid: "u1", username: "somebody", email: "somebody@example.com" };
    const { context } = contextWith(valid, [{ body: { deployments: [deployment("dpl-1", { meta, creator })] } }]);

    const result = await vercel.run("pull_deployments", context, { cursor: null });

    expect(result.records).toEqual([
      {
        externalId: "deployment:dpl-1",
        data: {
          projectId: "prj-1",
          project: "site-prj-1",
          state: "ERROR",
          target: "production",
          createdAt: "2026-08-23T10:00:00.000Z",
          commitRef: "main",
          commitSha: "a1b2c3d4"
        }
      }
    ]);
    expect(JSON.stringify(result.records)).not.toContain("ADMIN-PASSWORD");
    expect(JSON.stringify(result.records)).not.toContain("somebody@example.com");
  });

  it("drops a preview and a healthy build even when the provider sends them anyway", async () => {
    const { context } = contextWith(valid, [
      {
        body: {
          deployments: [
            deployment("dpl-1"),
            deployment("dpl-preview", { target: "preview" }),
            deployment("dpl-null-target", { target: null }),
            deployment("dpl-ready", { state: "READY" })
          ]
        }
      }
    ]);

    const result = await vercel.run("pull_deployments", context, { cursor: null });

    expect(result.records.map((record) => record.externalId)).toEqual(["deployment:dpl-1"]);
  });

  it("takes previews in when the instance asked for them", async () => {
    const { context, requests } = contextWith({ ...valid, includePreview: true }, [
      { body: { deployments: [deployment("dpl-1"), deployment("dpl-preview", { target: "preview" })] } }
    ]);

    const result = await vercel.run("pull_deployments", context, { cursor: null });

    expect(result.records).toHaveLength(2);
    expect(requests[0]?.url).not.toContain("target=");
  });

  it("keeps no watermark, because Vercel orders by when a build started and not by when it ended", async () => {
    const { context } = contextWith(valid, [{ body: { deployments: [deployment("dpl-1")] } }]);

    const result = await vercel.run("pull_deployments", context, { cursor: null });

    // A watermark moved past 10:00 would never read the build that started at 10:00 and failed at
    // 10:07. The window is read again instead, and the same externalId makes that an upsert.
    expect(result.cursor).toBeNull();
  });

  it("stops at the page limit with a warning rather than failing, because next pass reads it", async () => {
    const { context, warnings } = contextWith(
      valid,
      endlessPages((index) => ({ deployments: [deployment(`dpl-${index}`)] }))
    );

    const result = await vercel.run("pull_deployments", context, { cursor: null });

    expect(result.records).toHaveLength(20);
    expect(warnings).toHaveLength(1);
    expect(JSON.stringify(warnings)).not.toContain(token);
  });

  it("gives the same externalId for the same deployment, so a re-read updates rather than duplicates", async () => {
    const page = { body: { deployments: [deployment("dpl-1")] } };
    const first = await vercel.run("pull_deployments", contextWith(valid, [page]).context, { cursor: null });
    const second = await vercel.run("pull_deployments", contextWith(valid, [page]).context, { cursor: null });
    expect(first.records[0]?.externalId).toBe(second.records[0]?.externalId);
  });
});

describe("the token", () => {
  it("is a header on every call there is, and never anything else", async () => {
    const seen: HttpRequest[] = [];

    const health = contextWith(valid, [{ body: { projects: [] } }]);
    await vercel.health(health.context);
    seen.push(...health.requests);

    const projects = contextWith(valid, [{ body: { projects: [project("prj-1")] } }]);
    await vercel.run("pull_projects", projects.context, { cursor: null });
    seen.push(...projects.requests);

    const deployments = contextWith(valid, [{ body: { deployments: [deployment("dpl-1")] } }]);
    await vercel.run("pull_deployments", deployments.context, { cursor: null });
    seen.push(...deployments.requests);

    expect(seen.length).toBeGreaterThanOrEqual(3);
    for (const request of seen) {
      expect(request.url).not.toContain(token);
      expect(request.url.startsWith("https://api.vercel.com/")).toBe(true);
      expect(request.headers?.authorization).toBe(`Bearer ${token}`);
      expect(request.body).toBeUndefined();
      expect(request.method).toBe("GET");
    }
  });

  it("does not read anything when the vault will not open", async () => {
    const { context } = contextWith(valid);
    const broken: ConnectorContext<unknown> = {
      ...context,
      secrets: { open: () => Promise.reject(new ConnectorError("SECRET_UNAVAILABLE")) }
    };

    await expect(vercel.run("pull_projects", broken, { cursor: null })).rejects.toThrow(ConnectorError);
  });
});

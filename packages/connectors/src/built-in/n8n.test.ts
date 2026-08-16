import { describe, expect, it } from "vitest";
import { ConnectorError, type ConnectorContext, type HttpRequest, type IngressRequest } from "../contract.js";
import { n8n } from "./n8n.js";

/**
 * The contract tests for the n8n connector.
 *
 * The fixtures are written from the documented shape of the public API v1 rather than captured
 * from a live instance: production access is out of scope for this phase. That is a real limit
 * and it is worth naming -- what these prove is that the connector honours the contract and
 * keeps its secrets, not that a particular n8n build sends exactly these bytes. The day the VPS
 * version is known, the fixtures get pinned to it and this comment goes away.
 */

const token = "n8n_api_SUPERSECRETTOKENVALUE";
const now = new Date("2026-08-12T12:00:00.000Z");
const baseUrl = "https://n8n.example.com";

type Reply = { status?: number; body?: unknown };

function contextWith(config: unknown, replies: Reply[] = [], options: { secret?: () => Promise<string> } = {}) {
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
          body: typeof reply.body === "string" ? reply.body : JSON.stringify(reply.body ?? { data: [] })
        });
      }
    },
    secrets: { open: options.secret ?? (() => Promise.resolve(token)) },
    logger: {
      info: () => undefined,
      warn: (fields, message) => warnings.push({ fields: { ...fields }, message }),
      error: () => undefined
    },
    clock: { now: () => now }
  };
  return { context, requests, warnings };
}

const workflow = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  name: `Workflow ${id}`,
  active: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
  tags: [{ id: "t1", name: "billing" }],
  ...overrides
});

const execution = (id: number, overrides: Record<string, unknown> = {}) => ({
  id,
  workflowId: "wf-1",
  status: "error",
  mode: "trigger",
  startedAt: "2026-08-12T11:00:00.000Z",
  stoppedAt: "2026-08-12T11:00:04.000Z",
  ...overrides
});

const valid = { baseUrl };

describe("configuration", () => {
  it("takes a base and fills in the rest", () => {
    const result = n8n.parseConfig(valid);
    expect(result).toEqual({ ok: true, config: { baseUrl, includeArchived: false, executionsWindowHours: 24 } });
  });

  it("allows plain http, because a self-hosted n8n on the operator's own host has no TLS", () => {
    expect(n8n.parseConfig({ baseUrl: "http://n8n.internal:5678" }).ok).toBe(true);
  });

  it("refuses a scheme that is not http, and a base carrying credentials", () => {
    expect(n8n.parseConfig({ baseUrl: "file:///etc/passwd" }).ok).toBe(false);
    expect(n8n.parseConfig({ baseUrl: "ftp://n8n.example.com" }).ok).toBe(false);
    // A password in the base would be a second way to authenticate that the vault never sealed.
    expect(n8n.parseConfig({ baseUrl: "https://user:pass@n8n.example.com" }).ok).toBe(false);
  });

  it("refuses a key nobody allowlisted, rather than stripping it", () => {
    expect(n8n.parseConfig({ baseUrl, apiKey: token }).ok).toBe(false);
  });

  it("holds the executions window inside a week", () => {
    expect(n8n.parseConfig({ baseUrl, executionsWindowHours: 0 }).ok).toBe(false);
    expect(n8n.parseConfig({ baseUrl, executionsWindowHours: 169 }).ok).toBe(false);
    expect(n8n.parseConfig({ baseUrl, executionsWindowHours: 168 }).ok).toBe(true);
  });

  it("reports the path and the code of a bad field, and never the value", () => {
    const result = n8n.parseConfig({ baseUrl: `https://n8n.example.com/?token=${token}`, executionsWindowHours: 999 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(JSON.stringify(result.issues)).not.toContain(token);
    expect(result.issues.map((issue) => issue.path)).toContain("executionsWindowHours");
  });
});

describe("the manifest", () => {
  it("declares both polls with the cadence the specification agreed", () => {
    expect(n8n.capabilities.operations).toEqual({
      pull_workflows: { shape: "state", everySeconds: 900 },
      pull_executions: { shape: "event", everySeconds: 300 }
    });
  });

  it("goes out by the operator allowlist, not by whatever the tenant typed", () => {
    expect(n8n.capabilities.egress).toEqual({ schemes: ["http", "https"], destination: "operator_allowlist" });
  });

  it("refuses an operation that is not in the manifest even though the code exists", async () => {
    const { context } = contextWith(valid);
    await expect(n8n.run("delete_workflow", context, { cursor: null })).rejects.toThrow(ConnectorError);
  });
});

describe("health", () => {
  it("asks something that needs the token, so a wrong key reads as unauthorized", async () => {
    const { context, requests } = contextWith(valid, [{ status: 401 }]);
    expect(await n8n.health(context)).toEqual({ status: "failed", failure: "unauthorized" });
    expect(requests[0]?.url).toBe("https://n8n.example.com/api/v1/workflows?limit=1");
    expect(requests[0]?.headers?.["X-N8N-API-KEY"]).toBe(token);
  });

  it("passes when the instance answers", async () => {
    const { context } = contextWith(valid, [{ status: 200, body: { data: [] } }]);
    expect(await n8n.health(context)).toEqual({ status: "ok" });
  });
});

describe("pulling workflows", () => {
  it("keeps the fields we chose and drops everything else the instance sent", async () => {
    const nodes = [
      { parameters: { headerAuth: "Bearer sk-live-CUSTOMER-SECRET" }, type: "n8n-nodes-base.httpRequest" }
    ];
    const { context } = contextWith(valid, [{ body: { data: [workflow("wf-1", { nodes, pinData: { a: 1 } })] } }]);

    const result = await n8n.run("pull_workflows", context, { cursor: null });

    expect(result.records).toEqual([
      {
        externalId: "workflow:wf-1",
        data: {
          name: "Workflow wf-1",
          active: true,
          archived: false,
          tags: ["billing"],
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-08-01T00:00:00.000Z"
        }
      }
    ]);
    // The point of the projection: a credential pasted into a node parameter never reaches us.
    expect(JSON.stringify(result.records)).not.toContain("CUSTOMER-SECRET");
    expect(JSON.stringify(result.records)).not.toContain("pinData");
  });

  it("walks every page, because a partial inventory would expire the workflows it missed", async () => {
    const { context, requests } = contextWith(valid, [
      { body: { data: [workflow("wf-1")], nextCursor: "page-2" } },
      { body: { data: [workflow("wf-2")], nextCursor: null } }
    ]);

    const result = await n8n.run("pull_workflows", context, { cursor: null });

    expect(result.records.map((record) => record.externalId)).toEqual(["workflow:wf-1", "workflow:wf-2"]);
    expect(requests[1]?.url).toContain("cursor=page-2");
    // No cursor kept: the next pass starts from the top, which is how a deleted workflow leaves.
    expect(result.cursor).toBeNull();
  });

  it("leaves archived workflows out unless the instance asked for them", async () => {
    const page = { body: { data: [workflow("wf-1"), workflow("wf-2", { isArchived: true })] } };

    const { context } = contextWith(valid, [page]);
    const withoutArchived = await n8n.run("pull_workflows", context, { cursor: null });
    expect(withoutArchived.records.map((record) => record.externalId)).toEqual(["workflow:wf-1"]);

    const including = contextWith({ ...valid, includeArchived: true }, [page]);
    const withArchived = await n8n.run("pull_workflows", including.context, { cursor: null });
    expect(withArchived.records).toHaveLength(2);
    expect(withArchived.records[1]?.data.archived).toBe(true);
  });

  it("gives the same externalId for the same workflow, so a retry updates rather than duplicates", async () => {
    const page = { body: { data: [workflow("wf-1", { active: false })] } };
    const first = await n8n.run("pull_workflows", contextWith(valid, [page]).context, { cursor: null });
    const second = await n8n.run("pull_workflows", contextWith(valid, [page]).context, { cursor: null });
    expect(first.records[0]?.externalId).toBe(second.records[0]?.externalId);
  });
});

describe("pulling failed executions", () => {
  it("asks only for failures, and without the data that flowed through them", async () => {
    const { context, requests } = contextWith(valid, [{ body: { data: [] } }]);
    await n8n.run("pull_executions", context, { cursor: null });

    const url = new URL(requests[0]?.url ?? "");
    expect(url.pathname).toBe("/api/v1/executions");
    expect(url.searchParams.get("status")).toBe("error");
    expect(url.searchParams.get("includeData")).toBe("false");
  });

  it("stops at the first execution it already has, and remembers the newest", async () => {
    const { context } = contextWith(valid, [{ body: { data: [execution(42), execution(41), execution(40)] } }]);

    const result = await n8n.run("pull_executions", context, { cursor: JSON.stringify({ lastExecutionId: "41" }) });

    expect(result.records.map((record) => record.externalId)).toEqual(["execution:42"]);
    expect(result.cursor).toBe(JSON.stringify({ lastExecutionId: "42" }));
  });

  it("returns nothing at all when the newest failure is one it has already read", async () => {
    const { context } = contextWith(valid, [{ body: { data: [execution(42)] } }]);
    const cursor = JSON.stringify({ lastExecutionId: "42" });

    const result = await n8n.run("pull_executions", context, { cursor });

    expect(result.records).toEqual([]);
    expect(result.cursor).toBe(cursor);
  });

  it("bounds a first pass by the configured window instead of reading years of history", async () => {
    const { context } = contextWith({ ...valid, executionsWindowHours: 1 }, [
      {
        body: {
          data: [
            execution(9, { startedAt: "2026-08-12T11:30:00.000Z" }),
            execution(8, { startedAt: "2026-08-10T09:00:00.000Z" })
          ]
        }
      }
    ]);

    const result = await n8n.run("pull_executions", context, { cursor: null });

    expect(result.records.map((record) => record.externalId)).toEqual(["execution:9"]);
    expect(result.cursor).toBe(JSON.stringify({ lastExecutionId: "9" }));
  });

  it("falls back to the window when the stored cursor is from an older release", async () => {
    const { context } = contextWith(valid, [{ body: { data: [execution(7)] } }]);
    const result = await n8n.run("pull_executions", context, { cursor: "not-json-at-all" });
    expect(result.records).toHaveLength(1);
  });

  it("keeps the failure and not the payload that caused it", async () => {
    const { context } = contextWith(valid, [
      { body: { data: [execution(5, { data: { resultData: { customerIban: "ES91 2100 0418 45" } } })] } }
    ]);

    const result = await n8n.run("pull_executions", context, { cursor: null });

    expect(result.records[0]).toEqual({
      externalId: "execution:5",
      data: {
        workflowId: "wf-1",
        status: "error",
        mode: "trigger",
        startedAt: "2026-08-12T11:00:00.000Z",
        stoppedAt: "2026-08-12T11:00:04.000Z"
      }
    });
    expect(JSON.stringify(result.records)).not.toContain("2100 0418");
  });
});

describe("what the provider does to us", () => {
  it("maps a rate limit and a server error onto the codes the retry policy understands", async () => {
    const limited = contextWith(valid, [{ status: 429 }]);
    await expect(n8n.run("pull_workflows", limited.context, { cursor: null })).rejects.toMatchObject({
      code: "RATE_LIMITED"
    });

    const broken = contextWith(valid, [{ status: 503 }]);
    await expect(n8n.run("pull_workflows", broken.context, { cursor: null })).rejects.toMatchObject({
      code: "SERVER_ERROR"
    });
  });

  it("refuses a body that is not the shape it promised, without quoting it back", async () => {
    const html = contextWith(valid, [{ body: "<html>proxy error for user bob@example.com</html>" }]);
    const failure = await n8n.run("pull_workflows", html.context, { cursor: null }).catch((error: Error) => error);

    expect(failure).toBeInstanceOf(ConnectorError);
    expect((failure as Error).message).toBe("INVALID_RESPONSE");
    expect((failure as Error).message).not.toContain("bob@example.com");
  });

  it("gives up rather than reporting half an inventory when the instance never stops paging", async () => {
    const { context, requests } = contextWith(valid, [{ body: { data: [workflow("wf-1")], nextCursor: "more" } }]);
    await expect(n8n.run("pull_workflows", context, { cursor: null })).rejects.toMatchObject({
      code: "TOO_MANY_PAGES"
    });
    expect(requests.length).toBeLessThanOrEqual(20);
  });

  it("stops after the page budget on executions, and says so, because the next pass resumes", async () => {
    const { context, warnings } = contextWith(valid, [{ body: { data: [execution(1000)], nextCursor: "more" } }]);

    const result = await n8n.run("pull_executions", context, { cursor: JSON.stringify({ lastExecutionId: "1" }) });

    expect(result.records.length).toBeGreaterThan(0);
    expect(warnings[0]?.message).toContain("page limit");
    // The watermark only moved over rows actually returned, so nothing was skipped.
    expect(result.cursor).toBe(JSON.stringify({ lastExecutionId: "1000" }));
  });

  it("propagates a credential that cannot be opened instead of calling without one", async () => {
    const { context, requests } = contextWith(valid, [], {
      secret: () => Promise.reject(new ConnectorError("CREDENTIAL_MISSING"))
    });

    await expect(n8n.run("pull_workflows", context, { cursor: null })).rejects.toMatchObject({
      code: "CREDENTIAL_MISSING"
    });
    expect(requests).toHaveLength(0);
  });
});

describe("the token", () => {
  it("travels in a header and appears in no url, no record and no log", async () => {
    const { context, requests, warnings } = contextWith(valid, [
      { body: { data: [workflow("wf-1")] } },
      { body: { data: [execution(3)] } }
    ]);

    const workflows = await n8n.run("pull_workflows", context, { cursor: null });
    const executions = await n8n.run("pull_executions", context, { cursor: null });
    await n8n.health(context);

    expect(requests).not.toHaveLength(0);
    for (const request of requests) {
      expect(request.url).not.toContain(token);
      expect(request.headers?.["X-N8N-API-KEY"]).toBe(token);
    }
    expect(JSON.stringify([workflows, executions, warnings])).not.toContain(token);
  });
});

describe("the error workflow webhook", () => {
  const post = (body: unknown): IngressRequest => ({
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: {},
    receivedAt: now
  });

  const errorPayload = {
    execution: { id: 231, mode: "trigger", lastNodeExecuted: "Send invoice", url: `${baseUrl}/execution/231` },
    workflow: { id: "wf-1", name: "Invoicing" }
  };

  it("declares that the timestamp is signed with the body, so a capture cannot be replayed", () => {
    const signature = n8n.ingressSignature;
    expect(signature?.algorithm).toBe("hmac-sha256");
    expect(signature?.payload("1760000000", '{"a":1}')).toBe('1760000000.{"a":1}');
  });

  it("keys the event by the execution, so the webhook and the poll are the same failure", async () => {
    const { context } = contextWith(valid);
    const result = await n8n.ingest(context, post(errorPayload));

    expect(result).toEqual({
      eventId: "execution:231",
      accepted: true,
      summary: { workflowId: "wf-1", executionId: "231", lastNodeExecuted: "Send invoice", mode: "trigger" }
    });
  });

  it("reads the same event twice into the same id, which is what makes a replay harmless", async () => {
    const { context } = contextWith(valid);
    const first = await n8n.ingest(context, post(errorPayload));
    const second = await n8n.ingest(context, post(errorPayload));
    expect(first.eventId).toBe(second.eventId);
  });

  it("does not carry the error message, which is where n8n quotes the failed request", async () => {
    const { context } = contextWith(valid);
    const withError = {
      ...errorPayload,
      execution: {
        ...errorPayload.execution,
        error: { message: `401 from https://api.example.com?key=${token}`, stack: "at Object.<anonymous>" }
      }
    };

    const result = await n8n.ingest(context, post(withError));

    expect(JSON.stringify(result)).not.toContain(token);
    expect(JSON.stringify(result)).not.toContain("stack");
  });

  it("refuses a body that is not an error workflow payload", async () => {
    const { context } = contextWith(valid);
    await expect(n8n.ingest(context, post("not json"))).rejects.toMatchObject({ code: "INVALID_PAYLOAD" });
    await expect(n8n.ingest(context, post({ execution: { id: 1 } }))).rejects.toMatchObject({
      code: "INVALID_PAYLOAD"
    });
  });
});

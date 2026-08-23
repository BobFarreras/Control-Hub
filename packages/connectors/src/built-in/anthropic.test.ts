import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ConnectorContext, HttpResponse } from "../contract.js";
import { anthropic, anthropicUsageApiVersion, type AnthropicConfig } from "./anthropic.js";
const fixture = readFileSync(new URL("./fixtures/anthropic-usage-2023-06-01.json", import.meta.url), "utf8");
const reply = (body = fixture, status = 200): HttpResponse => ({ status, headers: {}, body });
function context(responses: HttpResponse[], config: Partial<AnthropicConfig> = {}) {
  const requests: { url: string; headers?: Readonly<Record<string, string>> }[] = [];
  const value: ConnectorContext<AnthropicConfig> = {
    instanceId: "instance",
    config: { baseUrl: "https://api.anthropic.com", lookbackDays: 2, workspaceIds: [], ...config },
    http: {
      send: (request) => {
        requests.push(request);
        return Promise.resolve(responses.shift() ?? reply());
      }
    },
    secrets: { open: () => Promise.resolve("anthropic-secret") },
    logger: { info() {}, warn() {}, error() {} },
    clock: { now: () => new Date("2026-08-23T12:00:00Z") }
  };
  return { value, requests };
}
describe("Anthropic usage connector", () => {
  it("declares the official version, configuration and event operation", () => {
    expect(anthropicUsageApiVersion).toBe("admin usage API 2023-06-01");
    expect(anthropic.parseConfig({}).ok).toBe(true);
    expect(anthropic.parseConfig({ baseUrl: "https://evil.test" }).ok).toBe(false);
    expect(anthropic.capabilities.operations.pull_usage).toEqual({ shape: "event", everySeconds: 3600 });
  });
  it("keeps differently-priced cache categories as reproducible events", async () => {
    const result = await anthropic.run("pull_usage", context([reply()]).value, { cursor: null });
    expect(result.records).toHaveLength(6);
    expect(result.records.map((row) => (row.data.usage as { sku: string }).sku)).toEqual([
      "claude-example-2026-01-01:input",
      "claude-example-2026-01-01:cache_write_5m",
      "claude-example-2026-01-01:cache_write_1h",
      "claude-example-2026-01-01:cache_read",
      "claude-example-2026-01-01:output",
      "claude-example-2026-01-01:web_search"
    ]);
    expect(JSON.stringify(result.records)).not.toContain("reportedCost");
    expect(JSON.stringify(result.records)).not.toContain("anthropic-secret");
  });
  it("paginates inside the run and discards provider cursors", async () => {
    const ctx = context([reply(JSON.stringify({ data: [], has_more: true, next_page: "next" })), reply()]);
    const result = await anthropic.run("pull_usage", ctx.value, { cursor: "ignored" });
    expect(ctx.requests[1]?.url).toContain("page=next");
    expect(result.cursor).toBeNull();
  });
  it("filters workspaces and sends versioned authentication headers", async () => {
    const ctx = context([reply()], { workspaceIds: ["wrk_a"] });
    await anthropic.run("pull_usage", ctx.value, { cursor: null });
    expect(ctx.requests[0]?.url).toContain("workspace_ids%5B%5D=wrk_a");
    expect(ctx.requests[0]?.url).not.toContain("anthropic-secret");
    expect(ctx.requests[0]?.headers).toMatchObject({
      "x-api-key": "anthropic-secret",
      "anthropic-version": "2023-06-01"
    });
  });
  it.each([
    [429, "RATE_LIMITED"],
    [500, "SERVER_ERROR"]
  ])("maps HTTP %s", async (status, code) => {
    await expect(
      anthropic.run("pull_usage", context([reply("{}", status)]).value, { cursor: null })
    ).rejects.toMatchObject({ code });
  });
  it("rejects absent fields and malformed JSON", async () => {
    await expect(anthropic.run("pull_usage", context([reply("{}")]).value, { cursor: null })).rejects.toMatchObject({
      code: "INVALID_RESPONSE"
    });
    await expect(anthropic.run("pull_usage", context([reply("bad")]).value, { cursor: null })).rejects.toMatchObject({
      code: "INVALID_RESPONSE"
    });
  });
  it("health reports success and authentication failure", async () => {
    expect(await anthropic.health(context([reply()]).value)).toEqual({ status: "ok" });
    expect(await anthropic.health(context([reply("{}", 401)]).value)).toEqual({
      status: "failed",
      failure: "unauthorized"
    });
  });
});

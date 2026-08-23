import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ConnectorContext, HttpResponse } from "../contract.js";
import { openAi, openAiUsageApiVersion, type OpenAiConfig } from "./openai.js";

const fixture = readFileSync(new URL("./fixtures/openai-usage-2020-10-01.json", import.meta.url), "utf8");
const now = new Date("2026-08-23T12:00:00Z");
const response = (body = fixture, status = 200): HttpResponse => ({ status, headers: {}, body });
function context(responses: HttpResponse[], config: Partial<OpenAiConfig> = {}) {
  const requests: { url: string; headers?: Readonly<Record<string, string>> }[] = [];
  const value: ConnectorContext<OpenAiConfig> = {
    instanceId: "instance",
    config: { baseUrl: "https://api.openai.com", lookbackDays: 2, projectIds: [], ...config },
    http: {
      send: (request) => {
        requests.push(request);
        return Promise.resolve(responses.shift() ?? response());
      }
    },
    secrets: { open: () => Promise.resolve("sk-admin-secret") },
    logger: { info() {}, warn() {}, error() {} },
    clock: { now: () => now }
  };
  return { value, requests };
}

describe("OpenAI usage connector", () => {
  it("declares its schema, cadence, credential and captured API version", () => {
    expect(openAiUsageApiVersion).toBe("organization usage API 2020-10-01");
    expect(openAi.parseConfig({})).toMatchObject({ ok: true });
    expect(openAi.parseConfig({ baseUrl: "https://evil.test" }).ok).toBe(false);
    expect(openAi.credentialKinds).toEqual(["admin_api_key"]);
    expect(openAi.capabilities.operations).toEqual({ pull_usage: { shape: "event", everySeconds: 3600 } });
  });

  it("projects the anonymized fixture into a strict usage envelope without a tariff", async () => {
    const ctx = context([response()]);
    const result = await openAi.run("pull_usage", ctx.value, { cursor: null });
    expect(result.records).toHaveLength(1);
    expect(result.records[0]?.data.usage).toEqual({
      occurredAt: "2026-08-23T00:00:00.000Z",
      sku: "gpt-example-2026-01-01",
      status: "observed",
      quantities: [
        { unit: "input_token", qualifier: "uncached", quantity: "1200" },
        { unit: "cached_input_token", qualifier: "cached", quantity: "200" },
        { unit: "output_token", qualifier: "output", quantity: "300" },
        { unit: "request", qualifier: "total", quantity: "4" }
      ]
    });
    expect(JSON.stringify(result.records)).not.toContain("sk-admin-secret");
    expect(JSON.stringify(result.records)).not.toContain("reportedCost");
  });

  it("follows provider pagination within one run and never persists its page token", async () => {
    const first = JSON.stringify({ data: [], has_more: true, next_page: "next" });
    const ctx = context([response(first), response()]);
    const result = await openAi.run("pull_usage", ctx.value, { cursor: "ignored-old-cursor" });
    expect(ctx.requests[1]?.url).toContain("page=next");
    expect(result.cursor).toBeNull();
  });

  it("uses project filters and keeps the admin key in the authorization header", async () => {
    const ctx = context([response()], { projectIds: ["proj_a"] });
    await openAi.run("pull_usage", ctx.value, { cursor: null });
    expect(ctx.requests[0]?.url).toContain("project_ids%5B%5D=proj_a");
    expect(ctx.requests[0]?.url).not.toContain("sk-admin-secret");
    expect(ctx.requests[0]?.headers?.authorization).toBe("Bearer sk-admin-secret");
  });

  it.each([
    [429, "RATE_LIMITED"],
    [500, "SERVER_ERROR"]
  ])("maps HTTP %s", async (status, code) => {
    await expect(
      openAi.run("pull_usage", context([response("{}", status)]).value, { cursor: null })
    ).rejects.toMatchObject({ code });
  });

  it("rejects absent pagination fields and malformed JSON", async () => {
    await expect(openAi.run("pull_usage", context([response("{}")]).value, { cursor: null })).rejects.toMatchObject({
      code: "INVALID_RESPONSE"
    });
    await expect(
      openAi.run("pull_usage", context([response("not-json")]).value, { cursor: null })
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("health checks the official endpoint and reports authentication failure", async () => {
    expect(await openAi.health(context([response()]).value)).toEqual({ status: "ok" });
    expect(await openAi.health(context([response("{}", 401)]).value)).toEqual({
      status: "failed",
      failure: "unauthorized"
    });
  });
});

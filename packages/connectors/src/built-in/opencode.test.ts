import { describe, expect, it } from "vitest";
import { openCode, readOpenCodePayload } from "./opencode.js";

const payload = {
  schemaVersion: 1,
  batchId: "batch-1",
  deviceId: "11111111-1111-4111-8111-111111111111",
  events: [
    {
      id: "msg-1",
      occurredAt: "2026-08-24T08:00:00.000Z",
      provider: "anthropic",
      model: "claude-sonnet",
      projectRef: "a".repeat(64),
      tokens: { input: "10", output: "4", reasoning: "2", cacheRead: "8", cacheWrite: "0" }
    }
  ]
} as const;

describe("OpenCode ingress", () => {
  it("projects only allowlisted usage metadata", () => {
    expect(readOpenCodePayload(JSON.stringify(payload))).toEqual({
      batchId: "batch-1",
      records: [
        {
          externalId: "11111111-1111-4111-8111-111111111111:msg-1",
          data: {
            source: { deviceId: payload.deviceId, projectRef: "a".repeat(64) },
            usage: {
              occurredAt: "2026-08-24T08:00:00.000Z",
              sku: "anthropic:claude-sonnet",
              status: "observed",
              quantities: [
                { unit: "input_token", quantity: "10", qualifier: "input" },
                { unit: "output_token", quantity: "4", qualifier: "output" },
                { unit: "output_token", quantity: "2", qualifier: "reasoning" },
                { unit: "cached_input_token", quantity: "8", qualifier: "cache_read" },
                { unit: "request", quantity: "1", qualifier: "total" }
              ]
            }
          }
        }
      ]
    });
    expect(JSON.stringify(readOpenCodePayload(JSON.stringify(payload)))).not.toMatch(/prompt|content|directory|diff/);
  });

  it.each([
    "not-json",
    JSON.stringify({ ...payload, prompt: "must never cross the boundary" }),
    JSON.stringify({ ...payload, events: [{ ...payload.events[0], content: "secret" }] }),
    JSON.stringify({ ...payload, events: [] }),
    JSON.stringify({ ...payload, deviceId: "not-a-uuid" }),
    JSON.stringify({
      ...payload,
      events: [{ ...payload.events[0], tokens: { ...payload.events[0].tokens, input: 1.5 } }]
    })
  ])("rejects malformed or over-broad payloads", async (body) => {
    await expect(
      openCode.ingest(
        {
          instanceId: "instance",
          config: {},
          http: { send: () => Promise.reject(new Error("closed")) },
          secrets: { open: () => Promise.reject(new Error("closed")) },
          logger: { info: () => {}, warn: () => {}, error: () => {} },
          clock: { now: () => new Date() }
        },
        { body, headers: {}, receivedAt: new Date() }
      )
    ).rejects.toThrow("INVALID_PAYLOAD");
  });
});

import { describe, expect, it } from "vitest";
import type { ConnectorContext, HttpResponse, IngressRequest } from "../contract.js";
import { genericWebhook } from "./generic-webhook.js";

const receivedAt = new Date("2026-08-11T10:00:00.000Z");

const respond = (status: number): HttpResponse => ({ status, headers: {}, body: "" });

const contextWith = (config: unknown, status = 200): ConnectorContext<unknown> => ({
  instanceId: "instance-1",
  config,
  http: { send: () => Promise.resolve(respond(status)) },
  secrets: { open: () => Promise.resolve("opened-just-in-time") },
  logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
  clock: { now: () => receivedAt }
});

const post = (body: string): IngressRequest => ({ body, headers: {}, receivedAt });

const defaults = {};

describe("configuration", () => {
  it("accepts an inbound-only instance with nothing configured", () => {
    const result = genericWebhook.parseConfig(defaults);
    expect(result.ok).toBe(true);
  });

  it("refuses a key nobody allowlisted", () => {
    expect(genericWebhook.parseConfig({ callbackUrl: "https://example.com" }).ok).toBe(false);
  });

  it("refuses a health url that is not https", () => {
    expect(genericWebhook.parseConfig({ healthUrl: "http://example.com/health" }).ok).toBe(false);
    expect(genericWebhook.parseConfig({ healthUrl: "file:///etc/passwd" }).ok).toBe(false);
    expect(genericWebhook.parseConfig({ healthUrl: "https://example.com/health" }).ok).toBe(true);
  });

  it("refuses an allowlist longer than anybody would maintain", () => {
    const many = Array.from({ length: 51 }, (_, index) => `event.${index}`);
    expect(genericWebhook.parseConfig({ eventTypes: many }).ok).toBe(false);
  });
});

describe("health", () => {
  it("says unverifiable rather than inventing a pass when there is nothing to call", async () => {
    expect(await genericWebhook.health(contextWith(defaults))).toEqual({ status: "unverifiable" });
  });

  it("passes when the configured endpoint answers", async () => {
    const context = contextWith({ healthUrl: "https://example.com/health" }, 200);
    expect(await genericWebhook.health(context)).toEqual({ status: "ok" });
  });

  it("maps the provider's status onto a failure the retry policy understands", async () => {
    const serverError = contextWith({ healthUrl: "https://example.com/health" }, 503);
    expect(await genericWebhook.health(serverError)).toEqual({ status: "failed", failure: "server_error" });

    const refused = contextWith({ healthUrl: "https://example.com/health" }, 401);
    expect(await genericWebhook.health(refused)).toEqual({ status: "failed", failure: "unauthorized" });
  });
});

describe("reading an event", () => {
  it("takes the provider's own id, which is what makes a replay idempotent", async () => {
    const result = await genericWebhook.ingest(contextWith(defaults), post('{"id":"evt_123","type":"invoice.paid"}'));
    expect(result).toEqual({ eventId: "evt_123", accepted: true, summary: { eventType: "invoice.paid" } });
  });

  it("follows a configured path when the provider nests its id", async () => {
    const context = contextWith({ eventIdPath: "data.event.id", eventTypePath: "data.event.kind" });
    const result = await genericWebhook.ingest(context, post('{"data":{"event":{"id":"e9","kind":"ping"}}}'));
    expect(result.eventId).toBe("e9");
    expect(result.summary).toEqual({ eventType: "ping" });
  });

  it("reports no id when the provider sends none, so the runtime hashes the body instead", async () => {
    const result = await genericWebhook.ingest(contextWith(defaults), post('{"type":"ping"}'));
    expect(result.eventId).toBeNull();
    expect(result.accepted).toBe(true);
  });

  it("refuses an id that is not a usable string", async () => {
    expect((await genericWebhook.ingest(contextWith(defaults), post('{"id":42}'))).eventId).toBeNull();
    expect((await genericWebhook.ingest(contextWith(defaults), post('{"id":""}'))).eventId).toBeNull();
    expect((await genericWebhook.ingest(contextWith(defaults), post('{"id":{"a":1}}'))).eventId).toBeNull();
  });

  it("marks a filtered event as not accepted instead of dropping it silently", async () => {
    const context = contextWith({ eventTypes: ["invoice.paid"] });

    const kept = await genericWebhook.ingest(context, post('{"id":"a","type":"invoice.paid"}'));
    expect(kept.accepted).toBe(true);

    const filtered = await genericWebhook.ingest(context, post('{"id":"b","type":"invoice.voided"}'));
    expect(filtered).toEqual({ eventId: "b", accepted: false, summary: { eventType: "invoice.voided" } });
  });

  it("filters out an event with no type at all once an allowlist exists", async () => {
    const context = contextWith({ eventTypes: ["invoice.paid"] });
    const result = await genericWebhook.ingest(context, post('{"id":"c"}'));
    expect(result.accepted).toBe(false);
  });

  it("refuses to walk out of the payload and into the prototype chain", async () => {
    const context = contextWith({ eventIdPath: "__proto__.polluted" });
    const result = await genericWebhook.ingest(context, post('{"__proto__":{"polluted":"owned"}}'));
    expect(result.eventId).toBeNull();
  });

  it("rejects a body that is not json", async () => {
    await expect(genericWebhook.ingest(contextWith(defaults), post("not json"))).rejects.toThrow("INVALID_PAYLOAD");
  });
});

describe("what the provider signs", () => {
  it("binds the timestamp into the signed bytes so a replay cannot be re-stamped", () => {
    const signature = genericWebhook.ingressSignature;
    expect(signature?.algorithm).toBe("hmac-sha256");
    expect(signature?.payload("1754906400", '{"id":"a"}')).toBe('1754906400.{"id":"a"}');
  });

  it("names the headers the api has to read", () => {
    expect(genericWebhook.ingressSignature?.signatureHeader).toBe("x-control-hub-signature");
    expect(genericWebhook.ingressSignature?.timestampHeader).toBe("x-control-hub-timestamp");
  });
});

describe("capabilities", () => {
  it("declares no outbound operations, so none can be dispatched", async () => {
    expect(genericWebhook.capabilities.operations).toEqual({});
    await expect(genericWebhook.run("pull", contextWith(defaults), { cursor: null })).rejects.toThrow(
      "UNKNOWN_OPERATION"
    );
  });

  it("keeps its own signing secret rather than asking the provider for one", () => {
    expect(genericWebhook.credentialKinds).toEqual(["ingress_signing"]);
  });

  it("allows only https, and only to the address its own configuration names", () => {
    expect(genericWebhook.capabilities.egress).toEqual({ schemes: ["https"], destination: "configured_base_url" });
  });
});

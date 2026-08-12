import { inspect } from "node:util";
import { describe, expect, it } from "vitest";
import { KeyRing, KeyRingError, parseKeyRing } from "./key-ring.js";

const key = (byte: number) => Buffer.alloc(32, byte).toString("base64");

const ring = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({ activeKeyId: "2026-08", keys: { "2026-08": key(1), "2026-02": key(2) }, ...overrides });

describe("reading a key ring", () => {
  it("keeps the active key and the retired ones apart", () => {
    const parsed = parseKeyRing(ring());
    expect(parsed.activeKeyId).toBe("2026-08");
    expect(parsed.keyIds()).toEqual(["2026-02", "2026-08"]);
    expect(parsed.activeKey().key.toString("base64")).toBe(key(1));
    expect(parsed.keyFor("2026-02")?.toString("base64")).toBe(key(2));
  });

  it("answers null for a key it has never held, rather than guessing", () => {
    expect(parseKeyRing(ring()).keyFor("2025-01")).toBeNull();
  });

  it("refuses a ring whose active key is not in it", () => {
    expect(() => parseKeyRing(ring({ activeKeyId: "nope" }))).toThrow("ACTIVE_KEY_NOT_IN_RING");
  });

  it("refuses a key that is not 32 bytes of base64", () => {
    expect(() => parseKeyRing(ring({ keys: { "2026-08": Buffer.alloc(16, 1).toString("base64") } }))).toThrow(
      "KEY_NOT_32_BYTES_BASE64"
    );
    expect(() => parseKeyRing(ring({ keys: { "2026-08": "not base64 at all" } }))).toThrow("KEY_NOT_32_BYTES_BASE64");
  });

  it("refuses a retirement that retired nothing", () => {
    expect(() => parseKeyRing(ring({ keys: { "2026-08": key(1), "2026-02": key(1) } }))).toThrow(
      "DUPLICATE_KEY_MATERIAL"
    );
  });

  it("refuses an empty ring and a body that is not json", () => {
    expect(() => parseKeyRing(ring({ keys: {} }))).toThrow("KEY_RING_EMPTY");
    expect(() => parseKeyRing("{ nope")).toThrow("KEY_RING_NOT_JSON");
  });

  it("refuses a field nobody declared, so a typo is not silently ignored", () => {
    expect(() => parseKeyRing(ring({ activeKey: "2026-08" }))).toThrow("KEY_RING_MALFORMED");
  });

  it("refuses a key id that could not be stored beside a ciphertext", () => {
    expect(() => parseKeyRing(ring({ keys: { ["a".repeat(65)]: key(1) } }))).toThrow("KEY_RING_MALFORMED");
    expect(() => parseKeyRing(ring({ keys: { "key with spaces": key(1) } }))).toThrow("KEY_RING_MALFORMED");
  });
});

describe("a key ring does not print itself", () => {
  const parsed = parseKeyRing(ring());

  it("says which keys it holds and never what they are", () => {
    const serialised = JSON.stringify({ environment: { connectorKeyRing: parsed } });
    expect(serialised).toContain("2026-08");
    expect(serialised).not.toContain(key(1));
    expect(serialised).not.toContain(key(2));
  });

  it("survives console.log too, which does not go through toJSON", () => {
    const printed = inspect({ connectorKeyRing: parsed }, { depth: 5 });
    expect(printed).toContain("KeyRing(active=2026-08, keys=2)");
    expect(printed).not.toContain(key(1));
  });

  it("has no enumerable field holding key material", () => {
    expect(Object.keys(parsed)).toEqual(["activeKeyId"]);
  });
});

describe("a ring built by hand", () => {
  it("refuses to seal when its own active key is missing", () => {
    const broken = new KeyRing("gone", new Map([["present", Buffer.alloc(32, 1)]]));
    expect(() => broken.activeKey()).toThrow(KeyRingError);
    expect(() => broken.activeKey()).toThrow("ACTIVE_KEY_MISSING");
  });
});

import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { nodeIngressCrypto } from "./ingress-crypto.js";

const secret = "an-ingress-signing-secret";
const payload = '1786435200.{"id":"evt_1"}';

function signedWith(value: string): string {
  return createHmac("sha256", value).update(payload, "utf8").digest("hex");
}

describe("verifying a provider's signature", () => {
  it("accepts the signature the secret produces", () => {
    expect(nodeIngressCrypto.matches({ secret, payload, signature: signedWith(secret) })).toBe(true);
  });

  it("refuses one made with another secret, and one made over other bytes", () => {
    expect(nodeIngressCrypto.matches({ secret, payload, signature: signedWith("a-different-secret") })).toBe(false);
    const overOtherBytes = createHmac("sha256", secret).update("1786435200.{}", "utf8").digest("hex");
    expect(nodeIngressCrypto.matches({ secret, payload, signature: overOtherBytes })).toBe(false);
  });

  /**
   * The comparison is fixed length, so a signature of the wrong size is answered rather than
   * thrown at. `timingSafeEqual` on the raw values would raise on a length mismatch, and the
   * length check that avoided it would be a side channel of its own.
   */
  it("answers a signature of any length instead of throwing at it", () => {
    for (const signature of ["", "0", "not-hex", signedWith(secret).repeat(4)]) {
      expect(nodeIngressCrypto.matches({ secret, payload, signature })).toBe(false);
    }
  });

  it("is not case insensitive: a signature is bytes, not a word", () => {
    expect(nodeIngressCrypto.matches({ secret, payload, signature: signedWith(secret).toUpperCase() })).toBe(false);
  });
});

describe("what the platform mints", () => {
  it("gives every endpoint its own secret, long enough that guessing is not a strategy", () => {
    const minted = Array.from({ length: 50 }, () => nodeIngressCrypto.mintSecret());
    expect(new Set(minted).size).toBe(minted.length);
    // 32 bytes as base64url. Shorter would be a secret the credential service itself refuses.
    for (const secretValue of minted) expect(secretValue).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("hashes a body to something stable, which is what an idempotency key needs", () => {
    expect(nodeIngressCrypto.sha256("{}")).toBe(nodeIngressCrypto.sha256("{}"));
    expect(nodeIngressCrypto.sha256("{}")).not.toBe(nodeIngressCrypto.sha256("{ }"));
    expect(nodeIngressCrypto.sha256("{}")).toMatch(/^[0-9a-f]{64}$/);
  });
});

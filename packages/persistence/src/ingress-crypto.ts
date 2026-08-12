import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { IngressCrypto } from "@control-hub/application";

/**
 * The `node:crypto` side of webhook verification.
 *
 * It lives here, beside the vault, for the reason ADR-0008 gives: the use cases depend on the
 * operation and not on the runtime that performs it, so they stay testable without a key and
 * there is one place to review when the algorithm changes.
 */

/** 32 bytes, base64url. The same size as an endpoint's public identifier, and for the same reason. */
const secretBytes = 32;

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

export const nodeIngressCrypto: IngressCrypto = {
  /**
   * Compares in constant time, and over a fixed length.
   *
   * `timingSafeEqual` throws when the two buffers differ in size, so comparing the raw signatures
   * would need a length check first — and returning early on it would publish how long the right
   * answer is. Hashing both sides makes every comparison 32 bytes regardless of what arrived.
   */
  matches({ secret, payload, signature }) {
    const expected = createHmac("sha256", secret).update(payload, "utf8").digest("hex");
    return timingSafeEqual(digest(expected), digest(signature));
  },
  sha256: (value) => createHash("sha256").update(value, "utf8").digest("hex"),
  mintSecret: () => randomBytes(secretBytes).toString("base64url")
};

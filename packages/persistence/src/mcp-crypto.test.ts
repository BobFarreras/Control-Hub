import { describe, expect, it } from "vitest";
import { NodeMcpCrypto } from "./mcp-repository.js";

const crypto = new NodeMcpCrypto();

describe("NodeMcpCrypto", () => {
  it("mints a 256 bit token that is safe in a URL and never repeats", () => {
    const minted = new Set(Array.from({ length: 500 }, () => crypto.mintToken()));
    expect(minted.size).toBe(500);
    for (const token of minted) {
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    }
  });

  it("hashes to the digest everybody else computes", () => {
    // The published SHA-256 of "abc". A test against our own output would pass even if the
    // algorithm quietly became something else.
    expect(crypto.sha256("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(crypto.sha256("abc")).toHaveLength(64);
  });

  it("computes the PKCE challenge of RFC 7636 exactly", () => {
    // Appendix B of the RFC, verifier and challenge both. This is the pair a real client computes,
    // so getting it wrong here would mean every desktop client failing at the token endpoint.
    expect(crypto.pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
    );
  });

  it("keeps the digest and the challenge in different alphabets on purpose", () => {
    // Hex for what we store, base64url for what a client sends. Mixing them up would compare two
    // encodings of the same bytes and always answer no.
    expect(crypto.sha256("abc")).not.toBe(crypto.pkceChallenge("abc"));
  });

  it("compares equal values as equal and everything else as not", () => {
    const digest = crypto.sha256("secret");
    expect(crypto.matches(digest, digest)).toBe(true);
    expect(crypto.matches(digest, crypto.sha256("other"))).toBe(false);
    // A length mismatch has to answer false rather than throw: `timingSafeEqual` refuses buffers of
    // different sizes, and an exception here would turn a wrong secret into a 500.
    expect(crypto.matches(digest, "short")).toBe(false);
    expect(crypto.matches("", "")).toBe(true);
  });
});

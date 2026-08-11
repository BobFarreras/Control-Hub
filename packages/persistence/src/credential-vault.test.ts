import { randomUUID } from "node:crypto";
import { parseKeyRing } from "@control-hub/config";
import { describe, expect, it } from "vitest";
import { CredentialVault, VaultError } from "./credential-vault.js";

const key = (byte: number) => Buffer.alloc(32, byte).toString("base64");

const ringWith = (activeKeyId: string, keys: Record<string, string>) =>
  parseKeyRing(JSON.stringify({ activeKeyId, keys }));

const current = ringWith("2026-08", { "2026-08": key(1) });
const rotated = ringWith("2026-09", { "2026-09": key(2), "2026-08": key(1) });
const replaced = ringWith("2026-09", { "2026-09": key(2) });

const tenantId = randomUUID();
const instanceId = randomUUID();
const aad = { tenantId, instanceId };
const secret = "whsec_9f2c8ab41d5e4f0b";

describe("sealing and opening", () => {
  it("returns the same secret it was given", () => {
    const vault = new CredentialVault(current);
    expect(vault.open(vault.seal(secret, aad), aad)).toBe(secret);
  });

  it("records the key that sealed it, which is what makes rotation cheap", () => {
    expect(new CredentialVault(current).seal(secret, aad).keyId).toBe("2026-08");
  });

  it("never puts the plain value in the envelope", () => {
    const envelope = new CredentialVault(current).seal(secret, aad);
    expect(Buffer.from(envelope.ciphertext).toString("utf8")).not.toContain(secret);
    expect(JSON.stringify(envelope)).not.toContain(secret);
  });

  it("produces a different envelope every time, so two equal secrets do not look equal", () => {
    const vault = new CredentialVault(current);
    const first = vault.seal(secret, aad);
    const second = vault.seal(secret, aad);
    expect(Buffer.from(first.nonce).equals(Buffer.from(second.nonce))).toBe(false);
    expect(Buffer.from(first.ciphertext).equals(Buffer.from(second.ciphertext))).toBe(false);
  });

  it("refuses to seal nothing", () => {
    expect(() => new CredentialVault(current).seal("", aad)).toThrow("EMPTY_SECRET");
  });
});

describe("rotating the master key", () => {
  it("still opens what a retired key sealed, with no rewrite", () => {
    const sealedBefore = new CredentialVault(current).seal(secret, aad);
    expect(new CredentialVault(rotated).open(sealedBefore, aad)).toBe(secret);
  });

  it("seals new envelopes with the key that is now active", () => {
    expect(new CredentialVault(rotated).seal(secret, aad).keyId).toBe("2026-09");
  });

  it("says plainly when the key an envelope names is gone from the ring", () => {
    const sealedBefore = new CredentialVault(current).seal(secret, aad);
    expect(() => new CredentialVault(replaced).open(sealedBefore, aad)).toThrow("KEY_NOT_IN_RING");
  });
});

describe("what an envelope is bound to", () => {
  it("does not open under another tenant, even with the very same key", () => {
    const vault = new CredentialVault(current);
    const envelope = vault.seal(secret, aad);
    expect(() => vault.open(envelope, { tenantId: randomUUID(), instanceId })).toThrow("ENVELOPE_NOT_AUTHENTIC");
  });

  it("does not open under another instance of the same tenant", () => {
    const vault = new CredentialVault(current);
    const envelope = vault.seal(secret, aad);
    expect(() => vault.open(envelope, { tenantId, instanceId: randomUUID() })).toThrow("ENVELOPE_NOT_AUTHENTIC");
  });
});

describe("a tampered envelope", () => {
  const vault = new CredentialVault(current);

  const flipBit = (source: Uint8Array, index: number) => {
    const copy = Buffer.from(source);
    copy.writeUInt8(copy.readUInt8(index) ^ 0x01, index);
    return copy;
  };

  it("fails rather than returning something shorter", () => {
    const envelope = vault.seal(secret, aad);
    const ciphertext = flipBit(envelope.ciphertext, 0);
    expect(() => vault.open({ ...envelope, ciphertext }, aad)).toThrow("ENVELOPE_NOT_AUTHENTIC");
  });

  it("fails when the tag is the part that was touched", () => {
    const envelope = vault.seal(secret, aad);
    const ciphertext = flipBit(envelope.ciphertext, envelope.ciphertext.byteLength - 1);
    expect(() => vault.open({ ...envelope, ciphertext }, aad)).toThrow("ENVELOPE_NOT_AUTHENTIC");
  });

  it("fails when the nonce was swapped for another one", () => {
    const first = vault.seal(secret, aad);
    const second = vault.seal(secret, aad);
    expect(() => vault.open({ ...first, nonce: second.nonce }, aad)).toThrow("ENVELOPE_NOT_AUTHENTIC");
  });

  it("tells a wrong key and a moved envelope apart from nobody, on purpose", () => {
    const envelope = vault.seal(secret, aad);
    const wrongKey = () => new CredentialVault(ringWith("2026-08", { "2026-08": key(9) })).open(envelope, aad);
    const movedTenant = () => vault.open(envelope, { tenantId: randomUUID(), instanceId });
    expect(wrongKey).toThrow("ENVELOPE_NOT_AUTHENTIC");
    expect(movedTenant).toThrow("ENVELOPE_NOT_AUTHENTIC");
  });

  it("refuses an envelope whose shape is not one it could have produced", () => {
    const envelope = vault.seal(secret, aad);
    expect(() => vault.open({ ...envelope, nonce: Buffer.alloc(8) }, aad)).toThrow("ENVELOPE_MALFORMED");
    expect(() => vault.open({ ...envelope, ciphertext: Buffer.alloc(16) }, aad)).toThrow(VaultError);
  });
});

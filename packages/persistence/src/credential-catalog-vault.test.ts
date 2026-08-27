import { parseKeyRing } from "@control-hub/config";
import { describe, expect, it } from "vitest";
import { CredentialCatalogReferenceVault } from "./credential-catalog-vault.js";

const key = Buffer.alloc(32, 7).toString("base64");
const vault = () =>
  new CredentialCatalogReferenceVault(
    parseKeyRing(JSON.stringify({ activeKeyId: "workspace", keys: { workspace: key } }))
  );

describe("credential catalog reference vault", () => {
  it("round trips a reference without placing plaintext in the envelope", () => {
    const reference = "https://vault.example.test/#/vault?itemId=opaque";
    const context = { tenantId: "tenant-a", entryId: "entry-a" };
    const envelope = vault().seal(reference, context);
    expect(Buffer.from(envelope.ciphertext).toString("utf8")).not.toContain("opaque");
    expect(vault().open(envelope, context)).toBe(reference);
  });

  it("refuses an envelope moved to another tenant or entry", () => {
    const context = { tenantId: "tenant-a", entryId: "entry-a" };
    const envelope = vault().seal("opaque-reference", context);
    expect(() => vault().open(envelope, { ...context, tenantId: "tenant-b" })).toThrow("ENVELOPE_NOT_AUTHENTIC");
    expect(() => vault().open(envelope, { ...context, entryId: "entry-b" })).toThrow("ENVELOPE_NOT_AUTHENTIC");
  });

  it("refuses tampering and unknown keys without acting as an oracle", () => {
    const context = { tenantId: "tenant-a", entryId: "entry-a" };
    const envelope = vault().seal("opaque-reference", context);
    const tampered = Buffer.from(envelope.ciphertext);
    tampered[0] = tampered[0]! ^ 1;
    expect(() => vault().open({ ...envelope, ciphertext: tampered }, context)).toThrow("ENVELOPE_NOT_AUTHENTIC");
    expect(() => vault().open({ ...envelope, keyId: "retired" }, context)).toThrow("KEY_NOT_IN_RING");
  });
});

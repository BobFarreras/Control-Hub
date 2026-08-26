import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type {
  CredentialCatalogReferenceEnvelope,
  CredentialCatalogReferenceReader,
  CredentialCatalogReferenceSealer
} from "@control-hub/application";
import type { KeyRing } from "@control-hub/config";
import { VaultError } from "./credential-vault.js";

const algorithm = "aes-256-gcm";
const nonceBytes = 12;
const tagBytes = 16;

type ReferenceContext = { tenantId: string; entryId: string };

function additionalData(context: ReferenceContext): Buffer {
  return Buffer.from(`control-hub:credential-catalog-reference:v1:${context.tenantId}:${context.entryId}`, "utf8");
}

/**
 * Separate cryptographic purpose for Bitwarden references.
 *
 * It shares key custody with connector credentials, not their envelope context. Moving a valid
 * connector ciphertext here, or moving this envelope between tenants or entries, therefore
 * fails authentication rather than producing a plausible URL.
 */
export class CredentialCatalogReferenceVault
  implements CredentialCatalogReferenceSealer, CredentialCatalogReferenceReader
{
  constructor(private readonly ring: KeyRing) {}

  seal(plaintext: string, context: ReferenceContext): CredentialCatalogReferenceEnvelope {
    if (plaintext.length === 0) throw new VaultError("EMPTY_REFERENCE");
    const { keyId, key } = this.ring.activeKey();
    const nonce = randomBytes(nonceBytes);
    const cipher = createCipheriv(algorithm, key, nonce);
    cipher.setAAD(additionalData(context));
    const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    return { keyId, nonce, ciphertext: Buffer.concat([body, cipher.getAuthTag()]) };
  }

  open(envelope: CredentialCatalogReferenceEnvelope, context: ReferenceContext): string {
    const key = this.ring.keyFor(envelope.keyId);
    if (!key) throw new VaultError("KEY_NOT_IN_RING");
    const nonce = Buffer.from(envelope.nonce);
    const sealed = Buffer.from(envelope.ciphertext);
    if (nonce.byteLength !== nonceBytes || sealed.byteLength <= tagBytes) throw new VaultError("ENVELOPE_MALFORMED");
    const decipher = createDecipheriv(algorithm, key, nonce);
    decipher.setAAD(additionalData(context));
    decipher.setAuthTag(sealed.subarray(sealed.byteLength - tagBytes));
    try {
      return Buffer.concat([
        decipher.update(sealed.subarray(0, sealed.byteLength - tagBytes)),
        decipher.final()
      ]).toString("utf8");
    } catch {
      throw new VaultError("ENVELOPE_NOT_AUTHENTIC");
    }
  }
}

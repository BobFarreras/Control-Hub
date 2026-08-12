import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { CredentialAad, CredentialEnvelope, CredentialSealer } from "@control-hub/application";
import type { KeyRing } from "@control-hub/config";

/**
 * Envelope encryption for connector credentials: AES-256-GCM, `node:crypto`, no new dependency.
 *
 * The envelope format — key id, nonce, ciphertext with the tag appended — is a data contract.
 * Changing it means rewriting every row already sealed, so it takes a new ADR.
 *
 * Decision: `docs/adr/0008-connector-credential-vault.md`.
 */

export class VaultError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}

const algorithm = "aes-256-gcm";
const nonceBytes = 12;
const tagBytes = 16;

/**
 * What the ciphertext is bound to.
 *
 * The version prefix is not decoration: it is what lets a later format be told apart from this
 * one instead of failing as a corrupt envelope. Tenant and instance are fixed-length identifiers,
 * so the separator cannot be pushed around to make two different pairs produce the same bytes.
 */
function additionalData(aad: CredentialAad): Buffer {
  return Buffer.from(`control-hub:connector-credential:v1:${aad.tenantId}:${aad.instanceId}`, "utf8");
}

export class CredentialVault implements CredentialSealer {
  constructor(private readonly ring: KeyRing) {}

  /**
   * Seals with the active key and a nonce that has never been used with it.
   *
   * `randomBytes` rather than a counter: a counter has to be persisted and coordinated between
   * two processes, and a repeated nonce under the same key is the one mistake AES-GCM does not
   * survive.
   */
  seal(plaintext: string, aad: CredentialAad): CredentialEnvelope {
    if (plaintext.length === 0) throw new VaultError("EMPTY_SECRET");
    const { keyId, key } = this.ring.activeKey();
    const nonce = randomBytes(nonceBytes);
    const cipher = createCipheriv(algorithm, key, nonce);
    cipher.setAAD(additionalData(aad));
    const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    return { keyId, nonce, ciphertext: Buffer.concat([body, cipher.getAuthTag()]) };
  }

  /**
   * Opens an envelope, or fails. It never degrades.
   *
   * A key the ring has never held is reported as such, because that is an operational fact an
   * administrator has to act on. Everything else — a wrong key, an envelope moved to another
   * tenant, a flipped bit — comes back as one code. Telling those apart would hand an attacker
   * an oracle for which of their guesses was closer.
   */
  open(envelope: CredentialEnvelope, aad: CredentialAad): string {
    const key = this.ring.keyFor(envelope.keyId);
    if (!key) throw new VaultError("KEY_NOT_IN_RING");

    const nonce = Buffer.from(envelope.nonce);
    const sealed = Buffer.from(envelope.ciphertext);
    if (nonce.byteLength !== nonceBytes || sealed.byteLength <= tagBytes) {
      throw new VaultError("ENVELOPE_MALFORMED");
    }

    const decipher = createDecipheriv(algorithm, key, nonce);
    decipher.setAAD(additionalData(aad));
    decipher.setAuthTag(sealed.subarray(sealed.byteLength - tagBytes));
    try {
      const body = sealed.subarray(0, sealed.byteLength - tagBytes);
      return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
    } catch {
      throw new VaultError("ENVELOPE_NOT_AUTHENTIC");
    }
  }
}

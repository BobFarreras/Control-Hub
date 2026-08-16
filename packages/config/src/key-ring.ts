import { z } from "zod";

/**
 * The master keys that seal connector credentials.
 *
 * One key is active and writes; the rest are retired and only open what they already sealed.
 * Every ciphertext records the key that produced it, so rotating the master key is publishing a
 * new active key and keeping the old one readable — not a re-encryption pass over the table.
 *
 * Decision: `docs/adr/0008-connector-credential-vault.md`.
 */

export class KeyRingError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}

/** 32 bytes, base64. Anything else is refused at boot rather than at the first credential. */
const keyBytes = 32;
const keyIdPattern = /^[A-Za-z0-9_.-]{1,64}$/;

const keyRingSchema = z.strictObject({
  activeKeyId: z.string().regex(keyIdPattern),
  keys: z.record(z.string().regex(keyIdPattern), z.string().min(1))
});

/**
 * A parsed key ring that does not print itself.
 *
 * `toJSON` and the inspect hook both matter and neither substitutes for the other: a logger
 * serialises with `JSON.stringify`, `console.log` goes through `util.inspect`. The ring travels
 * inside the environment object, which is exactly the kind of thing somebody logs while
 * debugging a boot failure.
 */
export class KeyRing {
  readonly #keys: ReadonlyMap<string, Buffer>;

  constructor(
    readonly activeKeyId: string,
    keys: ReadonlyMap<string, Buffer>
  ) {
    this.#keys = keys;
  }

  /** The key that seals. There is exactly one, and it is the only one that may. */
  activeKey(): { keyId: string; key: Buffer } {
    const key = this.#keys.get(this.activeKeyId);
    if (!key) throw new KeyRingError("ACTIVE_KEY_MISSING");
    return { keyId: this.activeKeyId, key };
  }

  /** The key a ciphertext names, active or retired, or null when this ring has never held it. */
  keyFor(keyId: string): Buffer | null {
    return this.#keys.get(keyId) ?? null;
  }

  keyIds(): string[] {
    return [...this.#keys.keys()].sort();
  }

  toJSON(): { activeKeyId: string; keyIds: string[] } {
    return { activeKeyId: this.activeKeyId, keyIds: this.keyIds() };
  }

  toString(): string {
    return `KeyRing(active=${this.activeKeyId}, keys=${this.#keys.size})`;
  }

  [Symbol.for("nodejs.util.inspect.custom")](): string {
    return this.toString();
  }
}

/**
 * Reads a key ring from the JSON an operator injects, and refuses everything doubtful.
 *
 * Two keys sharing material is rejected rather than tolerated: it means a retirement that
 * retired nothing, and it would read as a rotation that had happened when it had not.
 */
export function parseKeyRing(raw: string): KeyRing {
  let source: unknown;
  try {
    source = JSON.parse(raw);
  } catch {
    throw new KeyRingError("KEY_RING_NOT_JSON");
  }

  const parsed = keyRingSchema.safeParse(source);
  if (!parsed.success) throw new KeyRingError("KEY_RING_MALFORMED");

  const entries = Object.entries(parsed.data.keys);
  if (entries.length === 0) throw new KeyRingError("KEY_RING_EMPTY");

  const keys = new Map<string, Buffer>();
  const seen = new Set<string>();
  for (const [keyId, encoded] of entries) {
    const key = Buffer.from(encoded, "base64");
    if (key.byteLength !== keyBytes || key.toString("base64") !== encoded) {
      throw new KeyRingError("KEY_NOT_32_BYTES_BASE64");
    }
    const fingerprint = key.toString("base64");
    if (seen.has(fingerprint)) throw new KeyRingError("DUPLICATE_KEY_MATERIAL");
    seen.add(fingerprint);
    keys.set(keyId, key);
  }

  if (!keys.has(parsed.data.activeKeyId)) throw new KeyRingError("ACTIVE_KEY_NOT_IN_RING");
  return new KeyRing(parsed.data.activeKeyId, keys);
}

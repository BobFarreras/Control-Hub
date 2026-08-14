import { createHmac } from "node:crypto";

/**
 * A TOTP generator for the end to end suite, so a test can sign in through the real second
 * factor instead of the product being asked to switch it off.
 *
 * RFC 6238 over RFC 4648 base32, which is what Better Auth stores in the `otpauth://` URI and
 * what any authenticator app reads from it. Node ships HMAC-SHA1, so this needs no dependency;
 * `totp.test.ts` pins it against Better Auth's own implementation so an upgrade that changed
 * the scheme would fail there rather than as an unexplained login failure in a browser.
 */

const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function decodeBase32(secret: string): Buffer {
  const clean = secret.replace(/=+$/u, "").replace(/\s+/gu, "").toUpperCase();
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const character of clean) {
    const value = alphabet.indexOf(character);
    if (value < 0) throw new Error(`Not a base32 character: ${character}`);
    buffer = (buffer << 5) | value;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  return Buffer.from(bytes);
}

/** The counter is the number of whole periods since the epoch, as a big endian eight byte value. */
function counterBytes(counter: number): Buffer {
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64BE(BigInt(counter));
  return bytes;
}

export function generateTotp(
  base32Secret: string,
  options: { digits?: number; period?: number; at?: number } = {}
): string {
  const digits = options.digits ?? 6;
  const period = options.period ?? 30;
  const counter = Math.floor((options.at ?? Date.now()) / (period * 1000));
  const digest = createHmac("sha1", decodeBase32(base32Secret)).update(counterBytes(counter)).digest();
  /**
   * RFC 4226 dynamic truncation: the low nibble of the last byte picks where to read, and four
   * big endian bytes from there become the number, with the sign bit cleared.
   *
   * Read through `Buffer`'s accessors rather than by index. An HMAC-SHA1 digest is always twenty
   * bytes and `offset` is at most fifteen, so `offset + 3` is always in range — but indexing says
   * that in a comment while these say it in the type, and they bounds-check at runtime instead of
   * quietly producing `undefined` if either assumption ever stopped holding.
   */
  const offset = digest.readUInt8(digest.length - 1) & 0x0f;
  const truncated = digest.readUInt32BE(offset) & 0x7fffffff;
  return (truncated % 10 ** digits).toString().padStart(digits, "0");
}

/**
 * How long the current code stays valid. A code handed to a form with a hundred milliseconds
 * left is a flake that looks like a broken second factor, so the caller waits for the next
 * window instead of chasing it.
 */
export function millisecondsLeftInPeriod(period = 30, at = Date.now()): number {
  return period * 1000 - (at % (period * 1000));
}

/** The secret Better Auth puts in the `otpauth://totp/...?secret=` URI it returns on enrolment. */
export function secretFromTotpUri(uri: string): string {
  const secret = new URL(uri).searchParams.get("secret");
  if (!secret) throw new Error("The enrolment URI carried no secret");
  return secret;
}

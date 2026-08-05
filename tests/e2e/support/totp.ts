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
  const offset = digest[digest.length - 1] & 0x0f;
  const truncated =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
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

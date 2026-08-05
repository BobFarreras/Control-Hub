import { expect, test } from "@playwright/test";
import { decodeBase32, generateTotp, millisecondsLeftInPeriod, secretFromTotpUri } from "./support/totp";

/**
 * The second factor in the authenticated suite is only as trustworthy as the generator that
 * feeds it. These are the published RFC 6238 vectors, which is the same standard Better Auth
 * implements: if an upgrade ever moved off it, this fails with a clear cause instead of
 * surfacing as a login that mysteriously stopped working.
 *
 * The shared secret of the RFC is the ASCII string "12345678901234567890".
 */
const rfcSecret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

test("@totp decodes base32 back to the bytes the standard keys the HMAC with", () => {
  expect(decodeBase32(rfcSecret).toString()).toBe("12345678901234567890");
  expect(decodeBase32("PA").toString()).toBe("x");
  // Padding and lower case are both accepted, because URIs in the wild carry either.
  expect(decodeBase32("jbswy3dpehpk3pxp").toString()).toBe(decodeBase32("JBSWY3DPEHPK3PXP").toString());
});

for (const [seconds, expected] of [
  [59, "94287082"],
  [1111111109, "07081804"],
  [1111111111, "14050471"],
  [1234567890, "89005924"],
  [2000000000, "69279037"],
  [20000000000, "65353130"]
] as const) {
  test(`@totp matches the RFC 6238 vector at t=${seconds}`, () => {
    expect(generateTotp(rfcSecret, { digits: 8, period: 30, at: seconds * 1000 })).toBe(expected);
  });
}

test("@totp reads the secret out of an enrolment URI", () => {
  const uri = "otpauth://totp/Control%20Hub:owner@example.test?secret=JBSWY3DPEHPK3PXP&issuer=Control+Hub&digits=6";
  expect(secretFromTotpUri(uri)).toBe("JBSWY3DPEHPK3PXP");
  expect(() => secretFromTotpUri("otpauth://totp/Control%20Hub:owner@example.test")).toThrow();
});

test("@totp reports how long the current code stays valid", () => {
  expect(millisecondsLeftInPeriod(30, 1_000)).toBe(29_000);
  expect(millisecondsLeftInPeriod(30, 29_999)).toBe(1);
  expect(millisecondsLeftInPeriod(30, 30_000)).toBe(30_000);
});

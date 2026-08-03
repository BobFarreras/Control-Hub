import { createHash } from "node:crypto";
import type { FastifyRequest } from "fastify";

/**
 * Credential endpoints are the ones worth throttling hard: they are the brute force surface.
 * Everything else under the auth prefix is session bookkeeping, and `get-session` in
 * particular runs once per rendered page, so it must not share a strict budget with sign-in.
 */
const sensitiveAuthPrefixes = [
  "/api/auth/sign-in",
  "/api/auth/sign-up",
  "/api/auth/forget-password",
  "/api/auth/reset-password",
  "/api/auth/two-factor",
  "/api/auth/passkey"
];

export function isSensitiveAuthRequest(request: FastifyRequest) {
  const path = request.url.split("?")[0] ?? "";
  return sensitiveAuthPrefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

/**
 * Server rendered pages call this API from the web container, so every authenticated user
 * shares one source address. Keying the limiter on the session token instead gives each
 * user their own budget regardless of how many proxies sit in between; unauthenticated
 * traffic still falls back to the address, which is what brute force protection needs.
 */
export function rateLimitKey(request: FastifyRequest) {
  const cookieHeader = request.headers.cookie;
  // A caller choosing its own cookie also chooses its own bucket, so credential routes must
  // never be keyed on it: rotating a fake token would hand out a fresh budget every attempt.
  if (cookieHeader && !isSensitiveAuthRequest(request)) {
    for (const part of cookieHeader.split(";")) {
      const separator = part.indexOf("=");
      if (separator === -1) continue;
      const name = part.slice(0, separator).trim();
      if (name !== "better-auth.session_token" && name !== "__Secure-better-auth.session_token") continue;
      const value = part.slice(separator + 1).trim();
      if (value) return `session:${createHash("sha256").update(value).digest("hex")}`;
    }
  }
  return `ip:${request.ip}`;
}

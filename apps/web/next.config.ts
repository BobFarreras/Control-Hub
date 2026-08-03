import type { NextConfig } from "next";

const apiUrl = process.env.API_INTERNAL_URL ?? "http://127.0.0.1:4000";
const isProduction = process.env.NODE_ENV === "production";

/**
 * `script-src` still needs `unsafe-inline` because the App Router streams its RSC payload
 * through inline scripts and nothing here mints a per-request nonce. Tightening it to
 * `nonce-...` requires a middleware that stamps every response; that is tracked separately.
 * The remaining directives are already effective on their own: they stop framing, base tag
 * injection, plugin content, form posts to third parties and outbound data exfiltration.
 */
const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  `script-src 'self' 'unsafe-inline'${isProduction ? "" : " 'unsafe-eval'"}`,
  "connect-src 'self'",
  "manifest-src 'self'",
  ...(isProduction ? ["upgrade-insecure-requests"] : [])
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), interest-cohort=()" },
  ...(isProduction ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }] : [])
];

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${apiUrl}/api/:path*` },
      { source: "/health/:path*", destination: `${apiUrl}/health/:path*` }
    ];
  }
};
export default nextConfig;

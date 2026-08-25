import { describe, expect, it } from "vitest";
import { isAllowlistedDestination, parseEgressAllowlist } from "./egress-allowlist.js";

describe("reading the operator's allowlist", () => {
  it("is empty when nobody set one, which is the safe default", () => {
    expect(parseEgressAllowlist(undefined)).toEqual([]);
    expect(parseEgressAllowlist("")).toEqual([]);
    expect(parseEgressAllowlist("  ,  ")).toEqual([]);
  });

  it("reads an origin as scheme, host and port together", () => {
    expect(parseEgressAllowlist("https://n8n.internal:5678,http://prometheus.internal")).toEqual([
      { scheme: "https:", hostname: "n8n.internal", port: 5678 },
      { scheme: "http:", hostname: "prometheus.internal", port: 80 }
    ]);
  });

  it("fills in the scheme's own default port rather than leaving it open", () => {
    expect(parseEgressAllowlist("https://api.internal")[0]?.port).toBe(443);
    expect(parseEgressAllowlist("imaps://mail.internal")[0]?.port).toBe(993);
  });

  it("refuses an entry with a path, instead of ignoring the part it cannot enforce", () => {
    for (const entry of ["https://n8n.internal/rest", "https://n8n.internal/?a=1", "https://n8n.internal/#x"]) {
      expect(() => parseEgressAllowlist(entry)).toThrow("EGRESS_ENTRY_HAS_PATH");
    }
    expect(parseEgressAllowlist("https://n8n.internal/")).toHaveLength(1);
  });

  it("refuses a bare hostname, which would allow every port on that machine", () => {
    expect(() => parseEgressAllowlist("n8n.internal")).toThrow("EGRESS_ENTRY_NOT_AN_ORIGIN");
  });

  it("refuses a scheme that is not http or https, and credentials in the entry", () => {
    expect(() => parseEgressAllowlist("file:///etc/passwd")).toThrow("EGRESS_SCHEME_REFUSED");
    expect(() => parseEgressAllowlist("https://user:pass@n8n.internal")).toThrow("EGRESS_ENTRY_HAS_CREDENTIALS");
  });
});

describe("deciding whether a URL was allowed", () => {
  const allowlist = parseEgressAllowlist("https://n8n.internal:5678,http://[::1]:9090");

  it("matches on all three parts, never on the host alone", () => {
    expect(isAllowlistedDestination(allowlist, new URL("https://n8n.internal:5678/rest/x"))).toBe(true);
    expect(isAllowlistedDestination(allowlist, new URL("http://n8n.internal:5678/rest/x"))).toBe(false);
    expect(isAllowlistedDestination(allowlist, new URL("https://n8n.internal:5679/rest/x"))).toBe(false);
    expect(isAllowlistedDestination(allowlist, new URL("https://other.internal:5678/"))).toBe(false);
  });

  it("allows an exact TLS-only IMAP origin", () => {
    const imap = parseEgressAllowlist("imaps://mail.internal:993");
    expect(isAllowlistedDestination(imap, new URL("imaps://mail.internal:993"))).toBe(true);
    expect(isAllowlistedDestination(imap, new URL("imaps://mail.internal:994"))).toBe(false);
  });

  it("compares an IPv6 literal without the brackets the URL puts around it", () => {
    expect(isAllowlistedDestination(allowlist, new URL("http://[::1]:9090/metrics"))).toBe(true);
  });

  it("allows nothing at all when the list is empty", () => {
    expect(isAllowlistedDestination([], new URL("https://n8n.internal:5678/"))).toBe(false);
  });
});

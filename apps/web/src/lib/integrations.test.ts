import { getIntegrationsDictionary, locales } from "@control-hub/i18n";
import { describe, expect, it } from "vitest";
import { errorLabelKey, errorMessage, healthTone, instanceStatusTone, problemCode, webhookUrl } from "./integrations";

describe("reading an API error", () => {
  it("turns a code into the key that translates it", () => {
    expect(errorLabelKey("INSTANCE_NOT_ENABLED")).toBe("errorInstanceNotEnabled");
    expect(errorLabelKey("FORBIDDEN")).toBe("errorForbidden");
  });

  /**
   * The screen must never show a provider's own words, and it must never show a bare code
   * either: somebody reading `INSTANCE_NOT_ENABLED` on a screen is reading our internals.
   */
  it("falls back to a sentence when the code is one nobody has translated yet", () => {
    const labels = getIntegrationsDictionary("ca") as unknown as Record<string, string>;
    expect(errorMessage(labels, "A_CODE_FROM_A_LATER_RELEASE")).toBe(labels.errorUnknown);
    expect(errorMessage(labels, null)).toBe(labels.errorUnknown);
    expect(errorMessage(labels, "FORBIDDEN")).toBe(labels.errorForbidden);
  });

  it("takes the code out of a problem document and nothing else", () => {
    expect(problemCode({ status: 409, code: "INSTANCE_NOT_ENABLED", title: "Integration is not enabled" })).toBe(
      "INSTANCE_NOT_ENABLED"
    );
    for (const payload of [null, undefined, "", 42, {}, { code: "" }, { code: 7 }]) {
      expect(problemCode(payload)).toBeNull();
    }
  });

  /** Every code the connector surface can answer with has a sentence in all three languages. */
  it("translates every code this screen can receive, in every locale", () => {
    const codes = [
      "FORBIDDEN",
      "INVALID_CONFIG",
      "INVALID_NAME",
      "UNKNOWN_CONNECTOR_TYPE",
      "INSTANCE_NOT_FOUND",
      "INSTANCE_NOT_ENABLED",
      "INGRESS_NOT_SUPPORTED",
      "ENDPOINT_ALREADY_EXISTS",
      "ENDPOINT_NOT_FOUND",
      "ROTATION_ALREADY_OPEN",
      "DUPLICATE_INSTANCE_NAME",
      "MFA_REQUIRED",
      "PERMISSION_DENIED"
    ];
    for (const locale of locales) {
      const labels = getIntegrationsDictionary(locale) as unknown as Record<string, string>;
      for (const code of codes) {
        expect(errorMessage(labels, code), `${locale} ${code}`).not.toBe(labels.errorUnknown);
      }
    }
  });
});

describe("what a state looks like", () => {
  it("gives every status and every health reading a tone, so none renders untoned", () => {
    expect(Object.values(instanceStatusTone).every(Boolean)).toBe(true);
    expect(Object.values(healthTone).every(Boolean)).toBe(true);
  });

  /**
   * Colour is never the only carrier, so two states sharing a tone is fine — the word beside it
   * is what distinguishes them. What must not happen is a state with no tone at all.
   */
  it("has a tone for each of the five health readings the domain defines", () => {
    expect(Object.keys(healthTone).sort()).toEqual(["degraded", "disabled", "failing", "healthy", "unknown"]);
  });
});

describe("the address a provider posts to", () => {
  it("joins the browser's origin to the path the API returned", () => {
    expect(webhookUrl("https://hub.example", "/api/v1/webhooks/abc")).toBe("https://hub.example/api/v1/webhooks/abc");
    expect(webhookUrl("https://hub.example/", "/api/v1/webhooks/abc")).toBe("https://hub.example/api/v1/webhooks/abc");
  });
});

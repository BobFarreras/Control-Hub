import { getIntegrationsDictionary, locales } from "@control-hub/i18n";
import { describe, expect, it } from "vitest";
import {
  errorLabelKey,
  errorMessage,
  healthReason,
  healthTone,
  instanceStatusTone,
  problemCode,
  runErrorMessage,
  selectedInstancePath,
  webhookUrl
} from "./integrations";

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

/**
 * A failed run is read from a different dictionary than a refused request, and it has to be.
 *
 * The two vocabularies collide on words. `FORBIDDEN` from this API means the reader lacks a
 * permission; `FORBIDDEN` from a run means the provider refused the credential we sent. Sharing
 * one key would put one of those sentences under the other's code, and the wrong one is worse
 * than the generic one: it sends somebody to check their own permissions when the answer is at
 * the far end.
 */
describe("reading why a run failed", () => {
  const labels = getIntegrationsDictionary("ca") as unknown as Record<string, string>;

  it("reads a run code from the run vocabulary, not from the request one", () => {
    expect(runErrorMessage(labels, "FORBIDDEN")).toBe(labels.runErrorForbidden);
    expect(runErrorMessage(labels, "FORBIDDEN")).not.toBe(labels.errorForbidden);
  });

  /**
   * The one that sent an operator looking in the wrong place: the address was simply not on the
   * allowlist, and the screen said the operation could not be completed.
   */
  it("says what actually went wrong instead of that something did", () => {
    for (const code of ["DESTINATION_NOT_ALLOWLISTED", "CREDENTIAL_MISSING", "UNAUTHORIZED"]) {
      expect(runErrorMessage(labels, code), code).not.toBe(labels.errorUnknown);
    }
  });

  it("still says something when a run stores a code from a later release", () => {
    expect(runErrorMessage(labels, "A_CODE_FROM_A_LATER_RELEASE")).toBe(labels.errorUnknown);
    expect(runErrorMessage(labels, null)).toBe(labels.errorUnknown);
  });

  /**
   * Exhaustiveness is asserted where the vocabulary is declared — `packages/i18n` walks
   * `connectorErrorCodes` from the domain and demands words in all three languages. This screen
   * deliberately does not depend on the domain, so what it checks is the mapping, in every
   * language, for the codes it is most likely to draw.
   */
  it("reads the same way in every language", () => {
    for (const locale of locales) {
      const dictionary = getIntegrationsDictionary(locale) as unknown as Record<string, string>;
      for (const code of ["DESTINATION_NOT_ALLOWLISTED", "CREDENTIAL_MISSING", "TOTAL_TIMEOUT"]) {
        expect(runErrorMessage(dictionary, code), `${locale} ${code}`).not.toBe(dictionary.errorUnknown);
      }
    }
  });
});

describe("what a row says about health without being opened", () => {
  const dictionary = getIntegrationsDictionary("ca") as unknown as Record<string, string>;

  it("turns the code a failed check stored into the sentence for it", () => {
    expect(healthReason(dictionary, "CONNECT_TIMEOUT")).toBe(dictionary.runErrorConnectTimeout);
  });

  /**
   * A healthy reading carries no code — `recordHealth` overwrites `last_error_code` on every
   * check, success included — so an empty string here is the absence of a reason, not a missing
   * translation. The table draws nothing rather than a stale explanation of a failure that is over.
   */
  it("says nothing at all when there is no code", () => {
    expect(healthReason(dictionary, null)).toBe("");
    expect(healthReason(dictionary, undefined)).toBe("");
    expect(healthReason(dictionary, "")).toBe("");
  });

  /**
   * The collision that matters. `FORBIDDEN` from this API means the reader lacks a permission;
   * `FORBIDDEN` on a health reading means the provider refused the credential we sent. A row that
   * borrowed the first sentence would send somebody to check their own permissions when the
   * answer is at the far end.
   */
  it("reads the code as a run's vocabulary, never as the API's", () => {
    expect(healthReason(dictionary, "FORBIDDEN")).toBe(dictionary.runErrorForbidden);
    expect(healthReason(dictionary, "FORBIDDEN")).not.toBe(dictionary.errorForbidden);
  });

  it("never shows a bare code, even for one this build does not know", () => {
    expect(healthReason(dictionary, "SOMETHING_A_LATER_RELEASE_ADDED")).toBe(dictionary.errorUnknown);
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

describe("an old link that selected an integration", () => {
  it("sends a well-formed identifier to the page that integration now has", () => {
    expect(selectedInstancePath("ca", "0b8a1f2c-3d4e-4f50-8a1b-2c3d4e5f6071")).toBe(
      "/ca/integrations/0b8a1f2c-3d4e-4f50-8a1b-2c3d4e5f6071"
    );
  });

  it("does not redirect when nothing was selected", () => {
    expect(selectedInstancePath("ca", undefined)).toBeNull();
    expect(selectedInstancePath("ca", "")).toBeNull();
  });

  /**
   * The value ends up in a path, so the shape is the whole defence. Escaping would not do: an
   * escaped traversal is still somebody trying, and there is no legitimate one to preserve.
   */
  it("refuses anything that is not an identifier, rather than escaping it", () => {
    for (const attempt of [
      "../../admin",
      "..%2f..%2fadmin",
      "0b8a1f2c-3d4e-4f50-8a1b-2c3d4e5f6071/../../admin",
      "0b8a1f2c-3d4e-4f50-8a1b-2c3d4e5f6071?next=https://evil.example",
      "https://evil.example",
      "not-an-identifier"
    ]) {
      expect(selectedInstancePath("ca", attempt), attempt).toBeNull();
    }
  });
});

describe("the address a provider posts to", () => {
  it("joins the browser's origin to the path the API returned", () => {
    expect(webhookUrl("https://hub.example", "/api/v1/webhooks/abc")).toBe("https://hub.example/api/v1/webhooks/abc");
    expect(webhookUrl("https://hub.example/", "/api/v1/webhooks/abc")).toBe("https://hub.example/api/v1/webhooks/abc");
  });
});

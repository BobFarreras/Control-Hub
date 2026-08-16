import { describe, expect, it } from "vitest";
import {
  connectorLabel,
  connectorSummary,
  credentialKindHint,
  credentialKindLabel,
  fieldHint,
  fieldLabel,
  issueMessage,
  labelKey
} from "./connector-labels.js";

const t = {
  connector_n8n: "n8n",
  connector_generic_webhook: "Webhook generic",
  connectorAbout_n8n: "Els teus workflows",
  field_baseUrl: "Adreca",
  field_n8n_baseUrl: "Adreca de la instancia",
  fieldHint_baseUrl: "L'arrel del servei",
  credentialKind_api_token: "Token de l'API",
  credentialSecretHint: "El valor no es torna a mostrar",
  credentialHint_n8n_api_token: "El generes a n8n, a Settings, API",
  issue_invalid_type: "Aquest valor no s'accepta.",
  issueInvalid: "Aquest valor no es valid."
};

/**
 * The bug this file exists to make impossible.
 *
 * A connector type is kebab-case and a translation key cannot be, so a lookup built straight from
 * the type misses and falls back to the type itself. Nothing fails; the screen simply shows
 * `generic-webhook` to somebody reading Catalan, which is how it reached an operator once.
 */
describe("looking a connector up in a dictionary", () => {
  it("finds the entry for a type whose name has a hyphen in it", () => {
    expect(labelKey("generic-webhook")).toBe("generic_webhook");
    expect(connectorLabel(t, "generic-webhook")).toBe("Webhook generic");
  });

  it("leaves a connector nobody has translated readable rather than blank", () => {
    expect(connectorLabel(t, "future-provider")).toBe("future-provider");
    expect(connectorSummary(t, "future-provider")).toBe("");
  });

  it("uses the summary when there is one", () => {
    expect(connectorSummary(t, "n8n")).toBe("Els teus workflows");
  });
});

/**
 * The same field name means different things to different providers, so a connector may say it
 * its own way. What keeps this from becoming a translation chore is the fallback: a new connector
 * reads sensibly from the shared wording until somebody has anything better to write.
 */
describe("naming a field the way its own connector would", () => {
  it("prefers the connector's own wording", () => {
    expect(fieldLabel(t, "n8n", "baseUrl")).toBe("Adreca de la instancia");
  });

  it("falls back to the shared wording, then to the name itself", () => {
    expect(fieldLabel(t, "generic-webhook", "baseUrl")).toBe("Adreca");
    expect(fieldLabel(t, "n8n", "unknownField")).toBe("unknownField");
  });

  it("carries a hint only when there is one to carry", () => {
    expect(fieldHint(t, "n8n", "baseUrl")).toBe("L'arrel del servei");
    expect(fieldHint(t, "n8n", "unknownField")).toBeUndefined();
  });
});

describe("naming a credential and saying where it comes from", () => {
  it("translates the kind, and leaves an unknown kind legible", () => {
    expect(credentialKindLabel(t, "api_token")).toBe("Token de l'API");
    expect(credentialKindLabel(t, "future_kind")).toBe("future_kind");
  });

  /**
   * Where to get a token is advice about one provider, so there is no generic version of it to
   * fall back to. A caller that also wants the standing warning about rotation asks for that one.
   */
  it("gives the provider's own instructions, and nothing at all when there are none", () => {
    expect(credentialKindHint(t, "n8n", "api_token")).toBe("El generes a n8n, a Settings, API");
    expect(credentialKindHint(t, "generic-webhook", "ingress_signing")).toBeUndefined();
  });
});

describe("saying what a connector refused", () => {
  it("uses our sentence for a known code and a general one otherwise", () => {
    expect(issueMessage(t, "invalid_type")).toBe("Aquest valor no s'accepta.");
    expect(issueMessage(t, "something_new")).toBe("Aquest valor no es valid.");
  });
});

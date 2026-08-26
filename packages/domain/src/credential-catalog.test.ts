import { describe, expect, it } from "vitest";
import {
  canTransitionCredentialCatalogEntry,
  credentialCatalogCategories,
  passwordManagerDeploymentModes
} from "./credential-catalog.js";

describe("credential catalog domain", () => {
  it("keeps revoked entries closed except for archival", () => {
    expect(canTransitionCredentialCatalogEntry("revoked", "active")).toBe(false);
    expect(canTransitionCredentialCatalogEntry("revoked", "archived")).toBe(true);
  });

  it("allows a reviewed entry to return to active", () => {
    expect(canTransitionCredentialCatalogEntry("review_due", "active")).toBe(true);
  });

  it("fixes the supported vocabulary instead of accepting provider-controlled values", () => {
    expect(passwordManagerDeploymentModes).toContain("self_hosted_dedicated_vps");
    expect(credentialCatalogCategories).toContain("website_admin");
  });
});

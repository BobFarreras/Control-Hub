import { describe, expect, it } from "vitest";
import { safeCredentialDestination } from "./credential-catalog";

describe("credential catalogue navigation", () => {
  it("accepts only HTTPS destinations on the registered exact origin", () => {
    expect(
      safeCredentialDestination("https://vault.example.test/#/vault?itemId=one", "https://vault.example.test")?.host
    ).toBe("vault.example.test");
    for (const destination of [
      "http://vault.example.test/#/vault?itemId=one",
      "https://vault.example.test.evil.test/#/vault?itemId=one",
      "https://evil.test/#/vault?itemId=one",
      "not-a-url"
    ])
      expect(safeCredentialDestination(destination, "https://vault.example.test")).toBeNull();
  });
});

import { parseApiEnvironment } from "@control-hub/config";
import { describe, expect, it } from "vitest";
import { platformSecretSnapshot } from "./secret-observability.js";

const base = {
  NODE_ENV: "test",
  DATABASE_URL: "postgres://app:database-password@database.test/control_hub",
  REDIS_URL: "redis://cache.test:6379",
  BETTER_AUTH_SECRET: "identity-secret-that-is-long-enough",
  CONNECTOR_KEY_RING: JSON.stringify({
    activeKeyId: "2026-08",
    keys: { "2026-08": Buffer.alloc(32, 7).toString("base64") }
  }),
  GOOGLE_OAUTH_CLIENT_ID: "google-client"
};

describe("safe secret boot observations", () => {
  it("reports source and key version without serialising any secret material", () => {
    const environment = parseApiEnvironment({ ...base, SECRETS_PROVIDER: "environment" });
    const snapshot = platformSecretSnapshot(base, environment, "2026-08-26T08:00:00.000Z");
    const json = JSON.stringify(snapshot);

    expect(snapshot.provider).toEqual({
      kind: "environment",
      health: "warning",
      checkedAt: "2026-08-26T08:00:00.000Z"
    });
    expect(snapshot.secrets.find((item) => item.name === "CONNECTOR_KEY_RING")).toMatchObject({
      configured: true,
      source: "environment",
      version: "2026-08"
    });
    expect(snapshot.secrets.find((item) => item.name === "GOOGLE_OAUTH_CLIENT_SECRET")).toMatchObject({
      configured: true,
      source: "not_observed",
      health: "not_observed"
    });
    expect(json).not.toContain("database-password");
    expect(json).not.toContain(Buffer.alloc(32, 7).toString("base64"));
    expect(json).not.toContain("identity-secret-that-is-long-enough");
  });

  it("identifies Bitwarden-backed files without exposing their path or external ID", () => {
    const raw = {
      ...base,
      SECRETS_PROVIDER: "bitwarden",
      DATABASE_URL: undefined,
      DATABASE_URL_FILE: "/run/secrets/database_url"
    };
    const environment = parseApiEnvironment({ ...base, SECRETS_PROVIDER: "bitwarden" });
    const snapshot = platformSecretSnapshot(raw, environment, "2026-08-26T08:00:00.000Z");
    const database = snapshot.secrets.find((item) => item.name === "DATABASE_URL");

    expect(database).toMatchObject({ source: "external_manager", configured: true, health: "available" });
    expect(JSON.stringify(snapshot)).not.toContain("/run/secrets");
  });
});

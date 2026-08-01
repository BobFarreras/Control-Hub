import { describe, expect, it } from "vitest";
import { parseApiEnvironment } from "./index.js";

describe("parseApiEnvironment", () => {
  it("parses a valid local environment", () => {
    expect(parseApiEnvironment({ DATABASE_URL: "postgres://localhost/db", REDIS_URL: "redis://localhost:6379" }).API_PORT).toBe(4000);
  });

  it("rejects a non-postgres database URL", () => {
    expect(() => parseApiEnvironment({ DATABASE_URL: "https://example.com", REDIS_URL: "redis://localhost:6379" })).toThrow();
  });
});

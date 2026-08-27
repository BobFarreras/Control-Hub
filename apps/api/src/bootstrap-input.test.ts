import { describe, expect, it } from "vitest";
import {
  BootstrapInputError,
  generatePassword,
  minimumPasswordLength,
  parseBootstrapInput
} from "./bootstrap-input.js";

const complete = {
  BOOTSTRAP_OWNER_EMAIL: "Owner@Example.com",
  BOOTSTRAP_OWNER_NAME: "  Ada Lovelace  ",
  BOOTSTRAP_TENANT_NAME: "Avant Business",
  BOOTSTRAP_TENANT_SLUG: "avant-business"
} satisfies NodeJS.ProcessEnv;

describe("what the first Owner is created from", () => {
  it("accepts an installation that was never asked for a password", () => {
    // The whole point of the change. The installer asks for an address and a name, and a password
    // is the one answer it must not ask for -- typed it is in the shell history, printed it is in
    // the scrollback, and stored it is on disk for the life of the installation.
    const input = parseBootstrapInput(complete);
    expect(input.passwordIsOurs).toBe(true);
    expect(input.password.length).toBeGreaterThanOrEqual(32);
  });

  it("normalises the address and the names the way a second run would have to match", () => {
    // Re-running the installer has to recognise what is already there (invariant 7), and it can
    // only do that if the same answers produce the same values.
    const input = parseBootstrapInput(complete);
    expect(input.email).toBe("owner@example.com");
    expect(input.name).toBe("Ada Lovelace");
  });

  it("still holds a supplied password to the same floor as everyone else's", () => {
    // Development passes one through `.env`. Arriving in an environment variable does not make a
    // weak password acceptable for the account that owns the installation.
    expect(() => parseBootstrapInput({ ...complete, BOOTSTRAP_OWNER_PASSWORD: "short" })).toThrow(BootstrapInputError);
    const input = parseBootstrapInput({ ...complete, BOOTSTRAP_OWNER_PASSWORD: "x".repeat(minimumPasswordLength) });
    expect(input.passwordIsOurs).toBe(false);
    expect(input.password).toBe("x".repeat(minimumPasswordLength));
  });

  it("refuses an empty password rather than generating one behind it", () => {
    // `BOOTSTRAP_OWNER_PASSWORD=` in a file is somebody trying to set one, not somebody declining
    // to. Treating it as absent would silently create an account nobody could sign into and report
    // success.
    expect(() => parseBootstrapInput({ ...complete, BOOTSTRAP_OWNER_PASSWORD: "" })).toThrow(BootstrapInputError);
  });

  it("names what is missing rather than failing as a whole", () => {
    for (const key of ["BOOTSTRAP_OWNER_EMAIL", "BOOTSTRAP_OWNER_NAME", "BOOTSTRAP_TENANT_NAME"] as const) {
      expect(() => parseBootstrapInput({ ...complete, [key]: "  " }), key).toThrow(new RegExp(key));
    }
  });

  it("refuses a tenant slug that is not one", () => {
    // It reaches URLs and database identifiers. Everything below is a plausible answer to «what is
    // this company called» and none of them is a slug.
    for (const slug of ["Avant Business", "avant_business", "-avant", "a", "AVANT", "avant/business"]) {
      expect(() => parseBootstrapInput({ ...complete, BOOTSTRAP_TENANT_SLUG: slug }), slug).toThrow(
        BootstrapInputError
      );
    }
  });

  it("refuses an address that is not one before creating anything", () => {
    // The reset link is the only way into this account, so an address with a typo in it is an
    // installation nobody owns -- and the bootstrap refuses to run twice, so it is not recoverable
    // by running it again.
    for (const email of ["owner", "owner@example", "owner @example.com", "@example.com"]) {
      expect(() => parseBootstrapInput({ ...complete, BOOTSTRAP_OWNER_EMAIL: email }), email).toThrow(
        BootstrapInputError
      );
    }
  });
});

describe("the password nobody sees", () => {
  it("is different every time", () => {
    const seen = new Set(Array.from({ length: 50 }, () => generatePassword()));
    expect(seen.size).toBe(50);
  });

  it("survives being put in a URL or a shell without being changed", () => {
    // It travels through Better Auth and, in development, through a `.env` file. A character that
    // needs escaping somewhere in that path is a password that arrives different from the one that
    // was set, and the failure appears at sign-in with nothing to point at.
    for (let attempt = 0; attempt < 50; attempt++) expect(generatePassword()).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

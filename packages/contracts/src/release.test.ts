import { describe, expect, it } from "vitest";
import { isNewerVersion, parseReleaseManifest, releaseServices } from "./release.js";

/**
 * The publisher, imported by path rather than by package name.
 *
 * `scripts/release-manifest.mjs` is not a workspace package and deliberately is not one: it runs
 * inside the release workflow, in plain Node, on a checkout nobody has built. That is exactly why
 * this import exists. Two programs describe one file format, and the only thing standing between
 * them and a silent divergence is a test that runs both.
 */
const publisher = (await import(new URL("../../../scripts/release-manifest.mjs", import.meta.url).href)) as {
  buildManifest: (input: unknown) => Record<string, unknown>;
  releaseWork: (paths: string[]) => { migrations: number; configuration: boolean };
};

const digest = (byte: string) => `sha256:${byte.repeat(64)}`;
const published = (overrides: Record<string, unknown> = {}) =>
  publisher.buildManifest({
    version: "1.1.0",
    commit: "a".repeat(40),
    released: "2026-08-27T10:00:00Z",
    registry: "ghcr.io/bobfarreras",
    digests: { api: digest("1"), worker: digest("2"), migrate: digest("3"), web: digest("4") },
    work: { migrations: 2, configuration: true },
    ...overrides
  });

/** Serialised the way the workflow writes it: pretty printed, with a trailing newline. */
const asFile = (manifest: unknown) => `${JSON.stringify(manifest, null, 2)}\n`;

describe("reading a published manifest", () => {
  it("accepts what the publisher produces, field for field", () => {
    const manifest = parseReleaseManifest(asFile(published()));
    expect(manifest.version).toBe("1.1.0");
    expect(manifest.released).toBe("2026-08-27T10:00:00Z");
    expect(manifest.commit).toBe("a".repeat(40));
    expect(manifest.work).toEqual({ migrations: 2, configuration: true });
    for (const service of releaseServices) {
      expect(manifest.images[service]).toBe(
        `ghcr.io/bobfarreras/control-hub-${service}@${digest(
          { api: "1", worker: "2", migrate: "3", web: "4" }[service]
        )}`
      );
    }
  });

  it("reads the same work the publisher computed from the changed paths", () => {
    // The two signals the banner exists to carry. Computed at publication time because an
    // installation cannot work them out from a version number, and asserted through the
    // publisher's own function so the meaning of the count stays one thing.
    const work = publisher.releaseWork([
      "packages/database/migrations/0059_installation_update.sql",
      "packages/database/migrations/0060_something_else.sql",
      "apps/web/src/app/styles.css"
    ]);
    const manifest = parseReleaseManifest(asFile(published({ work })));
    expect(manifest.work).toEqual({ migrations: 2, configuration: false });
  });

  it("refuses a manifest that is plausible rather than correct", () => {
    // Each of these reads as a release. The second is the one that matters: four references that
    // each look right but come from two registries is not a shape a release can have, and is
    // exactly the shape a substituted image would have.
    const corruptions: Record<string, (manifest: Record<string, unknown>) => unknown> = {
      "an image by tag rather than digest": (manifest) => ({
        ...manifest,
        images: { ...(manifest.images as object), api: "ghcr.io/bobfarreras/control-hub-api:1.1.0" }
      }),
      "one image from somewhere else": (manifest) => ({
        ...manifest,
        images: { ...(manifest.images as object), web: `docker.io/someone/control-hub-web@${digest("5")}` }
      }),
      // Pinned by something that is shaped like a pin and is not one. The `@` alone is what a
      // shallow check looks for, and it is the half an attacker gets for free.
      "a digest that is not a digest": (manifest) => ({
        ...manifest,
        images: { ...(manifest.images as object), api: "ghcr.io/bobfarreras/control-hub-api@sha256:deadbeef" }
      }),
      "an image renamed": (manifest) => ({
        ...manifest,
        images: { ...(manifest.images as object), worker: `ghcr.io/bobfarreras/control-hub-workr@${digest("2")}` }
      }),
      "a missing service": (manifest) => {
        const { migrate: _migrate, ...images } = manifest.images as Record<string, string>;
        return { ...manifest, images };
      },
      "a schema this code has never seen": (manifest) => ({ ...manifest, schema: 2 }),
      "a version that is not a version": (manifest) => ({ ...manifest, version: "latest" }),
      "a short commit": (manifest) => ({ ...manifest, commit: "a".repeat(7) }),
      "a released date with no timezone": (manifest) => ({ ...manifest, released: "2026-08-27T10:00:00" }),
      "a migration count that is not a count": (manifest) => ({
        ...manifest,
        work: { migrations: "two", configuration: true }
      }),
      // The reason the round trip exists: an extra key survives every field check above and does
      // not survive being rebuilt.
      "a field nobody validated": (manifest) => ({ ...manifest, notes: "https://example.test/notes" })
    };

    for (const [what, corrupt] of Object.entries(corruptions)) {
      expect(() => parseReleaseManifest(asFile(corrupt(published()))), what).toThrow(/RELEASE_MANIFEST_INVALID/);
    }
  });

  it("refuses what is not a manifest at all", () => {
    for (const text of ["", "{", "null", "[]", '"a string"', "{}"]) {
      expect(() => parseReleaseManifest(text), JSON.stringify(text)).toThrow(/RELEASE_MANIFEST_INVALID/);
    }
  });

  it("refuses everything the publisher would refuse to write", () => {
    // The conformance check proper, run in the one direction that can be run: whatever the
    // publisher will not produce, the reader will not accept. The publisher validates on the way
    // out and this validates on the way in, and a rule that exists on only one side is the shape
    // divergence takes.
    const rejected = [
      { version: "1.1" },
      { commit: "not-a-commit" },
      { released: "yesterday" },
      { registry: "ghcr.io/BobFarreras" },
      { digests: { api: digest("1"), worker: digest("2"), migrate: digest("3") } },
      { work: { migrations: -1, configuration: true } }
    ];
    for (const overrides of rejected) {
      expect(() => published(overrides), JSON.stringify(overrides)).toThrow(/RELEASE_MANIFEST_INVALID/);
    }
  });
});

describe("deciding an update exists", () => {
  it("orders versions rather than comparing them for inequality", () => {
    expect(isNewerVersion("1.1.0", "1.0.0")).toBe(true);
    expect(isNewerVersion("1.0.1", "1.0.0")).toBe(true);
    expect(isNewerVersion("2.0.0", "1.9.9")).toBe(true);
    // The one string comparison gets wrong, and the reason this is not `!==`.
    expect(isNewerVersion("1.10.0", "1.9.0")).toBe(true);
    expect(isNewerVersion("1.9.0", "1.10.0")).toBe(false);
  });

  it("says no to the same version and to an older one", () => {
    expect(isNewerVersion("1.0.0", "1.0.0")).toBe(false);
    // An installation deliberately ahead of the published tag must not be told to go backwards.
    expect(isNewerVersion("1.0.0", "1.1.0")).toBe(false);
  });

  it("refuses to guess when either side is not a version", () => {
    for (const [candidate, installed] of [
      ["latest", "1.0.0"],
      ["1.0.0", "development"],
      ["1.0", "1.0.0"],
      ["", ""]
    ]) {
      expect(isNewerVersion(candidate!, installed!), `${candidate} over ${installed}`).toBe(false);
    }
  });
});

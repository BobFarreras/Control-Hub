import { readFileSync } from "node:fs";
import { defineConfig } from "tsup";

/**
 * Workspace packages are bundled because their `exports` point at TypeScript sources that
 * node cannot load. Everything else stays external: the image ships node_modules anyway, so
 * bundling third party code buys nothing and breaks anything that calls `require` at runtime.
 *
 * pino does exactly that, and because it is a dependency of @control-hub/observability rather
 * than of this app, tsup's default externalisation did not cover it. The bundle then failed on
 * boot with "Dynamic require of os is not supported", so this binary had never run.
 */
export default defineConfig({
  entry: ["src/server.ts"],
  format: ["esm"],
  platform: "node",
  target: "node22",
  bundle: true,
  clean: true,
  sourcemap: true,
  noExternal: [/^@control-hub\//],
  external: [/^(?!@control-hub\/)(?![./])/],

  // The runtime stage of the image carries `dist` and `node_modules` only, so the manifest is
  // not there to be read. The version is stamped in here instead, from that same manifest, and
  // `src/version.ts` explains what happens when this define is absent.
  define: {
    __API_VERSION__: JSON.stringify(
      (JSON.parse(readFileSync(new URL("package.json", import.meta.url), "utf8")) as { version: string }).version
    ),
    // Empty on every build that does not pass one, which is every build outside the release
    // workflow. `src/version.ts` turns that into `development` rather than shelling out to git:
    // the builder stage does have a checkout, but a value meant to identify an image has to be
    // decided by whoever is producing the image, not inferred from whatever source tree is lying
    // around when the bundler runs.
    __API_BUILD__: JSON.stringify(process.env.CONTROL_HUB_BUILD ?? "")
  }
});

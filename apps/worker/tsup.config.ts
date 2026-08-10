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
  entry: ["src/index.ts"],
  format: ["esm"],
  platform: "node",
  target: "node22",
  bundle: true,
  clean: true,
  sourcemap: true,
  noExternal: [/^@control-hub\//],
  external: [/^(?!@control-hub\/)(?![./])/]
});

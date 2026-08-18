/**
 * The version this build is, from the one place that already records it.
 *
 * It cannot simply be read at runtime. `deploy/Dockerfile` copies `node_modules` and `dist` into
 * the runtime stage and nothing else, so there is no `package.json` beside the running server;
 * a read there would turn a wrong number into a crash on boot, which is worse.
 *
 * So it is stamped into the bundle by tsup at build time, and read from the manifest only when
 * there is no bundle — tests and `tsx`, where the file is certainly present. Two paths, one
 * source of truth. What must never come back is the third option: a number written by hand next
 * to the OpenAPI registration, which is what made the published document claim `0.1.0` for the
 * whole of `v0.2.0` without anything going red.
 */
import { readFileSync } from "node:fs";

/** Replaced with a string literal by tsup. Undefined everywhere the bundler did not run. */
declare const __API_VERSION__: string | undefined;

export function apiVersion(): string {
  // `typeof` on an undeclared name is the one form that does not throw, which is what makes the
  // same expression work in the bundle and outside it.
  if (typeof __API_VERSION__ === "string") return __API_VERSION__;

  const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
    version?: string;
  };
  if (!manifest.version) throw new Error("apps/api/package.json declares no version");
  return manifest.version;
}

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

/** Replaced with a string literal by tsup, empty unless the build passed one. */
declare const __API_BUILD__: string | undefined;

/**
 * Which build this is, for the case where two of them share a version number.
 *
 * `develop` publishes an image per commit, so every one between two tags reports the same `0.3.0`.
 * Without something else to tell them apart, "you are running the latest" is a claim nobody can
 * check on exactly the images where checking matters — the ones being tested because something
 * looks wrong.
 *
 * Stamped the same way the version is, and for the same reason: the runtime stage carries `dist`
 * and `node_modules` and nothing else, so there is no git repository to ask and no manifest to
 * read.
 *
 * Outside a release build — a local `pnpm build`, the tests, `tsx` — there is no answer, and this
 * says so instead of inventing one. `development` is a true statement about where the code came
 * from; a fabricated hash would be a false one, and this value exists to be trusted when somebody
 * is comparing two installations.
 */
export function apiBuild(): string {
  if (typeof __API_BUILD__ === "string" && __API_BUILD__.length > 0) return __API_BUILD__;
  return "development";
}

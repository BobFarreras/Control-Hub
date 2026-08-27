/**
 * The version this build is, resolved the way `apps/api/src/version.ts` already resolves it.
 *
 * The same problem and therefore the same answer: `deploy/Dockerfile` copies `node_modules` and
 * `dist` into the runtime stage and nothing else, so there is no `package.json` beside the running
 * process. tsup stamps a literal at build time, and the manifest is read only where there is no
 * bundle -- tests and `tsx`, where the file is certainly present.
 *
 * The worker needs it for one thing: deciding whether the published version is newer than this
 * one. Getting that wrong in the optimistic direction shows a banner for a version somebody is
 * already running, which is why the comparison refuses to guess at anything that is not a version.
 */
import { readFileSync } from "node:fs";

/** Replaced with a string literal by tsup. Undefined everywhere the bundler did not run. */
declare const __WORKER_VERSION__: string | undefined;

export function workerVersion(): string {
  // `typeof` on an undeclared name is the one form that does not throw, which is what makes the
  // same expression work in the bundle and outside it.
  if (typeof __WORKER_VERSION__ === "string") return __WORKER_VERSION__;

  const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
    version?: string;
  };
  if (!manifest.version) throw new Error("apps/worker/package.json declares no version");
  return manifest.version;
}

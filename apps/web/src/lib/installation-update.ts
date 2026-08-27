import type { ReleaseSummary } from "@control-hub/contracts/release";

/**
 * The part of the update notice the browser is allowed to have.
 *
 * Nothing here reaches the network or the session; reading what the worker found is
 * `pendingUpdate` in `./pending-update`, which is server-only because `@/lib/api` uses
 * `next/headers`. Keeping the two apart is what lets the banner be a client component.
 */

/**
 * What work the update represents, in the order somebody should read it.
 *
 * The banner exists to say this. A notice that only says «there is a new version» moves the
 * decision of whether to act without handing over anything to decide it with, and the thing it
 * moves the decision to is an evening when something else is already broken.
 *
 * An empty list is a real answer and a useful one: no migrations and no configuration change
 * means the update is a pull and a restart, which is the case where somebody may reasonably do
 * it now rather than on Saturday.
 */
export function updateWorkItems(available: ReleaseSummary): ("migrations" | "configuration")[] {
  return [
    ...(available.migrations > 0 ? (["migrations"] as const) : []),
    ...(available.configuration ? (["configuration"] as const) : [])
  ];
}

/**
 * Where to read about the version, built from the version number rather than carried in the
 * manifest.
 *
 * The manifest deliberately contains no URLs -- see `packages/contracts/src/release.ts` -- and
 * this is the reason that costs nothing: a release's notes live at a predictable address, so the
 * file does not have to carry a link that would then be a link an attacker could choose. The
 * version is checked against the shape of a version before it is interpolated, so nothing that
 * is not `1.2.3` can reach an `href`.
 */
export function releaseNotesUrl(version: string): string | null {
  return /^\d+\.\d+\.\d+$/.test(version) ? `https://github.com/BobFarreras/Control-Hub/releases/tag/v${version}` : null;
}

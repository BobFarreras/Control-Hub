import type { UpdateCheckState } from "@control-hub/contracts/release";
import { apiFetch, readJson } from "@/lib/api";
import type { InstallationResponse } from "@/lib/api-types";

/**
 * What the worker last found, read on the server for the person whose session this is.
 *
 * Answers null for every reason the banner should simply not appear: nobody is signed in, this
 * person is neither Owner nor Administrator, no check has run, or the API is not answering. None
 * of those is worth an error on screen -- the layout renders on the sign-in page too, where there
 * is no session by definition.
 *
 * Note where this runs. The browser never asks GitHub anything; it asks this installation what
 * this installation already knew. That is condition 1 of D5, and it is a property of the whole
 * arrangement rather than of any one file, so it is worth saying here as well as in the worker.
 *
 * It lives apart from `installation-update.ts` for a reason the build enforces: `@/lib/api` reads
 * `next/headers`, so anything that imports it is server-only, and the banner is a client
 * component that needs the pure helpers next door.
 */
export async function pendingUpdate(): Promise<UpdateCheckState | null> {
  try {
    const response = await apiFetch("/api/v1/settings/installation");
    if (!response.ok) return null;
    return (await readJson<InstallationResponse>(response)).updateCheck;
  } catch {
    return null;
  }
}

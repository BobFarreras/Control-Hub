import { isNewerVersion, type UpdateCheckState } from "@control-hub/contracts/release";
import { ApiSecurityError, resolveTenantContext } from "../security.js";
import { apiBuild, apiVersion } from "../version.js";
import type { RouteContext } from "./context.js";

/** What this installation is, for the people who would act on it being out of date. */
export type Installation = { version: string; build: string };

/** What it is, plus what the worker last found out there. */
export type InstallationReport = Installation & { updateCheck: UpdateCheckState | null };

export type InstallationRouteContext = RouteContext & {
  /** Resolved from the bundle when absent; injected by tests, which have no bundle to read. */
  installation?: Installation;
  /**
   * What the worker left in Valkey after its daily look, or null when there is nothing there.
   *
   * A reader rather than a value: the answer changes while the process runs, unlike the two
   * fields above it. Absent in tests that have no Valkey, which is the same as never having
   * checked -- and never having checked is a state this route has to answer for anyway, because
   * an installation with the check switched off is permanently in it.
   */
  updateCheck?: () => Promise<UpdateCheckState | null>;
};

/**
 * Which version, which build, and whether a newer one exists, told to Owner and Administrator only.
 *
 * The version alone is already public on `/health/live`, and has to be: the web tier proxies
 * `/health/*`, and a readiness probe has no session to authenticate with. The build identifier is
 * not there and should not be. It names the exact commit an installation runs, which turns a
 * question somebody has to research -- is this instance carrying that defect? -- into one they can
 * answer from outside with a single unauthenticated request.
 *
 * Owner and Administrator rather than every member, because this exists to be acted on. A reader
 * who cannot update the installation gains nothing from knowing its commit, and the value has
 * travelled one session further than it needed to. The same reasoning covers the update: it is a
 * sentence saying somebody should run a command, so it goes to the people who can run it.
 *
 * Nothing here reaches the network. The worker did that, once, at a time of its own choosing --
 * `docs/specifications/deployment.md` (D5) -- and this reads what it wrote. A request handler that
 * fetched a manifest would make every person who opened a screen into a caller of GitHub, which
 * is the arrangement the specification exists to rule out.
 */
export function registerInstallationRoutes({
  app,
  auth,
  database,
  installation,
  updateCheck
}: InstallationRouteContext) {
  // Read once. Neither value can change while the process runs -- both are literals stamped into
  // the bundle -- so re-deriving them per request would only obscure that.
  const reported: Installation = installation ?? { version: apiVersion(), build: apiBuild() };

  /**
   * The stored answer, checked against this process before it is passed on.
   *
   * The worker clears a pending update on its next daily pass, which leaves up to a day in which
   * the stored state names a version this installation is already running -- exactly the day
   * somebody has just updated and is looking at the screen to confirm it worked. Comparing here
   * costs nothing and closes that window, and a banner that lies once is a banner nobody reads
   * again.
   */
  async function currentUpdateCheck(): Promise<UpdateCheckState | null> {
    if (!updateCheck) return null;
    const state = await updateCheck();
    if (!state) return null;
    if (state.available && !isNewerVersion(state.available.version, reported.version))
      return { checkedAt: state.checkedAt, available: null };
    return state;
  }

  app.get(
    "/api/v1/settings/installation",
    {
      config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
      schema: {
        tags: ["identity"],
        summary: "Read the version and build of this installation, and whether a newer one exists",
        description:
          "Owner and Administrator only. The build identifier names the exact commit and is deliberately absent from the public health routes. `updateCheck` is what the worker found the last time it read the published release manifest; it is null when no check has run, including when the check is switched off."
      }
    },
    async (request): Promise<InstallationReport> => {
      const context = await resolveTenantContext(auth, database, request);
      if (!context.roles.some((role) => role === "owner" || role === "administrator"))
        throw new ApiSecurityError(403, "PERMISSION_DENIED");
      return { ...reported, updateCheck: await currentUpdateCheck() };
    }
  );
}

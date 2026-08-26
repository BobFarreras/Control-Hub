import { ApiSecurityError, resolveTenantContext } from "../security.js";
import { apiBuild, apiVersion } from "../version.js";
import type { RouteContext } from "./context.js";

/** What this installation is, for the people who would act on it being out of date. */
export type Installation = { version: string; build: string };

export type InstallationRouteContext = RouteContext & {
  /** Resolved from the bundle when absent; injected by tests, which have no bundle to read. */
  installation?: Installation;
};

/**
 * Which version and which build, told to Owner and Administrator only.
 *
 * The version alone is already public on `/health/live`, and has to be: the web tier proxies
 * `/health/*`, and a readiness probe has no session to authenticate with. The build identifier is
 * not there and should not be. It names the exact commit an installation runs, which turns a
 * question somebody has to research -- is this instance carrying that defect? -- into one they can
 * answer from outside with a single unauthenticated request.
 *
 * Owner and Administrator rather than every member, because this exists to be acted on. A reader
 * who cannot update the installation gains nothing from knowing its commit, and the value has
 * travelled one session further than it needed to.
 */
export function registerInstallationRoutes({ app, auth, database, installation }: InstallationRouteContext) {
  // Read once. Neither value can change while the process runs -- both are literals stamped into
  // the bundle -- so re-deriving them per request would only obscure that.
  const reported: Installation = installation ?? { version: apiVersion(), build: apiBuild() };

  app.get(
    "/api/v1/settings/installation",
    {
      config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
      schema: {
        tags: ["identity"],
        summary: "Read the version and build of this installation",
        description:
          "Owner and Administrator only. The build identifier names the exact commit and is deliberately absent from the public health routes."
      }
    },
    async (request) => {
      const context = await resolveTenantContext(auth, database, request);
      if (!context.roles.some((role) => role === "owner" || role === "administrator"))
        throw new ApiSecurityError(403, "PERMISSION_DENIED");
      return reported;
    }
  );
}

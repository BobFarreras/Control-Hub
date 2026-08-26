import type { SecretObservation, SecretProviderObservation } from "../secret-observability.js";
import { ApiSecurityError, resolveTenantContext } from "../security.js";
import type { RouteContext } from "./context.js";

export type SecretsRouteContext = RouteContext & {
  secretSnapshot: { provider: SecretProviderObservation; secrets: SecretObservation[] };
};

/** Owner-only, read-only metadata. No route in this module accepts or returns a secret value. */
export function registerSecretRoutes({ app, auth, database, secretSnapshot }: SecretsRouteContext) {
  app.get(
    "/api/v1/settings/secrets",
    {
      schema: {
        tags: ["identity"],
        summary: "Read safe platform-secret metadata",
        description:
          "Owner-only boot observations: source class, configuration state, consumers and health. Values, paths and external IDs are never returned."
      }
    },
    async (request) => {
      const context = await resolveTenantContext(auth, database, request);
      if (!context.roles.includes("owner")) throw new ApiSecurityError(403, "PERMISSION_DENIED");
      return secretSnapshot;
    }
  );
}

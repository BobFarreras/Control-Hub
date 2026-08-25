import { McpOauthService } from "@control-hub/application";
import { isFeatureEnabled, type FeatureFlagSet } from "@control-hub/config";
import type { DatabaseClient } from "@control-hub/database";
import { NodeMcpCrypto, PostgresMcpOauthRepository } from "@control-hub/persistence";
import { registerMcpOauthRoutes } from "./routes/mcp-oauth.js";
import type { ControlHubApp } from "./server-instance.js";

/**
 * Everything the MCP surface needs, assembled in one place.
 *
 * It exists so the composition root gains one call rather than a paragraph. That is not only
 * tidiness: the two conditions below are what decide whether this installation is an OAuth server
 * at all, and a reader looking for that answer should find it in one function instead of
 * reconstructing it from a flag test in one file and a null check in another.
 *
 * Specification: `docs/specifications/mcp-and-client-portal.md`.
 */
export function registerMcpRoutes(context: {
  app: ControlHubApp;
  database: DatabaseClient;
  featureFlags: FeatureFlagSet;
  /**
   * The public origin of this API, from validated configuration.
   *
   * Absent means no routes. An authorization server that does not know its own name would have to
   * take one from a request header, and a token whose audience the caller chooses protects
   * nothing -- which is the whole reason the audience is checked at all.
   */
  issuer: string | undefined;
}): McpOauthService | null {
  if (!isFeatureEnabled(context.featureFlags, "mcp") || !context.issuer) return null;

  const mcp = new McpOauthService({
    repository: new PostgresMcpOauthRepository(context.database),
    crypto: new NodeMcpCrypto(),
    issuer: context.issuer
  });
  registerMcpOauthRoutes({ app: context.app, mcp });
  // Returned so the increments that follow -- the consent screen, the management routes and the
  // transport -- wire onto the same instance rather than building a second one with its own clock.
  return mcp;
}

import {
  CrmService,
  InfrastructureService,
  McpOauthService,
  McpSessionService,
  SupportService,
  UsageService,
  observationBudgets
} from "@control-hub/application";
import { isFeatureEnabled, type FeatureFlagSet } from "@control-hub/config";
import { connectorRegistry } from "@control-hub/connectors";
import type { DatabaseClient } from "@control-hub/database";
import {
  NodeMcpCrypto,
  PostgresCrmRepository,
  PostgresInfrastructureRepository,
  PostgresMcpOauthRepository,
  PostgresMcpSessionRepository,
  PostgresSupportRepository,
  PostgresUsageRepository
} from "@control-hub/persistence";
import type { ControlHubAuth } from "./auth.js";
import { registerMcpManagementRoutes } from "./routes/mcp-management.js";
import { registerMcpOauthRoutes } from "./routes/mcp-oauth.js";
import { registerMcpTransportRoutes } from "./routes/mcp-transport.js";
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
  /**
   * Absent means the management routes are not declared at all.
   *
   * They are the only part of this surface that acts for a person rather than for an agent, so
   * they need a session to resolve. The OAuth endpoints and the transport do not: one holds a
   * code and the other holds a token, and both have to work on an installation configured without
   * interactive authentication.
   */
  auth: ControlHubAuth | undefined;
}): McpOauthService | null {
  if (!isFeatureEnabled(context.featureFlags, "mcp") || !context.issuer) return null;

  const crypto = new NodeMcpCrypto();
  const repository = new PostgresMcpOauthRepository(context.database);
  const mcp = new McpOauthService({ repository, crypto, issuer: context.issuer });
  registerMcpOauthRoutes({ app: context.app, mcp });

  const session = new McpSessionService({
    // The same store the endpoints mint through, so a token stops working here at the moment it is
    // revoked there and not one read later.
    tokens: repository,
    sessions: new PostgresMcpSessionRepository(context.database),
    services: {
      crm: new CrmService(new PostgresCrmRepository(context.database)),
      support: new SupportService(new PostgresSupportRepository(context.database)),
      infrastructure: new InfrastructureService(
        new PostgresInfrastructureRepository(context.database),
        // Derived from the manifests, exactly as the REST surface derives them: a collector shipped
        // with a different cadence must not need a second place to be told about it.
        observationBudgets(connectorRegistry.types().map((type) => connectorRegistry.require(type))),
        // No tool in the catalogue reaches the one method that inspects an address, so there is no
        // allowlist to consult here. Throwing rather than answering `false` is deliberate: if a
        // later tool ever does reach it, this fails loudly instead of quietly reporting that every
        // host in the deployment is off the list.
        () => {
          throw new Error("the MCP catalogue reaches no read that inspects an address");
        }
      ),
      usage: new UsageService(new PostgresUsageRepository(context.database)),
      clock: () => new Date()
    },
    crypto,
    // Built from the service rather than assembled again here, so the audience a token is minted
    // for and the audience it is checked against cannot drift apart.
    identity: { issuer: context.issuer, audience: mcp.audience },
    // A flag says what this installation deploys, never who may use it. A tool whose module is
    // closed is not listed and cannot be called, and answers exactly as an unknown name does.
    isDeployed: (flag) => flag === null || isFeatureEnabled(context.featureFlags, flag)
  });
  registerMcpTransportRoutes({ app: context.app, session, crypto, issuer: context.issuer });

  if (context.auth)
    registerMcpManagementRoutes({
      app: context.app,
      database: context.database,
      auth: context.auth,
      // The same instance the endpoints mint through: a client registered here is one the token
      // endpoint can already resolve, and a consent withdrawn here stops the next call rather than
      // the one after some other object's cache notices.
      mcp
    });

  // Returned so the increment that follows -- the consent screen -- wires onto the same instance
  // rather than building a second one with its own clock.
  return mcp;
}

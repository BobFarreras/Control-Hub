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

  // Returned so the increments that follow -- the consent screen and the management routes --
  // wire onto the same instance rather than building a second one with its own clock.
  return mcp;
}

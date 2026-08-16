import { ConnectorError, type RegisteredConnector } from "./contract.js";

/**
 * The connectors this installation knows about, resolved once at build time.
 *
 * Per ADR-0004 nothing is loaded at runtime: a connector arrives with a release, reviewed and
 * typed, rather than as code fetched from somewhere and trusted. The registry is therefore a
 * lookup and nothing more — it has no register-at-runtime door for the same reason.
 */
export type ConnectorRegistry = {
  types(): readonly string[];
  find(type: string): RegisteredConnector | null;
  /** For a caller that already established the type exists, such as a stored instance row. */
  require(type: string): RegisteredConnector;
};

export function createConnectorRegistry(connectors: readonly RegisteredConnector[]): ConnectorRegistry {
  const byType = new Map<string, RegisteredConnector>();
  for (const connector of connectors) {
    if (byType.has(connector.type)) throw new ConnectorError("DUPLICATE_CONNECTOR_TYPE");
    byType.set(connector.type, connector);
  }

  const types = [...byType.keys()].sort();
  return {
    types: () => types,
    find: (type) => byType.get(type) ?? null,
    require: (type) => {
      const connector = byType.get(type);
      if (!connector) throw new ConnectorError("UNKNOWN_CONNECTOR_TYPE");
      return connector;
    }
  };
}

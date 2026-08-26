import {
  ConnectorCredentialError,
  ConnectorActionError,
  ConnectorOAuthError,
  ConnectorServiceError,
  ConnectorStorageError,
  InfrastructureServiceError,
  CredentialCatalogError,
  McpOauthError
} from "@control-hub/application";
import { ApiSecurityError } from "./security.js";

/**
 * RFC 9457 problem details, for the connector surface.
 *
 * The rest of this API answers `{ code, requestId }`, which predates
 * `docs/specifications/errors-and-api.md`. Migrating every route is a change to every screen that
 * reads an error, and it is not what this increment is for; the connector routes are written to
 * the specification from the start and the older ones keep their envelope until somebody moves
 * them deliberately. What both shapes share is `code`, which is what the UI localises and what
 * logs and metrics count — the part that had to stay stable.
 *
 * `code` is UPPER_SNAKE here, as everywhere else in this API. The example in the specification is
 * lowercase; one house convention that every module follows is worth more than matching an
 * illustration, and a mixed-case `code` would be an i18n key nobody can predict.
 */

export type ProblemDetails = {
  type: string;
  title: string;
  status: number;
  code: string;
  instance: string;
  requestId: string;
  /** Extra context a client can act on. Never a submitted value, never a provider's message. */
  params?: Record<string, unknown>;
};

export const problemContentType = "application/problem+json";

const problemNamespace = "https://control-hub.example/problems/";

/**
 * Titles are written here rather than derived, so a new code cannot silently ship a sentence
 * nobody read. They are English, short, and say nothing about the caller's data — a title reaches
 * logs and support tickets, and a person's configuration must not travel with it.
 */
const titles: Record<string, string> = {
  AUTHENTICATION_REQUIRED: "Authentication required",
  PERMISSION_DENIED: "Permission denied",
  MFA_REQUIRED: "Second factor required",
  SESSION_NOT_FRESH: "Sign in again to confirm this",
  TENANT_ACCESS_DENIED: "Tenant access denied",
  TENANT_SELECTION_REQUIRED: "Tenant selection required",
  FORBIDDEN: "Permission denied",
  INVALID_INPUT: "Invalid request",
  INVALID_CONFIG: "Invalid configuration",
  INVALID_NAME: "Invalid name",
  INVALID_KIND: "Invalid credential kind",
  INVALID_IDEMPOTENCY_KEY: "Invalid idempotency key",
  UNKNOWN_CONNECTOR_TYPE: "Unknown connector type",
  INSTANCE_NOT_FOUND: "Integration not found",
  MIGRATION_REQUIRED: "The module's migrations are not applied",
  INSTANCE_NOT_ENABLED: "Integration is not enabled",
  INGRESS_NOT_SUPPORTED: "This connector receives no webhooks",
  ENDPOINT_ALREADY_EXISTS: "The integration already has an endpoint",
  ENDPOINT_NOT_FOUND: "Endpoint not found",
  // The one answer an inbound delivery ever gets when it is not accepted, whatever the reason.
  NOT_FOUND: "Not found",
  INVALID_PAYLOAD: "The payload could not be read",
  PAYLOAD_TOO_LARGE: "Payload too large",
  UNSUPPORTED_MEDIA_TYPE: "Unsupported content type",
  RATE_LIMITED: "Too many requests",
  // The MCP surface. A token this server will not accept is one title whatever was wrong with it,
  // except for expiry, which is the one a client can act on by refreshing.
  MCP_TOKEN_INVALID: "The token was not accepted",
  MCP_TOKEN_EXPIRED: "The token has expired",
  MCP_AUDIENCE_INVALID: "The token was issued for another resource",
  MCP_SCOPE_INSUFFICIENT: "The token does not carry that scope",
  MCP_SESSION_UNKNOWN: "No such session",
  // The management surface. These reach a screen somebody is looking at, not an agent, so they
  // say which of the three things was not there rather than collapsing into one answer -- the
  // caller already holds `security:manage` for this tenant and learns nothing by being told.
  MCP_REQUEST_INVALID: "The request is missing or malformed",
  MCP_SCOPE_UNAVAILABLE: "That scope cannot be granted here",
  MCP_REDIRECT_URI_MISMATCH: "The redirect address is not usable",
  MCP_CLIENT_UNKNOWN: "No such client",
  MCP_GRANT_UNKNOWN: "No such consent",
  MCP_SERVICE_ACCOUNT_UNKNOWN: "No such service account",
  DUPLICATE_INSTANCE_NAME: "An integration already uses that name",
  DUPLICATE_ENTRY: "Already exists",
  CREDENTIAL_SLOT_TAKEN: "A rotation is already open",
  ROTATION_ALREADY_OPEN: "A rotation is already open",
  NO_ROTATION_IN_PROGRESS: "No rotation to finish",
  SECRET_TOO_SHORT: "Secret too short",
  SECRET_TOO_LONG: "Secret too long",
  ALREADY_EXPIRED: "Expiry is in the past",
  OAUTH_NOT_DECLARED: "This connector does not use OAuth",
  OAUTH_PROVIDER_NOT_CONFIGURED: "OAuth provider is not configured",
  OAUTH_STATE_INVALID: "OAuth state is invalid or expired",
  ACTION_NOT_DECLARED: "This connector does not declare the action",
  ACTION_CONFIRMATION_INVALID: "Action confirmation is invalid or expired",
  ACTION_MFA_REQUIRED: "A recent second factor is required",
  ACTION_NOT_FOUND: "No such connector action",
  IDEMPOTENCY_KEY_INVALID: "Idempotency key is invalid",
  IDEMPOTENCY_KEY_REUSED: "Idempotency key was reused with different content",
  MAIL_RECIPIENT_MISSING: "The customer has no billing email",
  RULE_NOT_FOUND: "No such alert rule",
  ALERT_NOT_FOUND: "No such alert",
  DUPLICATE_RULE_NAME: "An alert rule already uses that name",
  ALERT_ALREADY_HAS_INCIDENT: "That alert already opened an incident",
  INVALID_FRESHNESS: "Freshness must be between a minute and a day",
  TARGET_REQUIRED: "A rule watching one automation needs to say which",
  TARGET_NOT_ALLOWED: "A rule watching the whole instance names no automation",
  NOTES_TOO_LONG: "Note too long",
  HOST_NOT_FOUND: "No such host",
  SERVICE_NOT_FOUND: "No such service",
  DUPLICATE_HOST_NAME: "A host already uses that name",
  DUPLICATE_HOSTNAME: "A host already answers to that label",
  DUPLICATE_SERVICE_NAME: "That host already has a service with that name",
  DUPLICATE_MATCH_KEY: "Something already watches that",
  INVALID_HOSTNAME: "Invalid host label",
  INVALID_MATCH_KEY: "Invalid match key",
  REFERENCE_NOT_FOUND: "Refers to something that does not exist",
  CREDENTIAL_ENTRY_NOT_FOUND: "Credential entry not found",
  PASSWORD_MANAGER_INSTALLATION_NOT_FOUND: "Password manager installation not found",
  CREDENTIAL_ENTRY_INVALID_TRANSITION: "Credential entry cannot make that transition",
  CREDENTIAL_ENTRY_CONFLICT: "Credential entry changed concurrently",
  INTERNAL_ERROR: "Unexpected error"
};

/**
 * Which routes answer in problem details.
 *
 * A prefix rather than a per-route flag: these are the surfaces written to the
 * error specification, and a route added under them later gets the same envelope without anybody
 * having to remember to ask for it.
 */
export function usesProblemDetails(url: string): boolean {
  return (
    url.startsWith("/api/v1/integrations") ||
    url.startsWith("/api/v1/connectors") ||
    url.startsWith("/api/v1/infrastructure") ||
    url.startsWith("/api/v1/credential-catalog") ||
    url.startsWith("/api/v1/password-manager") ||
    // The MCP management surface, which was written to the error specification from the start --
    // but not the OAuth endpoints beneath it. Those answer in RFC 6749's own envelope, because
    // what calls them is a generic OAuth client that branches on `error` and has never heard of
    // problem details. The two live under one prefix and speak two protocols, so the boundary has
    // to be drawn by path rather than assumed.
    (url.startsWith("/api/v1/mcp/") && !url.startsWith("/api/v1/mcp/oauth"))
  );
}

export function problemDetails(input: {
  status: number;
  code: string;
  instance: string;
  requestId: string;
  params?: Record<string, unknown>;
}): ProblemDetails {
  return {
    type: problemNamespace + input.code.toLowerCase().replaceAll("_", "-"),
    title: titles[input.code] ?? titles.INTERNAL_ERROR!,
    status: input.status,
    code: input.code,
    instance: input.instance,
    requestId: input.requestId,
    ...(input.params ? { params: input.params } : {})
  };
}

/**
 * What status a connector failure deserves, and nothing about how it is sent.
 *
 * Kept as a pure function so the table below is a test rather than a route somebody has to
 * exercise through a socket. Null means this is not an error the connector surface knows, and the
 * caller falls back to 500 — an error nobody classified is a bug of ours, not the caller's.
 */
export function describeConnectorError(
  error: unknown
): { status: number; code: string; params?: Record<string, unknown> } | null {
  if (error instanceof ApiSecurityError) return { status: error.statusCode, code: error.code };

  if (error instanceof CredentialCatalogError) {
    const status =
      error.code === "FORBIDDEN" || error.code === "MFA_REQUIRED"
        ? 403
        : error.code.endsWith("NOT_FOUND")
          ? 404
          : error.code.endsWith("CONFLICT")
            ? 409
            : 422;
    return { status, code: error.code };
  }

  if (error instanceof ConnectorServiceError) {
    const status = connectorServiceStatus(error.code);
    return error.issues.length > 0
      ? { status, code: error.code, params: { issues: error.issues } }
      : { status, code: error.code };
  }

  if (error instanceof ConnectorCredentialError) return { status: credentialStatus(error.code), code: error.code };

  if (error instanceof ConnectorActionError) return { status: actionStatus(error.code), code: error.code };

  if (error instanceof ConnectorOAuthError) return { status: oauthStatus(error.code), code: error.code };

  if (error instanceof McpOauthError) return { status: mcpManagementStatus(error.code), code: error.code };

  if (error instanceof ConnectorStorageError) return { status: storageStatus(error.code), code: error.code };

  if (error instanceof InfrastructureServiceError)
    return { status: infrastructureStatus(error.code), code: error.code };

  // Fastify's own schema failure. Its message quotes the body, so only the code travels.
  if (typeof error === "object" && error !== null && "validation" in error)
    return { status: 400, code: "INVALID_INPUT" };

  return null;
}

function connectorServiceStatus(code: string): number {
  if (code === "FORBIDDEN") return 403;
  if (code === "INSTANCE_NOT_FOUND" || code === "ENDPOINT_NOT_FOUND") return 404;
  if (code === "INSTANCE_NOT_ENABLED" || code === "ENDPOINT_ALREADY_EXISTS" || code === "ROTATION_ALREADY_OPEN")
    return 409;
  // A well-formed request asking for something the rules do not allow: 422, per the error
  // specification's classes. A malformed one never reaches a service.
  return 422;
}

function credentialStatus(code: string): number {
  if (code === "FORBIDDEN" || code === "MFA_REQUIRED") return 403;
  if (code === "INSTANCE_NOT_FOUND") return 404;
  if (code === "ROTATION_ALREADY_OPEN" || code === "NO_ROTATION_IN_PROGRESS") return 409;
  return 422;
}

function oauthStatus(code: string): number {
  if (code === "FORBIDDEN" || code === "MFA_REQUIRED") return 403;
  if (code === "INSTANCE_NOT_FOUND") return 404;
  if (code === "OAUTH_PROVIDER_NOT_CONFIGURED") return 503;
  if (code === "OAUTH_STATE_INVALID") return 400;
  return 422;
}

/**
 * What a `McpOauthError` means on the management surface.
 *
 * Only three of its codes can reach here: the rest belong to the token and authorization endpoints,
 * which answer in OAuth's envelope and never reach this handler. The split is the one the error
 * specification draws -- a body that could not be read at all is a 400, a body that was read and
 * refused by a rule is a 422 -- and the fallback is the second of those, because a code that got
 * here at all was raised by a service after the request had already parsed.
 */
function mcpManagementStatus(code: string): number {
  if (code === "MCP_REQUEST_INVALID") return 400;
  return 422;
}

function actionStatus(code: string): number {
  if (code === "FORBIDDEN" || code === "ACTION_MFA_REQUIRED") return 403;
  if (code === "INSTANCE_NOT_FOUND" || code === "ACTION_NOT_FOUND" || code === "TICKET_NOT_FOUND") return 404;
  if (code === "IDEMPOTENCY_KEY_REUSED") return 409;
  return 422;
}

/**
 * The infrastructure module's own codes, on the same scale as the connector surface above.
 *
 * `ALERT_ALREADY_HAS_INCIDENT` is a 409 and not a 422: nothing about the request is wrong, the
 * alert simply already opened one -- two people, or a sweep and a person, acting at once.
 */
function infrastructureStatus(code: string): number {
  if (code === "FORBIDDEN") return 403;
  // A body that names something absent is a 422: the route is there and the request is well
  // formed. Only a row this tenant cannot see is a 404.
  if (code === "REFERENCE_NOT_FOUND") return 422;
  // Nothing is wrong with the request: the module is deployed and its tables are not there yet.
  // 503 says the module cannot serve this, which is true, and the guided check says which
  // migration makes it able to.
  if (code === "MIGRATION_REQUIRED") return 503;
  if (code.endsWith("NOT_FOUND")) return 404;
  if (code.startsWith("DUPLICATE") || code === "ALERT_ALREADY_HAS_INCIDENT") return 409;
  return 422;
}

function storageStatus(code: string): number {
  if (code === "INSTANCE_NOT_FOUND") return 404;
  if (code === "INVALID_INPUT") return 422;
  // Everything else the adapter raises is a uniqueness constraint: a name already taken, a slot
  // already filled. Two people acting at once, not a malformed request.
  return 409;
}

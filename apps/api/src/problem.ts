import { ConnectorCredentialError, ConnectorServiceError, ConnectorStorageError } from "@control-hub/application";
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
  INSTANCE_NOT_ENABLED: "Integration is not enabled",
  DUPLICATE_INSTANCE_NAME: "An integration already uses that name",
  DUPLICATE_ENTRY: "Already exists",
  CREDENTIAL_SLOT_TAKEN: "A rotation is already open",
  ROTATION_ALREADY_OPEN: "A rotation is already open",
  NO_ROTATION_IN_PROGRESS: "No rotation to finish",
  SECRET_TOO_SHORT: "Secret too short",
  SECRET_TOO_LONG: "Secret too long",
  ALREADY_EXPIRED: "Expiry is in the past",
  INTERNAL_ERROR: "Unexpected error"
};

/**
 * Which routes answer in problem details.
 *
 * A prefix rather than a per-route flag: the two connector surfaces are the ones written to the
 * error specification, and a route added under them later gets the same envelope without anybody
 * having to remember to ask for it.
 */
export function usesProblemDetails(url: string): boolean {
  return url.startsWith("/api/v1/integrations") || url.startsWith("/api/v1/connectors");
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

  if (error instanceof ConnectorServiceError) {
    const status = connectorServiceStatus(error.code);
    return error.issues.length > 0
      ? { status, code: error.code, params: { issues: error.issues } }
      : { status, code: error.code };
  }

  if (error instanceof ConnectorCredentialError) return { status: credentialStatus(error.code), code: error.code };

  if (error instanceof ConnectorStorageError) return { status: storageStatus(error.code), code: error.code };

  // Fastify's own schema failure. Its message quotes the body, so only the code travels.
  if (typeof error === "object" && error !== null && "validation" in error)
    return { status: 400, code: "INVALID_INPUT" };

  return null;
}

function connectorServiceStatus(code: string): number {
  if (code === "FORBIDDEN") return 403;
  if (code === "INSTANCE_NOT_FOUND") return 404;
  if (code === "INSTANCE_NOT_ENABLED") return 409;
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

function storageStatus(code: string): number {
  if (code === "INSTANCE_NOT_FOUND") return 404;
  if (code === "INVALID_INPUT") return 422;
  // Everything else the adapter raises is a uniqueness constraint: a name already taken, a slot
  // already filled. Two people acting at once, not a malformed request.
  return 409;
}

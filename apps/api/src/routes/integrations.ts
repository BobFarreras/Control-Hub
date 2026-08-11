import {
  ConnectorServiceError,
  type ConnectorCatalogueEntry,
  type ConnectorInstanceRecord,
  type CredentialMetadata,
  type SyncRunRecord,
  type WebhookEndpointRecord
} from "@control-hub/application";
import type { TenantContext } from "@control-hub/domain";
import type { FastifyRequest } from "fastify";
import { requirePermission, resolveTenantContext, writeAudit } from "../security.js";
import type { IntegrationsContext } from "./context.js";

/**
 * The integrations surface.
 *
 * Two things are true of every handler here and are worth stating once. There is no response
 * shape in this file that can carry a secret: `credentialResponse` is the only thing that ever
 * describes a credential and it is written field by field, so a column added to the table later
 * cannot appear in an API response by simply existing. And every action that changes something
 * writes an audit row, including the ones that were refused — a denial nobody recorded is the
 * one an investigation later cannot see.
 *
 * Specification: `docs/specifications/connectors.md`.
 */

export function instanceResponse(instance: ConnectorInstanceRecord) {
  return {
    id: instance.id,
    connectorType: instance.connectorType,
    name: instance.name,
    status: instance.status,
    config: instance.config,
    configVersion: instance.configVersion,
    health: {
      status: instance.healthStatus,
      checkedAt: instance.healthCheckedAt,
      lastErrorCode: instance.lastErrorCode
    },
    createdAt: instance.createdAt,
    updatedAt: instance.updatedAt
  };
}

/**
 * What a credential looks like from outside: when it was made, when it was used, whether it is
 * still live. Never the value, and not the key identifier either — which ring key sealed it is an
 * operational detail of the vault and no screen has anything to do with it.
 */
export function credentialResponse(credential: CredentialMetadata) {
  return {
    id: credential.id,
    kind: credential.kind,
    slot: credential.slot,
    rotatedAt: credential.rotatedAt,
    expiresAt: credential.expiresAt,
    lastUsedAt: credential.lastUsedAt,
    revokedAt: credential.revokedAt,
    createdAt: credential.createdAt
  };
}

export function runResponse(run: SyncRunRecord) {
  return {
    id: run.id,
    operation: run.operation,
    status: run.status,
    attempt: run.attempt,
    configVersion: run.configVersion,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    errorCode: run.errorCode,
    itemsProcessed: run.itemsProcessed
  };
}

/**
 * An endpoint as a listing sees it: when it was made, whether it is still live.
 *
 * No `publicId`. The address was handed over once at creation, exactly like the secret beside it,
 * and re-displaying it would put the ingress URL of every installation into every screenshot and
 * support ticket for no operation that needs it.
 */
export function endpointResponse(endpoint: WebhookEndpointRecord) {
  return { id: endpoint.id, createdAt: endpoint.createdAt, revokedAt: endpoint.revokedAt };
}

/**
 * The path a provider posts to, rather than an absolute URL.
 *
 * The API does not know its own public address: what it has is a `Host` header, which the caller
 * chose, and inventing an origin from it would hand somebody a URL pointing wherever they liked.
 * The screen that displays this composes it against the origin it is already talking to.
 */
export function webhookPath(publicId: string): string {
  return `/api/v1/webhooks/${publicId}`;
}

export function catalogueResponse(entry: ConnectorCatalogueEntry) {
  return {
    type: entry.type,
    contractVersion: entry.contractVersion,
    credentialKinds: entry.credentialKinds,
    capabilities: {
      egress: entry.capabilities.egress,
      operations: entry.capabilities.operations,
      ingress: entry.capabilities.ingress
    }
  };
}

/**
 * An idempotency key becomes part of a queue job identifier, so it is checked before it is used.
 *
 * A key with a colon in it would collide with the identifier's own separators, which is how one
 * tenant's retry could land on another tenant's job. Refusing an unusual key costs a caller one
 * header; accepting it costs everybody the property the key was for.
 */
const idempotencyKeyPattern = /^[A-Za-z0-9._-]{8,128}$/;

export function idempotencyKeyOf(request: FastifyRequest): string | null {
  const header = request.headers["idempotency-key"];
  if (typeof header !== "string" || header.length === 0) return null;
  if (!idempotencyKeyPattern.test(header)) throw new ConnectorServiceError("INVALID_IDEMPOTENCY_KEY");
  return header;
}

const instanceParams = {
  type: "object",
  additionalProperties: false,
  required: ["instanceId"],
  properties: { instanceId: { type: "string", format: "uuid" } }
} as const;

const credentialParams = {
  type: "object",
  additionalProperties: false,
  required: ["instanceId", "kind"],
  properties: {
    instanceId: { type: "string", format: "uuid" },
    kind: { type: "string", pattern: "^[a-z][a-z0-9_]{1,62}$" }
  }
} as const;

/**
 * `credentials` and `ingress` are null on an installation with no key ring.
 *
 * The credential and endpoint routes are then not declared at all, which is the truth: there is
 * no key to seal a secret with, and a route that accepted one would take a customer's provider
 * credential and fail to store it. Minting a webhook endpoint is in the same position — it seals
 * the secret that signs for it. The boot log says the same thing in words.
 */
export function registerIntegrationRoutes({
  app,
  database,
  auth,
  connectors,
  credentials,
  ingress
}: IntegrationsContext) {
  /**
   * A permission refused is a thing that happened, and the audit log is where it is recorded.
   *
   * The row is written before the error travels, under the tenant that was resolved, so the
   * denial is visible to whoever reviews the log later — which is the point of recording it.
   */
  async function requireAudited(
    context: TenantContext,
    request: FastifyRequest,
    permission: Parameters<typeof requirePermission>[1],
    event: { action: string; targetType: string; targetId?: string; metadata?: Record<string, string> }
  ) {
    try {
      requirePermission(context, permission);
    } catch (error) {
      await writeAudit(database, context, request, { ...event, outcome: "denied" });
      throw error;
    }
  }

  app.get("/api/v1/connectors", async (request) => {
    const context = await resolveTenantContext(auth, database, request);
    requirePermission(context, "integrations:read");
    return { connectors: connectors.catalogueEntries(context).map(catalogueResponse) };
  });

  app.get("/api/v1/integrations", async (request) => {
    const context = await resolveTenantContext(auth, database, request);
    requirePermission(context, "integrations:read");
    return { integrations: (await connectors.list(context)).map(instanceResponse) };
  });

  app.get<{ Params: { instanceId: string } }>(
    "/api/v1/integrations/:instanceId",
    { schema: { params: instanceParams } },
    async (request) => {
      const context = await resolveTenantContext(auth, database, request);
      requirePermission(context, "integrations:read");
      return { integration: instanceResponse(await connectors.get(context, request.params.instanceId)) };
    }
  );

  app.post<{ Body: { connectorType: string; name: string; config?: Record<string, unknown> } }>(
    "/api/v1/integrations",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["connectorType", "name"],
          properties: {
            connectorType: { type: "string", minLength: 1, maxLength: 64 },
            name: { type: "string", minLength: 1, maxLength: 120 },
            // Validated by the connector's own schema, not here: this API knows nothing about
            // what any given provider needs, and a second opinion in JSON Schema would only be a
            // second thing to keep in step with the first.
            config: { type: "object" }
          }
        }
      }
    },
    async (request, reply) => {
      const context = await resolveTenantContext(auth, database, request);
      await requireAudited(context, request, "integrations:manage", {
        action: "connector_instance.created",
        targetType: "connector_instance",
        metadata: { connectorType: request.body.connectorType }
      });
      const instance = await connectors.create(context, {
        connectorType: request.body.connectorType,
        name: request.body.name,
        config: request.body.config ?? {}
      });
      await writeAudit(database, context, request, {
        action: "connector_instance.created",
        targetType: "connector_instance",
        targetId: instance.id,
        outcome: "success",
        metadata: { connectorType: instance.connectorType }
      });
      return reply.code(201).send({ integration: instanceResponse(instance) });
    }
  );

  app.patch<{ Params: { instanceId: string }; Body: { config: Record<string, unknown> } }>(
    "/api/v1/integrations/:instanceId",
    {
      schema: {
        params: instanceParams,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["config"],
          properties: { config: { type: "object" } }
        }
      }
    },
    async (request) => {
      const context = await resolveTenantContext(auth, database, request);
      const { instanceId } = request.params;
      await requireAudited(context, request, "integrations:manage", {
        action: "connector_instance.updated",
        targetType: "connector_instance",
        targetId: instanceId
      });
      const instance = await connectors.updateConfig(context, instanceId, request.body.config);
      await writeAudit(database, context, request, {
        action: "connector_instance.updated",
        targetType: "connector_instance",
        targetId: instance.id,
        outcome: "success",
        // The version and the type, never the configuration itself: it is the one place a person
        // may have pasted something that does not belong in a log.
        metadata: { connectorType: instance.connectorType, configVersion: instance.configVersion }
      });
      return { integration: instanceResponse(instance) };
    }
  );

  app.post<{ Params: { instanceId: string } }>(
    "/api/v1/integrations/:instanceId/enable",
    { schema: { params: instanceParams } },
    async (request) => {
      const context = await resolveTenantContext(auth, database, request);
      const { instanceId } = request.params;
      await requireAudited(context, request, "integrations:manage", {
        action: "connector_instance.enabled",
        targetType: "connector_instance",
        targetId: instanceId
      });
      const instance = await connectors.enable(context, instanceId);
      await writeAudit(database, context, request, {
        action: "connector_instance.enabled",
        targetType: "connector_instance",
        targetId: instance.id,
        outcome: "success",
        metadata: { connectorType: instance.connectorType }
      });
      return { integration: instanceResponse(instance) };
    }
  );

  app.post<{ Params: { instanceId: string } }>(
    "/api/v1/integrations/:instanceId/disable",
    { schema: { params: instanceParams } },
    async (request) => {
      const context = await resolveTenantContext(auth, database, request);
      const { instanceId } = request.params;
      await requireAudited(context, request, "integrations:manage", {
        action: "connector_instance.disabled",
        targetType: "connector_instance",
        targetId: instanceId
      });
      const { instance, revokedCredentials } = await connectors.disable(context, instanceId);
      await writeAudit(database, context, request, {
        action: "connector_instance.disabled",
        targetType: "connector_instance",
        targetId: instance.id,
        outcome: "success",
        metadata: { connectorType: instance.connectorType, revokedCredentials }
      });
      return { integration: instanceResponse(instance), revokedCredentials };
    }
  );

  app.post<{ Params: { instanceId: string } }>(
    "/api/v1/integrations/:instanceId/health-checks",
    { schema: { params: instanceParams } },
    async (request, reply) => {
      const context = await resolveTenantContext(auth, database, request);
      const { instanceId } = request.params;
      await requireAudited(context, request, "integrations:manage", {
        action: "connector_health_check.requested",
        targetType: "connector_instance",
        targetId: instanceId
      });
      const { instance, requestId } = await connectors.requestHealthCheck(
        context,
        instanceId,
        idempotencyKeyOf(request)
      );
      await writeAudit(database, context, request, {
        action: "connector_health_check.requested",
        targetType: "connector_instance",
        targetId: instance.id,
        outcome: "success",
        metadata: { connectorType: instance.connectorType }
      });
      // 202: the check has been asked for, not performed. Its outcome arrives as a run.
      return reply.code(202).send({ requestId, instanceId: instance.id });
    }
  );

  app.get<{ Params: { instanceId: string }; Querystring: { page?: number; pageSize?: number } }>(
    "/api/v1/integrations/:instanceId/runs",
    {
      schema: {
        params: instanceParams,
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            page: { type: "integer", minimum: 1, default: 1 },
            pageSize: { type: "integer", minimum: 1, maximum: 100, default: 20 }
          }
        }
      }
    },
    async (request) => {
      const context = await resolveTenantContext(auth, database, request);
      requirePermission(context, "integrations:read");
      const { page = 1, pageSize = 20 } = request.query;
      const runs = await connectors.runs(context, request.params.instanceId, page, pageSize);
      return { runs: runs.items.map(runResponse), total: runs.total, page: runs.page, pageSize: runs.pageSize };
    }
  );

  if (!credentials || !ingress) return;

  app.get<{ Params: { instanceId: string } }>(
    "/api/v1/integrations/:instanceId/endpoints",
    { schema: { params: instanceParams } },
    async (request) => {
      const context = await resolveTenantContext(auth, database, request);
      requirePermission(context, "integrations:read");
      const endpoints = await ingress.listEndpoints(context, request.params.instanceId);
      return { endpoints: endpoints.map(endpointResponse) };
    }
  );

  /**
   * Mints the address and the secret, and this is the only response that carries either.
   *
   * The audit row names the endpoint, never the secret: an audit log is read by more people than
   * the vault is, and a value written there would outlive every rotation.
   */
  app.post<{ Params: { instanceId: string } }>(
    "/api/v1/integrations/:instanceId/endpoints",
    { schema: { params: instanceParams } },
    async (request, reply) => {
      const context = await resolveTenantContext(auth, database, request);
      const { instanceId } = request.params;
      await requireAudited(context, request, "integrations:manage", {
        action: "connector_endpoint.created",
        targetType: "connector_endpoint",
        targetId: instanceId
      });
      const { endpoint, secret } = await ingress.createEndpoint(context, instanceId);
      await writeAudit(database, context, request, {
        action: "connector_endpoint.created",
        targetType: "connector_endpoint",
        targetId: endpoint.id,
        outcome: "success",
        metadata: { instanceId }
      });
      return reply.code(201).send({
        endpoint: endpointResponse(endpoint),
        path: webhookPath(endpoint.publicId),
        // Shown once. There is no route that can return it again, because nothing outside the
        // ingress service can open it.
        secret
      });
    }
  );

  app.delete<{ Params: { instanceId: string; endpointId: string } }>(
    "/api/v1/integrations/:instanceId/endpoints/:endpointId",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["instanceId", "endpointId"],
          properties: {
            instanceId: { type: "string", format: "uuid" },
            endpointId: { type: "string", format: "uuid" }
          }
        }
      }
    },
    async (request) => {
      const context = await resolveTenantContext(auth, database, request);
      const { instanceId, endpointId } = request.params;
      await requireAudited(context, request, "integrations:manage", {
        action: "connector_endpoint.revoked",
        targetType: "connector_endpoint",
        targetId: endpointId
      });
      const { revokedCredentials } = await ingress.revokeEndpoint(context, instanceId, endpointId);
      await writeAudit(database, context, request, {
        action: "connector_endpoint.revoked",
        targetType: "connector_endpoint",
        targetId: endpointId,
        outcome: "success",
        metadata: { instanceId, revokedCredentials }
      });
      return { revoked: true, revokedCredentials };
    }
  );

  app.get<{ Params: { instanceId: string } }>(
    "/api/v1/integrations/:instanceId/credentials",
    { schema: { params: instanceParams } },
    async (request) => {
      const context = await resolveTenantContext(auth, database, request);
      requirePermission(context, "integrations:read");
      const stored = await credentials.list(context, request.params.instanceId);
      return { credentials: stored.map(credentialResponse) };
    }
  );

  app.put<{ Params: { instanceId: string; kind: string }; Body: { secret: string; expiresAt?: string } }>(
    "/api/v1/integrations/:instanceId/credentials/:kind",
    {
      schema: {
        params: credentialParams,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["secret"],
          properties: {
            secret: { type: "string", minLength: 8, maxLength: 8192 },
            expiresAt: { type: "string", format: "date-time" }
          }
        }
      }
    },
    async (request) => {
      const context = await resolveTenantContext(auth, database, request);
      const { instanceId, kind } = request.params;
      await requireAudited(context, request, "credentials:rotate", {
        action: "connector_credential.written",
        targetType: "connector_credential",
        targetId: instanceId,
        metadata: { kind }
      });
      const written = await credentials.write(context, {
        instanceId,
        kind,
        secret: request.body.secret,
        ...(request.body.expiresAt ? { expiresAt: new Date(request.body.expiresAt) } : {})
      });
      await writeAudit(database, context, request, {
        action: "connector_credential.written",
        targetType: "connector_credential",
        targetId: written.id,
        outcome: "success",
        metadata: { instanceId, kind: written.kind, slot: written.slot }
      });
      return { credential: credentialResponse(written) };
    }
  );

  /**
   * Finishing a rotation: the secondary becomes the primary and the old one is revoked, together.
   *
   * Without this route the two slots would be a rotation nobody can complete — the credential
   * would be installed at the provider and this side would go on sending the previous one.
   */
  app.post<{ Params: { instanceId: string; kind: string } }>(
    "/api/v1/integrations/:instanceId/credentials/:kind/promote",
    { schema: { params: credentialParams } },
    async (request) => {
      const context = await resolveTenantContext(auth, database, request);
      const { instanceId, kind } = request.params;
      await requireAudited(context, request, "credentials:rotate", {
        action: "connector_credential.promoted",
        targetType: "connector_credential",
        targetId: instanceId,
        metadata: { kind }
      });
      const promoted = await credentials.promote(context, instanceId, kind);
      await writeAudit(database, context, request, {
        action: "connector_credential.promoted",
        targetType: "connector_credential",
        targetId: promoted.id,
        outcome: "success",
        metadata: { instanceId, kind: promoted.kind }
      });
      return { credential: credentialResponse(promoted) };
    }
  );

  app.delete<{ Params: { instanceId: string; kind: string } }>(
    "/api/v1/integrations/:instanceId/credentials/:kind",
    { schema: { params: credentialParams } },
    async (request) => {
      const context = await resolveTenantContext(auth, database, request);
      const { instanceId, kind } = request.params;
      await requireAudited(context, request, "credentials:rotate", {
        action: "connector_credential.revoked",
        targetType: "connector_credential",
        targetId: instanceId,
        metadata: { kind }
      });
      const revoked = await credentials.revoke(context, instanceId, kind);
      await writeAudit(database, context, request, {
        action: "connector_credential.revoked",
        targetType: "connector_credential",
        targetId: instanceId,
        outcome: "success",
        metadata: { kind, revoked }
      });
      return { revoked };
    }
  );
}

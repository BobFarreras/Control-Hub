import {
  ConnectorError,
  type ConnectorContext,
  type IngressRequest,
  type IngressResult
} from "@control-hub/connectors";
import { hasPermission, type TenantContext } from "@control-hub/domain";
import { ConnectorSecretReader } from "./connector-credentials.js";
import { ConnectorServiceError, type ConnectorCatalogue } from "./connector-instances.js";
import type {
  ConnectorRepository,
  CreatedWebhookEndpoint,
  CredentialSealer,
  WebhookEndpointRecord
} from "./connectors.js";

/**
 * Inbound webhooks: minting an endpoint, and deciding what a delivery to it is worth.
 *
 * This class opens sealed secrets, and it is still true that no route can read one. `accept`
 * returns a verdict, never a value, and there is no other method here that touches a credential.
 * The comparison happens inside this object because the alternative — handing the API a
 * `ConnectorSecretReader` so a route could verify a signature itself — would put a method that
 * returns a plaintext secret within reach of every handler in the process.
 *
 * The other property this file carries is that an unknown endpoint, an invalid signature and a
 * timestamp outside the window are indistinguishable from outside. That is why every failure
 * before the signature matches leaves through one shape, `{ status: "refused" }`, with the reason
 * kept for our own logs: a route that received distinct errors would sooner or later map one of
 * them to a distinct status, and then anybody could enumerate which endpoints exist.
 *
 * Specification: `docs/specifications/connectors.md`.
 */

/** The signing secret of an ingress endpoint. The provider never chooses it; we mint it. */
export const ingressCredentialKind = "ingress_signing";

/** Five minutes, either side of now. A clock that drifts further than that is a problem to fix. */
export const ingressReplayWindowMs = 5 * 60_000;

/**
 * The primitives verification needs, as a port.
 *
 * Declared here so the use case depends on the operation rather than on `node:crypto`, exactly as
 * `CredentialSealer` does, and so a test can watch what was compared without reimplementing HMAC.
 */
export type IngressCrypto = {
  /** Constant time. Never a `===` on a signature: the timing of that comparison is the leak. */
  matches(input: { secret: string; payload: string; signature: string }): boolean;
  /** Hex sha256. The payload hash, and the idempotency key when a provider sends no event id. */
  sha256(value: string): string;
  /** A fresh signing secret, long enough that guessing is not a strategy. */
  mintSecret(): string;
};

/** A delivery as it arrived: the bytes, the headers, and when we received it. */
export type IngressDelivery = {
  publicId: string;
  /** Exactly as received. Re-serialising the parsed body would change what the signature covers. */
  rawBody: string;
  headers: Readonly<Record<string, string>>;
  receivedAt: Date;
};

/** Why a delivery was refused. For our logs and metrics, never for the answer. */
export type IngressRefusal =
  | "unknown_endpoint"
  | "instance_not_enabled"
  | "ingress_not_supported"
  | "missing_signature"
  | "timestamp_out_of_window"
  | "no_live_secret"
  | "signature_mismatch";

export type IngressOutcome =
  | { status: "accepted"; eventId: string; duplicate: boolean; stored: "pending" | "discarded" }
  /**
   * Signed correctly, and the connector could not read it.
   *
   * This one is answered differently from a refusal on purpose. Reaching it requires the signing
   * secret, so it tells an attacker nothing, and telling a provider that holds our secret that
   * their payload was unreadable is the difference between a bug they can fix and one that looks
   * like a silent drop on our side.
   */
  | { status: "unreadable"; code: string }
  | { status: "refused"; reason: IngressRefusal };

export type CreatedIngressEndpoint = {
  endpoint: CreatedWebhookEndpoint;
  /** Handed over once, here. It is sealed on the way to the database and never read back out. */
  secret: string;
};

function refused(reason: IngressRefusal): IngressOutcome {
  return { status: "refused", reason };
}

const timestampPattern = /^[0-9]{1,12}$/;

/**
 * Unix seconds, and the value is compared in both directions.
 *
 * A timestamp in the future is as much a sign of a forged or replayed request as one in the past,
 * and accepting it would leave a window an attacker can choose the length of.
 */
function withinReplayWindow(timestamp: string, receivedAt: Date): boolean {
  if (!timestampPattern.test(timestamp)) return false;
  return Math.abs(receivedAt.getTime() - Number(timestamp) * 1000) <= ingressReplayWindowMs;
}

/**
 * The context a delivery runs under.
 *
 * There is no person behind a webhook: a provider posted to a public address, and everything
 * after the endpoint resolved happens inside the tenant that resolved. The permissions are the
 * ones this work needs and no more, which is the same rule the worker's `jobContext` follows.
 */
function ingressContext(tenantId: string): TenantContext {
  return {
    tenantId,
    membershipId: "system",
    userId: "system",
    roles: [],
    permissions: ["integrations:read"],
    mfaEnabled: true
  };
}

/**
 * What a connector is given while reading an event.
 *
 * Reading one needs no I/O — the contract says a handler may be synchronous — so the ports that
 * would perform any are closed rather than merely unused. A connector that tries to call out
 * from inside an API request fails here, where it is visible, instead of putting a provider's
 * timeout in front of the delivery we are supposed to acknowledge in milliseconds.
 */
function readingContext(instanceId: string, config: unknown, receivedAt: Date): ConnectorContext<unknown> {
  return {
    instanceId,
    config,
    http: { send: () => Promise.reject(new ConnectorError("EGRESS_NOT_AVAILABLE")) },
    secrets: { open: () => Promise.reject(new ConnectorError("SECRETS_NOT_AVAILABLE")) },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    clock: { now: () => receivedAt }
  };
}

export class ConnectorIngressService {
  private readonly secrets: ConnectorSecretReader;

  constructor(
    private readonly repository: ConnectorRepository,
    private readonly catalogue: ConnectorCatalogue,
    private readonly sealer: CredentialSealer,
    private readonly crypto: IngressCrypto
  ) {
    this.secrets = new ConnectorSecretReader(repository, sealer);
  }

  /**
   * Mints an endpoint and the secret that signs for it, and returns both once.
   *
   * One live endpoint per instance, because the signing secret is held per instance and per slot:
   * a second endpoint would either find both slots taken or fill the secondary one, which is what
   * a rotation looks like, and nobody would have started a rotation. Rotating an ingress secret
   * is the credential routes' job; replacing an endpoint is revoke and create again.
   */
  async createEndpoint(context: TenantContext, instanceId: string): Promise<CreatedIngressEndpoint> {
    requireManage(context);
    const connector = await this.ingressConnector(context, instanceId);
    if (!connector) throw new ConnectorServiceError("INGRESS_NOT_SUPPORTED");

    const live = await this.repository.listEndpoints(context, instanceId);
    if (live.some((endpoint) => endpoint.revokedAt === null)) throw new ConnectorServiceError("ENDPOINT_ALREADY_EXISTS");

    const held = await this.repository.readSealedCredentials(context, instanceId, ingressCredentialKind);
    if (held.length >= 2) throw new ConnectorServiceError("ROTATION_ALREADY_OPEN");
    const slot = held.some((credential) => credential.slot === "primary") ? "secondary" : "primary";

    const secret = this.crypto.mintSecret();
    const endpoint = await this.repository.createEndpoint(context, instanceId);
    await this.repository.putCredential(context, {
      instanceId,
      kind: ingressCredentialKind,
      slot,
      ...this.sealer.seal(secret, { tenantId: context.tenantId, instanceId })
    });
    return { endpoint, secret };
  }

  /** Endpoints without their `publicId`: the URL was handed over once, like the secret beside it. */
  async listEndpoints(context: TenantContext, instanceId: string): Promise<WebhookEndpointRecord[]> {
    if (!hasPermission(context, "integrations:read")) throw new ConnectorServiceError("FORBIDDEN");
    await this.requireInstance(context, instanceId);
    return this.repository.listEndpoints(context, instanceId);
  }

  /**
   * Revokes the endpoint and then the secret that signed for it, in that order.
   *
   * The other order would leave a live address whose signature nothing can verify, which answers
   * every delivery with the same `404` a revoked endpoint gets — the same outcome, reached by
   * accident, and impossible to tell from the real thing while diagnosing it.
   */
  async revokeEndpoint(
    context: TenantContext,
    instanceId: string,
    endpointId: string
  ): Promise<{ revokedCredentials: number }> {
    requireManage(context);
    await this.requireInstance(context, instanceId);
    const belongs = (await this.repository.listEndpoints(context, instanceId)).some(
      (endpoint) => endpoint.id === endpointId && endpoint.revokedAt === null
    );
    if (!belongs) throw new ConnectorServiceError("ENDPOINT_NOT_FOUND");
    await this.repository.revokeEndpoint(context, endpointId);
    return { revokedCredentials: await this.repository.revokeCredentials(context, instanceId, ingressCredentialKind) };
  }

  /**
   * One delivery: verified, read and recorded, or refused.
   *
   * The order of the checks is the cheap and unauthenticated ones first. Nothing reads the
   * database twice before the signature matches, so posting to a guessed address costs an
   * attacker the same one lookup whatever they send.
   */
  async accept(delivery: IngressDelivery): Promise<IngressOutcome> {
    const endpoint = await this.repository.resolveEndpoint(delivery.publicId);
    if (!endpoint) return refused("unknown_endpoint");
    // A disabled or draft instance keeps its endpoint row, and answers nothing: work that would
    // not be run is not work worth storing.
    if (endpoint.status !== "enabled") return refused("instance_not_enabled");

    const connector = this.catalogue.find(endpoint.connectorType);
    const signature = connector?.ingressSignature;
    if (!connector || !signature) return refused("ingress_not_supported");

    const provided = delivery.headers[signature.signatureHeader.toLowerCase()];
    const timestamp = delivery.headers[signature.timestampHeader.toLowerCase()];
    if (!provided || !timestamp) return refused("missing_signature");
    if (!withinReplayWindow(timestamp, delivery.receivedAt)) return refused("timestamp_out_of_window");

    const context = ingressContext(endpoint.tenantId);
    // Both slots, because during a rotation a signature may legitimately have been made with
    // either value. Which one matched is recorded, and a secondary that never matches is how an
    // abandoned rotation becomes visible.
    const live = await this.secrets.openAll(context, endpoint.instanceId, ingressCredentialKind);
    if (live.length === 0) return refused("no_live_secret");
    const payload = signature.payload(timestamp, delivery.rawBody);
    const matched = live.find((credential) =>
      this.crypto.matches({ secret: credential.secret, payload, signature: provided })
    );
    if (!matched) return refused("signature_mismatch");
    await this.secrets.markUsed(context, matched.id);

    const instance = await this.repository.getInstance(context, endpoint.instanceId);
    if (!instance) return refused("unknown_endpoint");

    const request: IngressRequest = {
      body: delivery.rawBody,
      headers: delivery.headers,
      receivedAt: delivery.receivedAt
    };
    let read: IngressResult;
    try {
      read = await connector.ingest(
        readingContext(endpoint.instanceId, instance.config, delivery.receivedAt),
        request
      );
    } catch (error) {
      // Only the connector's own refusals. Anything else — a closed port, a bug — is ours, and
      // swallowing it here would answer a provider `400` for a fault they cannot do anything about.
      if (!(error instanceof ConnectorError)) throw error;
      return { status: "unreadable", code: error.code };
    }

    const payloadHash = this.crypto.sha256(delivery.rawBody);
    const recorded = await this.repository.recordInboxEvent(context, {
      endpointId: endpoint.id,
      // The provider's identifier when it sends one, so a redelivery of the same event is the
      // same row even when the bytes differ by a retry counter or a timestamp.
      providerEventId: read.eventId ?? payloadHash,
      payloadHash,
      payload: delivery.rawBody
    });
    // Filtered out by the instance's own configuration: recorded and closed, not dropped. A
    // person asking why an event never arrived deserves to find it and see that we discarded it.
    if (!recorded.duplicate && !read.accepted) {
      await this.repository.finishInboxEvent(context, recorded.id, {
        status: "discarded",
        processedAt: delivery.receivedAt
      });
    }
    return {
      status: "accepted",
      eventId: recorded.id,
      duplicate: recorded.duplicate,
      stored: read.accepted ? "pending" : "discarded"
    };
  }

  /** The connector of an instance of this tenant, or null when it declares no ingress. */
  private async ingressConnector(context: TenantContext, instanceId: string) {
    const instance = await this.requireInstance(context, instanceId);
    const connector = this.catalogue.find(instance.connectorType);
    if (!connector) throw new ConnectorServiceError("UNKNOWN_CONNECTOR_TYPE");
    return connector.capabilities.ingress && connector.ingressSignature ? connector : null;
  }

  private async requireInstance(context: TenantContext, instanceId: string) {
    const instance = await this.repository.getInstance(context, instanceId);
    if (!instance) throw new ConnectorServiceError("INSTANCE_NOT_FOUND");
    return instance;
  }
}

function requireManage(context: TenantContext) {
  if (!hasPermission(context, "integrations:manage")) throw new ConnectorServiceError("FORBIDDEN");
}

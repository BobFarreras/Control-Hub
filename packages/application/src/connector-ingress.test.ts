import { connectorRegistry } from "@control-hub/connectors";
import { rolePermissions, type Permission, type RoleCode, type TenantContext } from "@control-hub/domain";
import { beforeEach, describe, expect, it } from "vitest";
import {
  ConnectorIngressService,
  ingressCredentialKind,
  ingressReplayWindowMs,
  type IngressCrypto,
  type IngressDelivery
} from "./connector-ingress.js";
import { ConnectorServiceError } from "./connector-instances.js";
import type {
  ConnectorInstanceRecord,
  ConnectorRepository,
  CreatedWebhookEndpoint,
  CredentialAad,
  CredentialEnvelope,
  CredentialMetadata,
  CredentialSealer,
  InboxOutcome,
  PutCredentialInput,
  RecordInboxInput,
  RecordInboxResult,
  ResolvedWebhookEndpoint,
  SealedCredential,
  WebhookEndpointRecord
} from "./connectors.js";

/**
 * The ingress path, exercised without a socket and without a database.
 *
 * The connector is the real `generic-webhook`, so the bytes that get signed are the ones the
 * shipped connector says are signed and the event identifier is read by its shipped code. What
 * is faked is the comparison itself, which belongs to `nodeIngressCrypto` and is tested where it
 * lives — here the question is which secrets are tried, what happens when none matches, and what
 * ends up in the inbox.
 */

const tenantId = "11111111-1111-4111-8111-111111111111";
const otherTenantId = "22222222-2222-4222-8222-222222222222";
const instanceId = "33333333-3333-4333-8333-333333333333";
const endpointId = "55555555-5555-4555-8555-555555555555";
const publicId = "a-public-identifier-of-thirty-two-bytes";
const signedAt = new Date("2026-08-11T12:00:00.000Z");
const timestamp = String(Math.floor(signedAt.getTime() / 1000));

function asRole(role: RoleCode): TenantContext {
  return {
    tenantId,
    membershipId: "m-1",
    userId: "u-1",
    roles: [role],
    permissions: [...rolePermissions[role]] as Permission[],
    mfaEnabled: true
  };
}

const owner = asRole("owner");
const administrator = asRole("administrator");

const genericWebhook = connectorRegistry.require("generic-webhook");
const catalogue = { types: () => connectorRegistry.types(), find: (type: string) => connectorRegistry.find(type) };

/**
 * A sealer that hides nothing, and still binds what a real one binds.
 *
 * The additional authenticated data is checked rather than ignored, so a test that opened one
 * tenant's envelope under another's context would fail here exactly as `CredentialVault` fails.
 */
const sealer: CredentialSealer = {
  seal(plaintext: string, aad: CredentialAad): CredentialEnvelope {
    return {
      keyId: "test",
      nonce: Buffer.from(`${aad.tenantId}:${aad.instanceId}`, "utf8"),
      ciphertext: Buffer.from(plaintext, "utf8")
    };
  },
  open(envelope: CredentialEnvelope, aad: CredentialAad): string {
    if (Buffer.from(envelope.nonce).toString("utf8") !== `${aad.tenantId}:${aad.instanceId}`) {
      throw new Error("the envelope was sealed against something else");
    }
    return Buffer.from(envelope.ciphertext).toString("utf8");
  }
};

/** A signature is the secret and the bytes it covered, so a test can build a wrong one on purpose. */
function signatureFor(secret: string, payload: string): string {
  return `signed(${secret})(${payload})`;
}

let mintedSecrets = 0;
const crypto: IngressCrypto = {
  matches: ({ secret, payload, signature }) => signature === signatureFor(secret, payload),
  sha256: (value) => `sha256:${value.length}:${value}`,
  mintSecret: () => {
    mintedSecrets += 1;
    return `minted-secret-${mintedSecrets}`;
  }
};

type StoredCredential = SealedCredential & { revoked: boolean; usedAt: Date | null };

class FakeRepository {
  readonly instances = new Map<string, ConnectorInstanceRecord>();
  readonly endpoints: (WebhookEndpointRecord & { tenantId: string; publicId: string })[] = [];
  readonly credentials: StoredCredential[] = [];
  readonly inbox: (RecordInboxInput & { id: string; status: string })[] = [];
  private next = 0;

  constructor(connectorType = "generic-webhook", status: ConnectorInstanceRecord["status"] = "enabled") {
    this.instances.set(instanceId, {
      id: instanceId,
      connectorType,
      name: "Provider",
      status,
      config: { eventIdPath: "id", eventTypePath: "type", eventTypes: [] },
      configVersion: 1,
      healthStatus: "unknown",
      healthCheckedAt: null,
      lastErrorCode: null,
      createdAt: new Date(0),
      updatedAt: new Date(0)
    });
  }

  getInstance(_context: TenantContext, id: string): Promise<ConnectorInstanceRecord | null> {
    return Promise.resolve(this.instances.get(id) ?? null);
  }

  createEndpoint(context: TenantContext, id: string): Promise<CreatedWebhookEndpoint> {
    this.next += 1;
    const endpoint = {
      id: this.next === 1 ? endpointId : `e-${this.next}`,
      instanceId: id,
      tenantId: context.tenantId,
      publicId: this.next === 1 ? publicId : `${publicId}-${this.next}`,
      createdAt: new Date(0),
      revokedAt: null
    };
    this.endpoints.push(endpoint);
    return Promise.resolve(endpoint);
  }

  listEndpoints(context: TenantContext, id: string): Promise<WebhookEndpointRecord[]> {
    return Promise.resolve(
      this.endpoints.filter((endpoint) => endpoint.tenantId === context.tenantId && endpoint.instanceId === id)
    );
  }

  revokeEndpoint(_context: TenantContext, id: string): Promise<boolean> {
    const endpoint = this.endpoints.find((candidate) => candidate.id === id);
    if (!endpoint || endpoint.revokedAt) return Promise.resolve(false);
    endpoint.revokedAt = new Date(1000);
    return Promise.resolve(true);
  }

  /** Like the database function: a revoked endpoint resolves to nothing, and so does an unknown one. */
  resolveEndpoint(candidate: string): Promise<ResolvedWebhookEndpoint | null> {
    const endpoint = this.endpoints.find((entry) => entry.publicId === candidate && entry.revokedAt === null);
    if (!endpoint) return Promise.resolve(null);
    const instance = this.instances.get(endpoint.instanceId)!;
    return Promise.resolve({
      id: endpoint.id,
      tenantId: endpoint.tenantId,
      instanceId: endpoint.instanceId,
      connectorType: instance.connectorType,
      status: instance.status
    });
  }

  putCredential(context: TenantContext, input: PutCredentialInput): Promise<CredentialMetadata> {
    this.credentials.push({
      id: `c-${this.credentials.length + 1}`,
      kind: input.kind,
      slot: input.slot,
      keyId: input.keyId,
      nonce: input.nonce,
      ciphertext: input.ciphertext,
      revoked: false,
      usedAt: null
    });
    return Promise.resolve({
      id: `c-${this.credentials.length}`,
      kind: input.kind,
      slot: input.slot,
      keyId: input.keyId,
      rotatedAt: null,
      expiresAt: null,
      lastUsedAt: null,
      revokedAt: null,
      createdAt: new Date(0),
      tenantId: context.tenantId
    } as CredentialMetadata);
  }

  readSealedCredentials(_context: TenantContext, _id: string, kind: string): Promise<SealedCredential[]> {
    return Promise.resolve(
      this.credentials
        .filter((credential) => credential.kind === kind && !credential.revoked)
        .map(({ id, kind: storedKind, slot, keyId, nonce, ciphertext }) => ({
          id,
          kind: storedKind,
          slot,
          keyId,
          nonce,
          ciphertext
        }))
    );
  }

  markCredentialUsed(_context: TenantContext, credentialId: string): Promise<void> {
    const credential = this.credentials.find((candidate) => candidate.id === credentialId);
    if (credential) credential.usedAt = new Date(2000);
    return Promise.resolve();
  }

  revokeCredentials(_context: TenantContext, _id: string, kind?: string): Promise<number> {
    let revoked = 0;
    for (const credential of this.credentials) {
      if (credential.revoked || (kind && credential.kind !== kind)) continue;
      credential.revoked = true;
      revoked += 1;
    }
    return Promise.resolve(revoked);
  }

  /** The unique constraint, as the database enforces it: the second insert of a key is not one. */
  recordInboxEvent(_context: TenantContext, input: RecordInboxInput): Promise<RecordInboxResult> {
    const existing = this.inbox.find(
      (event) => event.endpointId === input.endpointId && event.providerEventId === input.providerEventId
    );
    if (existing) return Promise.resolve({ id: existing.id, duplicate: true });
    const recorded = { ...input, id: `x-${this.inbox.length + 1}`, status: "pending" };
    this.inbox.push(recorded);
    return Promise.resolve({ id: recorded.id, duplicate: false });
  }

  finishInboxEvent(_context: TenantContext, eventId: string, outcome: InboxOutcome): Promise<void> {
    const event = this.inbox.find((candidate) => candidate.id === eventId);
    if (event) event.status = outcome.status;
    return Promise.resolve();
  }
}

function serviceFor(repository: FakeRepository): ConnectorIngressService {
  return new ConnectorIngressService(repository as unknown as ConnectorRepository, catalogue, sealer, crypto);
}

/** An endpoint that exists and a secret that signs for it: the state most tests start from. */
async function withLiveEndpoint(repository: FakeRepository = new FakeRepository()) {
  const service = serviceFor(repository);
  const created = await service.createEndpoint(owner, instanceId);
  return { repository, service, secret: created.secret };
}

function delivery(overrides: Partial<IngressDelivery> = {}): IngressDelivery {
  return {
    publicId,
    rawBody: '{"id":"evt_1","type":"invoice.paid"}',
    headers: {},
    receivedAt: signedAt,
    ...overrides
  };
}

/** The headers a correctly signed delivery carries, built from the connector's own signature. */
function signedHeaders(secret: string, rawBody: string, at = timestamp): Record<string, string> {
  const signature = genericWebhook.ingressSignature!;
  return {
    [signature.signatureHeader]: signatureFor(secret, signature.payload(at, rawBody)),
    [signature.timestampHeader]: at
  };
}

async function refusalOf(call: Promise<unknown>): Promise<ConnectorServiceError> {
  try {
    await call;
  } catch (error) {
    if (error instanceof ConnectorServiceError) return error;
    throw error;
  }
  throw new Error("the call was expected to be refused and was not");
}

beforeEach(() => {
  mintedSecrets = 0;
});

describe("minting an ingress endpoint", () => {
  it("hands over the address and the secret once, and stores only the sealed secret", async () => {
    const repository = new FakeRepository();
    const created = await serviceFor(repository).createEndpoint(owner, instanceId);

    expect(created.endpoint.publicId).toBe(publicId);
    expect(created.secret).toBe("minted-secret-1");
    const [stored] = repository.credentials;
    expect(stored).toMatchObject({ kind: ingressCredentialKind, slot: "primary" });
    // Sealed, and bound to this tenant and this instance: the same check the vault performs.
    expect(sealer.open(stored!, { tenantId, instanceId })).toBe(created.secret);
    expect(() => sealer.open(stored!, { tenantId: otherTenantId, instanceId })).toThrow();
  });

  it("refuses a second live endpoint, because one instance holds one signing secret", async () => {
    const { service } = await withLiveEndpoint();
    expect((await refusalOf(service.createEndpoint(owner, instanceId))).code).toBe("ENDPOINT_ALREADY_EXISTS");
  });

  it("refuses a connector that receives nothing, rather than minting an address that answers 404", async () => {
    const repository = new FakeRepository();
    const withoutIngress = {
      types: () => ["generic-webhook"],
      find: () => ({ ...genericWebhook, capabilities: { ...genericWebhook.capabilities, ingress: false } })
    };
    const service = new ConnectorIngressService(
      repository as unknown as ConnectorRepository,
      withoutIngress,
      sealer,
      crypto
    );
    expect((await refusalOf(service.createEndpoint(owner, instanceId))).code).toBe("INGRESS_NOT_SUPPORTED");
  });

  /** Acceptance criterion 7: `Administrator` reads integrations and changes none of them. */
  it("refuses an Administrator, who may look at integrations and not mint one an address", async () => {
    const service = serviceFor(new FakeRepository());
    expect((await refusalOf(service.createEndpoint(administrator, instanceId))).code).toBe("FORBIDDEN");
  });

  it("refuses an instance of another tenant by not finding it", async () => {
    const repository = new FakeRepository();
    const stranger = { ...owner, tenantId: otherTenantId };
    // The fake reads by identifier alone, so this is the repository's own scoping in the real
    // adapter; what is asserted here is that the service asks for the instance before it seals.
    repository.instances.clear();
    expect((await refusalOf(serviceFor(repository).createEndpoint(stranger, instanceId))).code).toBe(
      "INSTANCE_NOT_FOUND"
    );
  });
});

describe("revoking an endpoint", () => {
  it("revokes the address and then the secret that signed for it", async () => {
    const { repository, service } = await withLiveEndpoint();
    const { revokedCredentials } = await service.revokeEndpoint(owner, instanceId, endpointId);

    expect(revokedCredentials).toBe(1);
    expect(repository.endpoints[0]!.revokedAt).not.toBeNull();
    expect(repository.credentials.every((credential) => credential.revoked)).toBe(true);
    // And the address stops resolving, which is what makes a delivery to it answer like any
    // other unknown one.
    expect(await service.accept(delivery({ headers: signedHeaders("minted-secret-1", delivery().rawBody) }))).toEqual({
      status: "refused",
      reason: "unknown_endpoint"
    });
  });

  it("refuses an endpoint identifier that is not this instance's", async () => {
    const { service } = await withLiveEndpoint();
    expect((await refusalOf(service.revokeEndpoint(owner, instanceId, "66666666-6666-4666-8666-666666666666"))).code)
      .toBe("ENDPOINT_NOT_FOUND");
  });

  it("refuses an Administrator", async () => {
    const { service } = await withLiveEndpoint();
    expect((await refusalOf(service.revokeEndpoint(administrator, instanceId, endpointId))).code).toBe("FORBIDDEN");
  });
});

describe("accepting a delivery", () => {
  it("records a correctly signed event and says nothing was processed yet", async () => {
    const { repository, service } = await withLiveEndpoint();
    const sent = delivery();

    const outcome = await service.accept({ ...sent, headers: signedHeaders("minted-secret-1", sent.rawBody) });

    expect(outcome).toEqual({ status: "accepted", eventId: "x-1", duplicate: false, stored: "pending" });
    expect(repository.inbox).toHaveLength(1);
    // The provider's own identifier, so a redelivery is the same row even when the bytes differ.
    expect(repository.inbox[0]).toMatchObject({ providerEventId: "evt_1", endpointId, payload: sent.rawBody });
    expect(repository.credentials[0]!.usedAt).not.toBeNull();
  });

  /** Acceptance criterion 4: the same event delivered twice is one row and one effect. */
  it("stores the same event once however many times a provider sends it", async () => {
    const { repository, service } = await withLiveEndpoint();
    const sent = delivery();
    const headers = signedHeaders("minted-secret-1", sent.rawBody);

    const first = await service.accept({ ...sent, headers });
    const second = await service.accept({ ...sent, headers });
    const later = await service.accept({
      ...sent,
      // The same event, re-sent with a fresh timestamp and signature, as a real redelivery is.
      headers: signedHeaders("minted-secret-1", sent.rawBody, String(Number(timestamp) + 30)),
      receivedAt: new Date(signedAt.getTime() + 30_000)
    });

    expect(first).toMatchObject({ duplicate: false, eventId: "x-1" });
    expect(second).toMatchObject({ duplicate: true, eventId: "x-1" });
    expect(later).toMatchObject({ duplicate: true, eventId: "x-1" });
    expect(repository.inbox).toHaveLength(1);
  });

  it("falls back to the hash of the body when the provider names no event", async () => {
    const { repository, service } = await withLiveEndpoint();
    const sent = delivery({ rawBody: '{"type":"invoice.paid"}' });

    await service.accept({ ...sent, headers: signedHeaders("minted-secret-1", sent.rawBody) });

    expect(repository.inbox[0]!.providerEventId).toBe(crypto.sha256(sent.rawBody));
    expect(repository.inbox[0]!.payloadHash).toBe(crypto.sha256(sent.rawBody));
  });

  it("accepts a signature made with either live secret while a rotation is open", async () => {
    const { repository, service } = await withLiveEndpoint();
    await repository.putCredential(owner, {
      instanceId,
      kind: ingressCredentialKind,
      slot: "secondary",
      ...sealer.seal("the-new-secret", { tenantId, instanceId })
    });
    const sent = delivery();

    const outcome = await service.accept({ ...sent, headers: signedHeaders("the-new-secret", sent.rawBody) });

    expect(outcome).toMatchObject({ status: "accepted" });
    // And the one that matched is the one marked used, which is how an abandoned rotation shows.
    expect(repository.credentials.find((credential) => credential.slot === "secondary")!.usedAt).not.toBeNull();
    expect(repository.credentials.find((credential) => credential.slot === "primary")!.usedAt).toBeNull();
  });

  it("records an event the configuration filters out as discarded, rather than dropping it", async () => {
    const repository = new FakeRepository();
    repository.instances.get(instanceId)!.config = {
      eventIdPath: "id",
      eventTypePath: "type",
      eventTypes: ["invoice.refunded"]
    };
    const { service } = await withLiveEndpoint(repository);
    const sent = delivery();

    const outcome = await service.accept({ ...sent, headers: signedHeaders("minted-secret-1", sent.rawBody) });

    expect(outcome).toMatchObject({ status: "accepted", stored: "discarded" });
    expect(repository.inbox[0]!.status).toBe("discarded");
  });

  it("answers a signed body it cannot read differently, because that provider holds our secret", async () => {
    const { repository, service } = await withLiveEndpoint();
    const sent = delivery({ rawBody: "not json at all" });

    const outcome = await service.accept({ ...sent, headers: signedHeaders("minted-secret-1", sent.rawBody) });

    expect(outcome).toEqual({ status: "unreadable", code: "INVALID_PAYLOAD" });
    expect(repository.inbox).toHaveLength(0);
  });
});

/**
 * Acceptance criterion 4's other half: not enumerable.
 *
 * Every case here leaves through the same shape, and the route turns that one shape into one
 * `404`. A test that asserted a distinct error per case would be describing the leak.
 */
describe("what a delivery that is not accepted looks like", () => {
  it("refuses an unknown address, a revoked one and an instance that is not enabled the same way", async () => {
    const { repository, service } = await withLiveEndpoint();
    const sent = delivery();
    const headers = signedHeaders("minted-secret-1", sent.rawBody);

    const unknown = await service.accept({ ...sent, publicId: "an-address-nobody-ever-minted", headers });
    repository.instances.get(instanceId)!.status = "disabled";
    const disabled = await service.accept({ ...sent, headers });

    expect(unknown.status).toBe("refused");
    expect(disabled.status).toBe("refused");
    expect(repository.inbox).toHaveLength(0);
  });

  it("refuses a signature made with a secret that is not ours, however well formed", async () => {
    const { service } = await withLiveEndpoint();
    const sent = delivery();

    expect(await service.accept({ ...sent, headers: signedHeaders("a-secret-we-never-minted", sent.rawBody) })).toEqual(
      { status: "refused", reason: "signature_mismatch" }
    );
  });

  it("refuses a signature over other bytes: the body cannot be swapped after it was signed", async () => {
    const { service } = await withLiveEndpoint();
    const sent = delivery();
    const headers = signedHeaders("minted-secret-1", sent.rawBody);

    const tampered = await service.accept({ ...sent, rawBody: '{"id":"evt_1","type":"invoice.refunded"}', headers });

    expect(tampered).toEqual({ status: "refused", reason: "signature_mismatch" });
  });

  it("refuses a timestamp outside the window, in either direction, however valid the signature", async () => {
    const { service } = await withLiveEndpoint();
    const sent = delivery();
    const outsideBy = ingressReplayWindowMs / 1000 + 1;

    for (const at of [String(Number(timestamp) - outsideBy), String(Number(timestamp) + outsideBy)]) {
      const outcome = await service.accept({ ...sent, headers: signedHeaders("minted-secret-1", sent.rawBody, at) });
      expect(outcome).toEqual({ status: "refused", reason: "timestamp_out_of_window" });
    }
    // And the edge of the window is still inside it: a provider five minutes behind is a clock
    // to fix, not a delivery to lose.
    const edge = String(Number(timestamp) - ingressReplayWindowMs / 1000);
    const atEdge = await service.accept({ ...sent, headers: signedHeaders("minted-secret-1", sent.rawBody, edge) });
    expect(atEdge).toMatchObject({ status: "accepted" });
  });

  it("refuses a replay of the signed bytes once the window has passed", async () => {
    const { service } = await withLiveEndpoint();
    const sent = delivery();
    const headers = signedHeaders("minted-secret-1", sent.rawBody);

    const replayed = await service.accept({
      ...sent,
      headers,
      receivedAt: new Date(signedAt.getTime() + ingressReplayWindowMs + 1000)
    });

    expect(replayed).toEqual({ status: "refused", reason: "timestamp_out_of_window" });
  });

  it("refuses a delivery with no signature and one with no timestamp", async () => {
    const { service } = await withLiveEndpoint();
    const sent = delivery();
    const headers = signedHeaders("minted-secret-1", sent.rawBody);
    const signature = genericWebhook.ingressSignature!;

    for (const missing of [signature.signatureHeader, signature.timestampHeader]) {
      const partial = { ...headers };
      delete partial[missing];
      expect(await service.accept({ ...sent, headers: partial })).toEqual({
        status: "refused",
        reason: "missing_signature"
      });
    }
  });

  it("refuses everything once the signing secret is revoked, rather than accepting unsigned events", async () => {
    const { repository, service } = await withLiveEndpoint();
    const sent = delivery();
    await repository.revokeCredentials(owner, instanceId, ingressCredentialKind);

    expect(await service.accept({ ...sent, headers: signedHeaders("minted-secret-1", sent.rawBody) })).toEqual({
      status: "refused",
      reason: "no_live_secret"
    });
  });
});

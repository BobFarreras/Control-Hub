import type {
  ConnectorCatalogueEntry,
  ConnectorInstanceRecord,
  CredentialMetadata,
  SyncRunRecord,
  WebhookEndpointRecord
} from "@control-hub/application";
import type { FastifyRequest } from "fastify";
import { describe, expect, it } from "vitest";
import {
  catalogueResponse,
  credentialResponse,
  endpointResponse,
  idempotencyKeyOf,
  instanceResponse,
  runResponse,
  webhookPath
} from "./integrations.js";

const instance: ConnectorInstanceRecord = {
  id: "i-1",
  connectorType: "generic_webhook",
  name: "Provider",
  status: "enabled",
  config: { healthUrl: "https://provider.test/health" },
  configVersion: 3,
  healthStatus: "healthy",
  healthCheckedAt: new Date("2026-08-11T10:00:00.000Z"),
  lastErrorCode: null,
  createdAt: new Date(0),
  updatedAt: new Date(0)
};

/**
 * A credential row as the database holds it, with the envelope columns present.
 *
 * The metadata type has no field for a ciphertext, so this is cast: the point of the test is
 * exactly the case the type is meant to prevent — a row that arrives with more on it than the
 * response was written for.
 */
const credential = {
  id: "c-1",
  kind: "api_key",
  slot: "primary",
  keyId: "2026-08",
  rotatedAt: null,
  expiresAt: null,
  lastUsedAt: null,
  revokedAt: null,
  createdAt: new Date(0),
  nonce: Buffer.alloc(12, 7),
  ciphertext: Buffer.from("sealed-sk_live_9f2c8ab4", "utf8"),
  secret: "sk_live_9f2c8ab4"
} as unknown as CredentialMetadata;

const run: SyncRunRecord = {
  id: "r-1",
  instanceId: "i-1",
  operation: "pull",
  jobId: "job-1",
  attempt: 2,
  status: "failed",
  configVersion: 3,
  startedAt: new Date(0),
  finishedAt: new Date(1000),
  errorCode: "SERVER_ERROR",
  itemsProcessed: 0
};

describe("what an integration response says", () => {
  it("carries the health reading as a reading, with the code that explains it", () => {
    expect(instanceResponse(instance)).toMatchObject({
      id: "i-1",
      status: "enabled",
      configVersion: 3,
      health: { status: "healthy", lastErrorCode: null }
    });
  });
});

describe("what a credential response says", () => {
  /**
   * Acceptance criterion 1, at the layer that decides it: the response is written field by
   * field, so a column added to the table later cannot reach a client by simply existing.
   */
  it("says when it was made and used, and nothing about the secret or the key that seals it", () => {
    const response = credentialResponse(credential);
    const serialized = JSON.stringify(response);
    expect(serialized).not.toContain("sk_live_9f2c8ab4");
    expect(serialized).not.toContain("sealed");
    expect(Object.keys(response).sort()).toEqual([
      "createdAt",
      "expiresAt",
      "id",
      "kind",
      "lastUsedAt",
      "revokedAt",
      "rotatedAt",
      "slot"
    ]);
  });
});

describe("what a run response says", () => {
  it("carries the stable code and never a provider's own message", () => {
    expect(runResponse(run)).toEqual({
      id: "r-1",
      operation: "pull",
      status: "failed",
      attempt: 2,
      configVersion: 3,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      errorCode: "SERVER_ERROR",
      itemsProcessed: 0
    });
  });
});

describe("an idempotency key", () => {
  const requestWith = (key?: string) =>
    ({ headers: key === undefined ? {} : { "idempotency-key": key } }) as unknown as FastifyRequest;

  it("is optional, because pressing a button twice on purpose is allowed", () => {
    expect(idempotencyKeyOf(requestWith())).toBeNull();
    expect(idempotencyKeyOf(requestWith(""))).toBeNull();
  });

  it("is accepted when it is a plain token", () => {
    expect(idempotencyKeyOf(requestWith("2026-08-11.health-check_01"))).toBe("2026-08-11.health-check_01");
  });

  /**
   * The key becomes part of a queue job identifier. A separator inside it is how one caller's
   * retry could be made to land on somebody else's job, so an unusual key is refused rather than
   * escaped — there is no reason a client needs one.
   */
  it("is refused when it could reshape the job identifier it becomes part of", () => {
    for (const key of ["short", "has:colon", "has space", "a".repeat(129), "../../etc"]) {
      expect(() => idempotencyKeyOf(requestWith(key))).toThrow("INVALID_IDEMPOTENCY_KEY");
    }
  });
});

describe("what an endpoint response says", () => {
  /**
   * The address is handed over once, at creation, beside the secret. A listing that repeated it
   * would put the ingress URL of every installation into every screenshot and support ticket,
   * and the record the response is built from has no field for it either.
   */
  it("carries no public identifier, so a listing cannot show the address again", () => {
    const endpoint = {
      id: "e-1",
      instanceId: "i-1",
      createdAt: new Date(0),
      revokedAt: null,
      publicId: "the-address-nobody-should-see-twice",
      tenantId: "t-1"
    } as unknown as WebhookEndpointRecord;

    const response = endpointResponse(endpoint);

    expect(Object.keys(response).sort()).toEqual(["createdAt", "id", "revokedAt"]);
    expect(JSON.stringify(response)).not.toContain("the-address-nobody-should-see-twice");
  });

  /**
   * A path and not an absolute URL: the only thing this API knows about its own address is a
   * `Host` header the caller chose, and building an origin from that hands somebody a URL
   * pointing wherever they liked.
   */
  it("gives the path a provider posts to, for the screen to compose against its own origin", () => {
    expect(webhookPath("an-address")).toBe("/api/v1/webhooks/an-address");
  });
});

describe("offering a connector to a screen", () => {
  const entry: ConnectorCatalogueEntry = {
    type: "n8n",
    contractVersion: 1,
    configFields: [
      { name: "baseUrl", kind: "url", group: "connection", required: true, defaultValue: null },
      { name: "includeArchived", kind: "toggle", group: "behaviour", required: false, defaultValue: false }
    ],
    credentialKinds: ["api_token", "ingress_signing"],
    capabilities: {
      egress: { schemes: ["https"], destination: "configured_base_url" },
      operations: { pull_workflows: { shape: "state", everySeconds: 900 } },
      ingress: true
    }
  };

  /**
   * The fields travel, because without them a screen has nothing to draw a form from and falls
   * back to asking for raw JSON -- which is how an integration ends up being configured over
   * `curl` by whoever knows the key names.
   */
  it("says what to ask for, what it is for, and what it already answers", () => {
    expect(catalogueResponse(entry).configFields).toEqual([
      { name: "baseUrl", kind: "url", group: "connection", required: true, defaultValue: null },
      { name: "includeArchived", kind: "toggle", group: "behaviour", required: false, defaultValue: false }
    ]);
  });

  /** Operations travel as names: a cadence is the installation's business, not a tenant's. */
  it("names the operations without publishing how often they run", () => {
    const response = catalogueResponse(entry);
    expect(response.capabilities.operations).toEqual(["pull_workflows"]);
    expect(JSON.stringify(response)).not.toContain("everySeconds");
  });
});

import type { ConnectorHealth, TenantContext } from "@control-hub/domain";

/**
 * What the connector platform needs from storage.
 *
 * The port is deliberately narrow in one direction: there is no delete. An instance is disabled,
 * a credential is revoked, a run and an inbox entry are the record of what happened. The port
 * cannot express a removal, so no adapter can quietly grow one, and the database refuses it too.
 *
 * Specification: `docs/specifications/connectors.md`.
 */

export class ConnectorStorageError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}

export const connectorInstanceStatuses = ["draft", "enabled", "disabled", "error"] as const;
export type ConnectorInstanceStatus = (typeof connectorInstanceStatuses)[number];

/**
 * A configuration as it survives the round trip through `jsonb`: JSON, and nothing else.
 *
 * `Record<string, unknown>` compiles and then stores whatever the driver made of a `Date`, an
 * `undefined` or a function. What comes back out is JSON either way, so what goes in says so.
 */
export type ConfigValue = null | string | number | boolean | ConfigValue[] | { [key: string]: ConfigValue };
export type ConnectorConfig = { [key: string]: ConfigValue };

export type ConnectorInstanceRecord = {
  id: string;
  connectorType: string;
  name: string;
  status: ConnectorInstanceStatus;
  config: ConnectorConfig;
  configVersion: number;
  healthStatus: ConnectorHealth;
  healthCheckedAt: Date | null;
  lastErrorCode: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type CreateInstanceInput = {
  connectorType: string;
  name: string;
  /** Already parsed by the connector's own schema. The repository stores, it does not validate. */
  config: ConnectorConfig;
};

export type HealthOutcome = {
  status: ConnectorHealth;
  checkedAt: Date;
  errorCode: string | null;
};

/**
 * A credential as it exists at rest: a key identifier, a nonce and a ciphertext.
 *
 * The plain value never has a field here, in either direction. Sealing and opening belong to the
 * vault of ADR-0008; this port only moves the envelope.
 */
export type SealedCredential = {
  id: string;
  kind: string;
  slot: CredentialSlot;
  keyId: string;
  nonce: Uint8Array;
  ciphertext: Uint8Array;
};

export const credentialSlots = ["primary", "secondary"] as const;
export type CredentialSlot = (typeof credentialSlots)[number];

/** What an API response may carry about a credential. Note what is missing. */
export type CredentialMetadata = {
  id: string;
  kind: string;
  slot: CredentialSlot;
  keyId: string;
  rotatedAt: Date | null;
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
};

export type PutCredentialInput = {
  instanceId: string;
  kind: string;
  slot: CredentialSlot;
  keyId: string;
  nonce: Uint8Array;
  ciphertext: Uint8Array;
  expiresAt?: Date | undefined;
};

export const syncRunStatuses = ["running", "succeeded", "failed", "dead_letter"] as const;
export type SyncRunStatus = (typeof syncRunStatuses)[number];

export type SyncRunRecord = {
  id: string;
  instanceId: string;
  operation: string;
  jobId: string;
  attempt: number;
  status: SyncRunStatus;
  configVersion: number;
  startedAt: Date;
  finishedAt: Date | null;
  errorCode: string | null;
  itemsProcessed: number;
};

export type StartRunInput = {
  instanceId: string;
  operation: string;
  /** The queue job. Together with `attempt` it is what makes a redelivery find its own row. */
  jobId: string;
  attempt: number;
  configVersion: number;
};

/**
 * `started` is false when this exact attempt already has a row.
 *
 * At-least-once delivery means a worker can be handed the same attempt twice — after a crash, or
 * after a lease expired while the work was still running. The caller uses this to stop rather
 * than to repeat the effect.
 */
export type StartRunResult = { run: SyncRunRecord; started: boolean };

export type RunOutcome =
  { status: "succeeded"; itemsProcessed: number } | { status: "failed" | "dead_letter"; errorCode: string };

export type RunPage = { items: SyncRunRecord[]; total: number; page: number; pageSize: number };

export type WebhookEndpointRecord = {
  id: string;
  instanceId: string;
  createdAt: Date;
  revokedAt: Date | null;
};

/**
 * The only time `publicId` leaves the database.
 *
 * A listing returns endpoints without it, because the URL is handed over once at creation exactly
 * like the signing secret beside it. Re-displaying it later would put the address of every
 * installation's ingress into every screenshot and support ticket, for no operation that needs it.
 */
export type CreatedWebhookEndpoint = WebhookEndpointRecord & { publicId: string };

/**
 * What resolving an inbound URL is allowed to reveal, and the shape a test pins.
 *
 * There is no `TenantContext` on the call that returns this because at that moment there is no
 * tenant: a provider posted to a public address. Everything after it runs inside the tenant this
 * resolved.
 */
export type ResolvedWebhookEndpoint = {
  id: string;
  tenantId: string;
  instanceId: string;
  connectorType: string;
  status: ConnectorInstanceStatus;
};

export const inboxStatuses = ["pending", "processed", "failed", "discarded"] as const;
export type InboxStatus = (typeof inboxStatuses)[number];

export type InboxRecord = {
  id: string;
  endpointId: string;
  providerEventId: string;
  payloadHash: string;
  payload: string;
  receivedAt: Date;
  status: InboxStatus;
  attempts: number;
  processedAt: Date | null;
};

export type RecordInboxInput = {
  endpointId: string;
  /** The provider's identifier, or the sha256 of the raw body when it sends none. Never empty. */
  providerEventId: string;
  payloadHash: string;
  payload: string;
};

/** `duplicate` is decided by the unique constraint, not by a read the second worker could miss. */
export type RecordInboxResult = { id: string; duplicate: boolean };

export type InboxOutcome = { status: Exclude<InboxStatus, "pending">; processedAt: Date };

export type ConnectorRepository = {
  createInstance(context: TenantContext, input: CreateInstanceInput): Promise<ConnectorInstanceRecord>;
  listInstances(context: TenantContext): Promise<ConnectorInstanceRecord[]>;
  getInstance(context: TenantContext, instanceId: string): Promise<ConnectorInstanceRecord | null>;
  /** Replaces the configuration and raises `configVersion`, so a run can name what it read. */
  updateInstanceConfig(
    context: TenantContext,
    instanceId: string,
    config: ConnectorConfig
  ): Promise<ConnectorInstanceRecord | null>;
  setInstanceStatus(
    context: TenantContext,
    instanceId: string,
    status: ConnectorInstanceStatus
  ): Promise<ConnectorInstanceRecord | null>;
  recordHealth(context: TenantContext, instanceId: string, outcome: HealthOutcome): Promise<void>;

  putCredential(context: TenantContext, input: PutCredentialInput): Promise<CredentialMetadata>;
  listCredentials(context: TenantContext, instanceId: string): Promise<CredentialMetadata[]>;
  /** For the worker, which is the only place an envelope is opened. */
  readSealedCredentials(context: TenantContext, instanceId: string, kind: string): Promise<SealedCredential[]>;
  markCredentialUsed(context: TenantContext, credentialId: string): Promise<void>;
  /** Revokes every live credential of an instance, or of one kind. Returns how many it revoked. */
  revokeCredentials(context: TenantContext, instanceId: string, kind?: string): Promise<number>;

  startRun(context: TenantContext, input: StartRunInput): Promise<StartRunResult>;
  finishRun(context: TenantContext, runId: string, outcome: RunOutcome): Promise<SyncRunRecord | null>;
  listRuns(context: TenantContext, instanceId: string, page: number, pageSize: number): Promise<RunPage>;

  createEndpoint(context: TenantContext, instanceId: string): Promise<CreatedWebhookEndpoint>;
  listEndpoints(context: TenantContext, instanceId: string): Promise<WebhookEndpointRecord[]>;
  revokeEndpoint(context: TenantContext, endpointId: string): Promise<boolean>;
  resolveEndpoint(publicId: string): Promise<ResolvedWebhookEndpoint | null>;

  recordInboxEvent(context: TenantContext, input: RecordInboxInput): Promise<RecordInboxResult>;
  listPendingInbox(context: TenantContext, limit: number): Promise<InboxRecord[]>;
  /** Raises `attempts` and leaves the event pending: a try that failed is not a verdict yet. */
  recordInboxAttempt(context: TenantContext, eventId: string): Promise<void>;
  finishInboxEvent(context: TenantContext, eventId: string, outcome: InboxOutcome): Promise<void>;
};

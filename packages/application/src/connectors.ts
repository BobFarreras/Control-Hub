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

/**
 * What an instance took with it, counted before it went.
 *
 * Only the tables this surface owns. Whatever else cascades — the infrastructure module's links
 * and alert rules — belongs to a module that has its own screen and its own permission, and a
 * count of it here would be this surface reading across a boundary it does not cross anywhere
 * else. The screen that offers the deletion names those in words beforehand instead.
 */
export type DeletedInstanceSummary = {
  instance: ConnectorInstanceRecord;
  removed: { credentials: number; runs: number; endpoints: number };
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
export type CredentialEnvelope = {
  keyId: string;
  nonce: Uint8Array;
  /** The GCM tag travels appended, so a envelope sealed under a retired key fails authentication. */
  ciphertext: Uint8Array;
};

export type SealedCredential = CredentialEnvelope & {
  id: string;
  kind: string;
  slot: CredentialSlot;
};

/**
 * What a ciphertext is bound to.
 *
 * It rides along as additional authenticated data, which is what makes an envelope copied into
 * another tenant's row fail to open even when the master key is the same one.
 */
export type CredentialAad = { tenantId: string; instanceId: string; purpose?: string };

/**
 * The vault, as the use cases see it.
 *
 * Declared here so a service depends on the operation and not on `node:crypto`; the
 * implementation lives beside the repository that writes the column, per ADR-0008.
 */
export type CredentialSealer = {
  seal(plaintext: string, aad: CredentialAad): CredentialEnvelope;
  open(envelope: CredentialEnvelope, aad: CredentialAad): string;
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
 * The three ways asking to start a run can end, and they are genuinely different.
 *
 * `already_attempted` is at-least-once delivery: this exact attempt already has a row, because a
 * worker was handed it twice after a crash or an expired queue lease. The row exists and the
 * caller stops rather than repeating the effect.
 *
 * `already_running` is a *different* pass arriving while the previous one is still going, which
 * is what a provider that got slower looks like. There is no row to hand back, and continuing
 * would mean two passes of one operation writing the same records at once. The ceiling on a slow
 * instance is therefore one worker slot, whatever the cadence says.
 */
export type StartRunResult =
  | { outcome: "started"; run: SyncRunRecord }
  | { outcome: "already_attempted"; run: SyncRunRecord }
  | { outcome: "already_running" };

/**
 * How long a run may be presumed alive before another pass is allowed to take over.
 *
 * A worker killed mid-run leaves a row that says `running` for ever, and with the ceiling above
 * that row would silently disable its operation until somebody noticed and edited the database.
 * The lease is what makes that self-healing. It is far above any legitimate run -- one egress
 * request is budgeted at thirty seconds -- and far below the day it would take a person to spot
 * an operation that had quietly stopped.
 */
export const runLeaseMs = 10 * 60 * 1000;

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

export type PendingInboxRecord = InboxRecord & {
  tenantId: string;
  instanceId: string;
  connectorType: string;
  instanceStatus: ConnectorInstanceStatus;
  config: ConnectorConfig;
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

/**
 * The shape of what an operation returns, mirrored from the connector manifest.
 *
 * Declared again here rather than imported because `packages/application` does not depend on
 * `packages/connectors` and must not start: the use cases coordinate ports, and a port that
 * reached into the registry would make every connector a dependency of the core.
 */
export const connectorRecordShapes = ["state", "event"] as const;
export type ConnectorRecordShape = (typeof connectorRecordShapes)[number];

/** One thing a provider told us about, as it is stored. Never a credential, never a raw body. */
export type ConnectorRecordRow = {
  id: string;
  instanceId: string;
  operation: string;
  externalId: string;
  shape: ConnectorRecordShape;
  data: ConnectorConfig;
  firstSeenAt: Date;
  lastSeenAt: Date;
};

export type UpsertRecordsInput = {
  instanceId: string;
  operation: string;
  shape: ConnectorRecordShape;
  /** What the connector returned. The order is the provider's and carries no meaning. */
  records: readonly { externalId: string; data: ConnectorConfig }[];
  seenAt: Date;
};

/**
 * `inserted` and `updated` are counted apart because they answer different questions: how much is
 * new, and whether a pass that reported work actually changed anything.
 */
export type UpsertRecordsResult = { inserted: number; updated: number };

/**
 * Where an operation left off.
 *
 * `lastSuccessAt` is not decoration: it is the age the screen shows and the freshness an alert
 * rule is measured against. A rule that fires because we stopped looking is worse than no rule.
 */
export type ConnectorOperationStateRecord = {
  instanceId: string;
  operation: string;
  cursor: string | null;
  lastRunAt: Date | null;
  lastSuccessAt: Date | null;
};

export type SaveOperationStateInput = {
  instanceId: string;
  operation: string;
  /** Opaque. Stored and handed back unread, exactly as the connector returned it. */
  cursor: string | null;
  ranAt: Date;
  succeeded: boolean;
};

/**
 * How far back records are kept, decided by the caller and not by the schema.
 *
 * The windows are constants in code, so revising them once real traffic exists costs a release
 * and not a migration. `maxPerOperation` is the hard ceiling that stops a provider we misread
 * from filling the table quietly.
 */
export type PurgeRecordsInput = {
  stateBefore: Date;
  eventBefore: Date;
  maxPerOperation: number;
  /** Bounded so a purge cannot hold locks over a table somebody is reading. */
  batchLimit: number;
};

export type PurgeRecordsResult = { purged: number; trimmed: number };

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
  /**
   * Removes an instance and, by the schema's own cascade, everything that hangs off it.
   *
   * One statement rather than a list of tables written out here: the cascade is already declared
   * in the migrations, and a second copy of it in TypeScript is the copy that goes stale the day
   * somebody adds a table. Null when this tenant has no such instance.
   */
  deleteInstance(context: TenantContext, instanceId: string): Promise<DeletedInstanceSummary | null>;

  putCredential(context: TenantContext, input: PutCredentialInput): Promise<CredentialMetadata>;
  listCredentials(context: TenantContext, instanceId: string): Promise<CredentialMetadata[]>;
  /** For the worker, which is the only place an envelope is opened. */
  readSealedCredentials(context: TenantContext, instanceId: string, kind: string): Promise<SealedCredential[]>;
  markCredentialUsed(context: TenantContext, credentialId: string): Promise<void>;
  /** Revokes every live credential of an instance, or of one kind. Returns how many it revoked. */
  revokeCredentials(context: TenantContext, instanceId: string, kind?: string): Promise<number>;
  /**
   * Ends a rotation: the secondary becomes the primary and the old primary is revoked, together.
   *
   * Null when there is no secondary to promote, and in that case the primary stays exactly as it
   * was — a rotation nobody started must not end with the instance holding no credential at all.
   */
  promoteCredential(context: TenantContext, instanceId: string, kind: string): Promise<CredentialMetadata | null>;

  startRun(context: TenantContext, input: StartRunInput): Promise<StartRunResult>;
  finishRun(context: TenantContext, runId: string, outcome: RunOutcome): Promise<SyncRunRecord | null>;
  listRuns(context: TenantContext, instanceId: string, page: number, pageSize: number): Promise<RunPage>;

  createEndpoint(context: TenantContext, instanceId: string): Promise<CreatedWebhookEndpoint>;
  listEndpoints(context: TenantContext, instanceId: string): Promise<WebhookEndpointRecord[]>;
  revokeEndpoint(context: TenantContext, endpointId: string): Promise<boolean>;
  resolveEndpoint(publicId: string): Promise<ResolvedWebhookEndpoint | null>;

  /**
   * Stores what an operation returned, keyed by the identifier that makes a retry harmless.
   *
   * The unique key does the work: the same pass twice leaves one row per `externalId` with its
   * `lastSeenAt` moved forward. Nothing here reads the data — the platform stores, the module
   * that cares interprets.
   */
  upsertRecords(context: TenantContext, input: UpsertRecordsInput): Promise<UpsertRecordsResult>;
  readOperationState(
    context: TenantContext,
    instanceId: string,
    operation: string
  ): Promise<ConnectorOperationStateRecord | null>;
  saveOperationState(context: TenantContext, input: SaveOperationStateInput): Promise<void>;
  /**
   * Maintenance, and the only call on this port without a tenant.
   *
   * Retention is not a tenant's decision and walking every tenant to delete a handful of rows
   * each would turn one bounded statement into hundreds. It runs through a database function
   * whose predicate is fixed in the schema, so the application role still holds no delete
   * privilege on the table.
   */
  purgeRecords(input: PurgeRecordsInput): Promise<PurgeRecordsResult>;

  recordInboxEvent(context: TenantContext, input: RecordInboxInput): Promise<RecordInboxResult>;
  getPendingInbox(context: TenantContext, eventId: string): Promise<PendingInboxRecord | null>;
  listPendingInbox(context: TenantContext, limit: number): Promise<InboxRecord[]>;
  /** Raises `attempts` and leaves the event pending: a try that failed is not a verdict yet. */
  recordInboxAttempt(context: TenantContext, eventId: string): Promise<void>;
  finishInboxEvent(context: TenantContext, eventId: string, outcome: InboxOutcome): Promise<void>;
};

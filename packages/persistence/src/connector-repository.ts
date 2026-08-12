import { randomBytes, randomUUID } from "node:crypto";
import {
  ConnectorStorageError,
  runLeaseMs,
  type ConnectorConfig,
  type ConnectorInstanceRecord,
  type ConnectorInstanceStatus,
  type ConnectorOperationStateRecord,
  type ConnectorRepository,
  type CreateInstanceInput,
  type CreatedWebhookEndpoint,
  type CredentialMetadata,
  type HealthOutcome,
  type InboxOutcome,
  type InboxRecord,
  type PurgeRecordsInput,
  type PurgeRecordsResult,
  type PutCredentialInput,
  type RecordInboxInput,
  type RecordInboxResult,
  type ResolvedWebhookEndpoint,
  type RunOutcome,
  type RunPage,
  type SaveOperationStateInput,
  type SealedCredential,
  type StartRunInput,
  type StartRunResult,
  type SyncRunRecord,
  type UpsertRecordsInput,
  type UpsertRecordsResult,
  type WebhookEndpointRecord
} from "@control-hub/application";
import { withTenant, type DatabaseClient } from "@control-hub/database";
import type { TenantContext } from "@control-hub/domain";

type DatabaseError = { code?: string; constraint_name?: string };

const instanceColumns = `id, connector_type as "connectorType", name, status, config,
  config_version as "configVersion", health_status as "healthStatus", health_checked_at as "healthCheckedAt",
  last_error_code as "lastErrorCode", created_at as "createdAt", updated_at as "updatedAt"`;

/** Everything about a credential except the envelope. This is what an API response may carry. */
const credentialMetadataColumns = `id, kind, slot, key_id as "keyId", rotated_at as "rotatedAt",
  expires_at as "expiresAt", last_used_at as "lastUsedAt", revoked_at as "revokedAt", created_at as "createdAt"`;

const sealedCredentialColumns = `id, kind, slot, key_id as "keyId", nonce, ciphertext`;

const runColumns = `id, instance_id as "instanceId", operation, job_id as "jobId", attempt, status,
  config_version as "configVersion", started_at as "startedAt", finished_at as "finishedAt",
  error_code as "errorCode", items_processed as "itemsProcessed"`;

const endpointColumns = `id, instance_id as "instanceId", created_at as "createdAt", revoked_at as "revokedAt"`;

const operationStateColumns = `instance_id as "instanceId", operation, cursor,
  last_run_at as "lastRunAt", last_success_at as "lastSuccessAt"`;

/**
 * The columns of a bulk record insert, as one list rather than spread arguments.
 *
 * The driver accepts either form, but only this one typechecks: spread names infer to a
 * `readonly` tuple, and its own `Helper<any, any[]>` wants a mutable array.
 */
const recordInsertColumns = [
  "id",
  "tenant_id",
  "instance_id",
  "operation",
  "external_id",
  "shape",
  "data",
  "first_seen_at",
  "last_seen_at"
] as const;

const inboxColumns = `id, endpoint_id as "endpointId", provider_event_id as "providerEventId",
  payload_hash as "payloadHash", payload, received_at as "receivedAt", status, attempts,
  processed_at as "processedAt"`;

/**
 * Storage for the connector platform.
 *
 * Every method except one goes through `withTenant`, so the isolation is the database's job and
 * not a `where` clause somebody has to remember. The exception is `resolveEndpoint`, and it is
 * commented where it lives.
 *
 * Specification: `docs/specifications/connectors.md`.
 */
export class PostgresConnectorRepository implements ConnectorRepository {
  constructor(private readonly database: DatabaseClient) {}

  async createInstance(context: TenantContext, input: CreateInstanceInput): Promise<ConnectorInstanceRecord> {
    return withTenant(this.database, context.tenantId, async (tx) => {
      const [instance] = await tx<ConnectorInstanceRecord[]>`
        insert into connector_instances (id, tenant_id, connector_type, name, config)
        values (${randomUUID()}, ${context.tenantId}, ${input.connectorType}, ${input.name.trim()},
          ${tx.json(input.config)})
        returning ${tx.unsafe(instanceColumns)}`;
      return instance!;
    }).catch(mapConstraint);
  }

  async listInstances(context: TenantContext): Promise<ConnectorInstanceRecord[]> {
    return withTenant(this.database, context.tenantId, async (tx) => {
      return tx<ConnectorInstanceRecord[]>`
        select ${tx.unsafe(instanceColumns)} from connector_instances
        where tenant_id = ${context.tenantId} order by name asc, id asc`;
    });
  }

  async getInstance(context: TenantContext, instanceId: string): Promise<ConnectorInstanceRecord | null> {
    return withTenant(this.database, context.tenantId, async (tx) => {
      const [instance] = await tx<ConnectorInstanceRecord[]>`
        select ${tx.unsafe(instanceColumns)} from connector_instances
        where tenant_id = ${context.tenantId} and id = ${instanceId}`;
      return instance ?? null;
    });
  }

  /**
   * The version rises with the configuration it describes, in the same statement.
   *
   * Computing it as `max + 1` from a read would hand two concurrent edits the same number, and a
   * run recorded against that number would then point at a configuration that never existed.
   */
  async updateInstanceConfig(
    context: TenantContext,
    instanceId: string,
    config: ConnectorConfig
  ): Promise<ConnectorInstanceRecord | null> {
    return withTenant(this.database, context.tenantId, async (tx) => {
      const [instance] = await tx<ConnectorInstanceRecord[]>`
        update connector_instances
        set config = ${tx.json(config)}, config_version = config_version + 1, updated_at = now()
        where tenant_id = ${context.tenantId} and id = ${instanceId}
        returning ${tx.unsafe(instanceColumns)}`;
      return instance ?? null;
    }).catch(mapConstraint);
  }

  async setInstanceStatus(
    context: TenantContext,
    instanceId: string,
    status: ConnectorInstanceStatus
  ): Promise<ConnectorInstanceRecord | null> {
    return withTenant(this.database, context.tenantId, async (tx) => {
      const [instance] = await tx<ConnectorInstanceRecord[]>`
        update connector_instances
        set status = ${status},
            -- A disabled instance reports no health of its own: nothing is calling the provider,
            -- so the last reading describes a world that no longer exists.
            health_status = case when ${status} = 'disabled' then 'disabled' else health_status end,
            health_checked_at = case when ${status} = 'disabled' then null else health_checked_at end,
            updated_at = now()
        where tenant_id = ${context.tenantId} and id = ${instanceId}
        returning ${tx.unsafe(instanceColumns)}`;
      return instance ?? null;
    }).catch(mapConstraint);
  }

  async recordHealth(context: TenantContext, instanceId: string, outcome: HealthOutcome): Promise<void> {
    await withTenant(this.database, context.tenantId, async (tx) => {
      await tx`
        update connector_instances
        set health_status = ${outcome.status}, health_checked_at = ${outcome.checkedAt},
            last_error_code = ${outcome.errorCode}, updated_at = now()
        where tenant_id = ${context.tenantId} and id = ${instanceId}`;
    }).catch(mapConstraint);
  }

  async putCredential(context: TenantContext, input: PutCredentialInput): Promise<CredentialMetadata> {
    return withTenant(this.database, context.tenantId, async (tx) => {
      const [credential] = await tx<CredentialMetadata[]>`
        insert into connector_credentials
          (id, tenant_id, instance_id, kind, slot, key_id, nonce, ciphertext, expires_at, rotated_at)
        values (${randomUUID()}, ${context.tenantId}, ${input.instanceId}, ${input.kind}, ${input.slot},
          ${input.keyId}, ${Buffer.from(input.nonce)}, ${Buffer.from(input.ciphertext)},
          ${input.expiresAt ?? null}, now())
        returning ${tx.unsafe(credentialMetadataColumns)}`;
      return credential!;
    }).catch(mapConstraint);
  }

  async listCredentials(context: TenantContext, instanceId: string): Promise<CredentialMetadata[]> {
    return withTenant(this.database, context.tenantId, async (tx) => {
      return tx<CredentialMetadata[]>`
        select ${tx.unsafe(credentialMetadataColumns)} from connector_credentials
        where tenant_id = ${context.tenantId} and instance_id = ${instanceId}
        order by created_at desc, id asc`;
    });
  }

  /**
   * The live envelopes of one kind, newest slot first.
   *
   * One or two, never more, because the database will not hold a third: during a rotation both
   * verify, which is what lets a provider be switched over without a window where neither works.
   */
  async readSealedCredentials(context: TenantContext, instanceId: string, kind: string): Promise<SealedCredential[]> {
    return withTenant(this.database, context.tenantId, async (tx) => {
      return tx<SealedCredential[]>`
        select ${tx.unsafe(sealedCredentialColumns)} from connector_credentials
        where tenant_id = ${context.tenantId} and instance_id = ${instanceId} and kind = ${kind}
          and revoked_at is null and (expires_at is null or expires_at > now())
        order by case slot when 'secondary' then 0 else 1 end, created_at desc`;
    });
  }

  async markCredentialUsed(context: TenantContext, credentialId: string): Promise<void> {
    await withTenant(this.database, context.tenantId, async (tx) => {
      await tx`
        update connector_credentials set last_used_at = now()
        where tenant_id = ${context.tenantId} and id = ${credentialId} and revoked_at is null`;
    });
  }

  async revokeCredentials(context: TenantContext, instanceId: string, kind?: string): Promise<number> {
    return withTenant(this.database, context.tenantId, async (tx) => {
      const revoked = await tx<{ id: string }[]>`
        update connector_credentials set revoked_at = now(), updated_at = now()
        where tenant_id = ${context.tenantId} and instance_id = ${instanceId} and revoked_at is null
          and (${kind ?? null}::text is null or kind = ${kind ?? null})
        returning id`;
      return revoked.length;
    });
  }

  /**
   * Ends a rotation inside one transaction: the old primary is revoked and the secondary takes
   * its place, in that order because the partial unique index will not hold two live primaries.
   *
   * The `for update` on the secondary is what makes two concurrent promotions safe. The second
   * one waits, then re-evaluates its own `where` against the row as it now is — no longer a
   * secondary — finds nothing, and answers null instead of revoking the credential the first one
   * just promoted and leaving the instance with none.
   */
  async promoteCredential(
    context: TenantContext,
    instanceId: string,
    kind: string
  ): Promise<CredentialMetadata | null> {
    return withTenant(this.database, context.tenantId, async (tx) => {
      const [secondary] = await tx<{ id: string }[]>`
        select id from connector_credentials
        where tenant_id = ${context.tenantId} and instance_id = ${instanceId} and kind = ${kind}
          and slot = 'secondary' and revoked_at is null
        for update`;
      if (!secondary) return null;

      await tx`
        update connector_credentials set revoked_at = now(), updated_at = now()
        where tenant_id = ${context.tenantId} and instance_id = ${instanceId} and kind = ${kind}
          and slot = 'primary' and revoked_at is null`;

      const [promoted] = await tx<CredentialMetadata[]>`
        update connector_credentials set slot = 'primary', rotated_at = now(), updated_at = now()
        where tenant_id = ${context.tenantId} and id = ${secondary.id}
        returning ${tx.unsafe(credentialMetadataColumns)}`;
      return promoted ?? null;
    }).catch(mapConstraint);
  }

  /**
   * Opens a run, or says why it could not.
   *
   * Three things happen here in one transaction, and the order matters. First a run whose lease
   * has expired is written off, because a worker killed mid-run would otherwise hold its
   * operation shut for ever. Then the insert, where `on conflict do nothing` answers the
   * at-least-once question the database is the only one able to answer -- two workers racing
   * cannot both win it. Last, the partial unique index answers the other question: if a previous
   * pass is genuinely still running, the insert violates it and this pass stands down.
   */
  async startRun(context: TenantContext, input: StartRunInput): Promise<StartRunResult> {
    return withTenant(this.database, context.tenantId, async (tx) => {
      await tx`
        update connector_sync_runs
        set status = 'dead_letter', finished_at = now(), error_code = 'RUN_ABANDONED'
        where tenant_id = ${context.tenantId} and instance_id = ${input.instanceId}
          and operation = ${input.operation} and status = 'running'
          and started_at < now() - ${`${runLeaseMs} milliseconds`}::interval`;

      const [inserted] = await tx<SyncRunRecord[]>`
        insert into connector_sync_runs
          (id, tenant_id, instance_id, operation, job_id, attempt, config_version)
        values (${randomUUID()}, ${context.tenantId}, ${input.instanceId}, ${input.operation},
          ${input.jobId}, ${input.attempt}, ${input.configVersion})
        on conflict (tenant_id, job_id, attempt) do nothing
        returning ${tx.unsafe(runColumns)}`;
      if (inserted) return { outcome: "started" as const, run: inserted };

      const [existing] = await tx<SyncRunRecord[]>`
        select ${tx.unsafe(runColumns)} from connector_sync_runs
        where tenant_id = ${context.tenantId} and job_id = ${input.jobId} and attempt = ${input.attempt}`;
      return { outcome: "already_attempted" as const, run: existing! };
    }).catch((error) => {
      // The one violation that is an ordinary answer rather than a fault: a pass arrived while
      // the previous one was still going, and standing down is the correct behaviour.
      if (isUniqueViolation(error, "connector_sync_runs_one_running_idx")) {
        return { outcome: "already_running" as const };
      }
      return mapConstraint(error);
    });
  }

  /**
   * Closes a run that is still open, and answers null when it was already closed.
   *
   * The `status = 'running'` predicate is what makes a second finish a no-op instead of a second
   * set of numbers: a redelivered job must not turn one execution into two lines of history.
   */
  async finishRun(context: TenantContext, runId: string, outcome: RunOutcome): Promise<SyncRunRecord | null> {
    return withTenant(this.database, context.tenantId, async (tx) => {
      const errorCode = outcome.status === "succeeded" ? null : outcome.errorCode;
      const itemsProcessed = outcome.status === "succeeded" ? outcome.itemsProcessed : 0;
      const [run] = await tx<SyncRunRecord[]>`
        update connector_sync_runs
        set status = ${outcome.status}, finished_at = now(), error_code = ${errorCode},
            items_processed = ${itemsProcessed}
        where tenant_id = ${context.tenantId} and id = ${runId} and status = 'running'
        returning ${tx.unsafe(runColumns)}`;
      return run ?? null;
    }).catch(mapConstraint);
  }

  async listRuns(context: TenantContext, instanceId: string, page: number, pageSize: number): Promise<RunPage> {
    return withTenant(this.database, context.tenantId, async (tx) => {
      const offset = (page - 1) * pageSize;
      const items = await tx<SyncRunRecord[]>`
        select ${tx.unsafe(runColumns)} from connector_sync_runs
        where tenant_id = ${context.tenantId} and instance_id = ${instanceId}
        order by started_at desc, id asc limit ${pageSize} offset ${offset}`;
      const [count] = await tx<{ total: string }[]>`
        select count(*)::text as total from connector_sync_runs
        where tenant_id = ${context.tenantId} and instance_id = ${instanceId}`;
      return { items, total: Number(count!.total), page, pageSize };
    });
  }

  /**
   * Mints an ingress endpoint. `publicId` is 32 random bytes, and this is the only time it is read
   * out of the database: the URL is handed over once, beside the signing secret.
   */
  async createEndpoint(context: TenantContext, instanceId: string): Promise<CreatedWebhookEndpoint> {
    return withTenant(this.database, context.tenantId, async (tx) => {
      const [endpoint] = await tx<CreatedWebhookEndpoint[]>`
        insert into connector_webhook_endpoints (id, tenant_id, instance_id, public_id)
        values (${randomUUID()}, ${context.tenantId}, ${instanceId}, ${randomBytes(32).toString("base64url")})
        returning ${tx.unsafe(endpointColumns)}, public_id as "publicId"`;
      return endpoint!;
    }).catch(mapConstraint);
  }

  async listEndpoints(context: TenantContext, instanceId: string): Promise<WebhookEndpointRecord[]> {
    return withTenant(this.database, context.tenantId, async (tx) => {
      return tx<WebhookEndpointRecord[]>`
        select ${tx.unsafe(endpointColumns)} from connector_webhook_endpoints
        where tenant_id = ${context.tenantId} and instance_id = ${instanceId}
        order by created_at desc, id asc`;
    });
  }

  async revokeEndpoint(context: TenantContext, endpointId: string): Promise<boolean> {
    return withTenant(this.database, context.tenantId, async (tx) => {
      const revoked = await tx<{ id: string }[]>`
        update connector_webhook_endpoints set revoked_at = now(), updated_at = now()
        where tenant_id = ${context.tenantId} and id = ${endpointId} and revoked_at is null
        returning id`;
      return revoked.length > 0;
    });
  }

  /**
   * The single query that runs outside a tenant context, because a provider posting to a public
   * URL has not identified one yet.
   *
   * It calls a `security definer` function whose result set is fixed in the schema — five columns,
   * no configuration, no credential — so widening it takes a migration somebody reviews rather
   * than an edit here. A revoked endpoint resolves to nothing, which is what lets the route answer
   * an unknown identifier and a revoked one with the same `404`.
   */
  async resolveEndpoint(publicId: string): Promise<ResolvedWebhookEndpoint | null> {
    const [endpoint] = await this.database<ResolvedWebhookEndpoint[]>`
      select id, tenant_id as "tenantId", instance_id as "instanceId",
        connector_type as "connectorType", status
      from resolve_connector_webhook_endpoint(${publicId})`;
    return endpoint ?? null;
  }

  /**
   * Writes what an operation returned, in one statement.
   *
   * `xmax = 0` is how PostgreSQL answers "was this row inserted or updated" from an upsert: a
   * freshly inserted row has no deleting transaction, an updated one carries the id of the
   * transaction that locked it. The two counts are worth separating because they answer
   * different questions -- how much is new, and whether a pass that claimed work changed
   * anything at all.
   */
  async upsertRecords(context: TenantContext, input: UpsertRecordsInput): Promise<UpsertRecordsResult> {
    if (input.records.length === 0) return { inserted: 0, updated: 0 };

    return withTenant(this.database, context.tenantId, async (tx) => {
      const rows = input.records.map((record) => ({
        id: randomUUID(),
        tenant_id: context.tenantId,
        instance_id: input.instanceId,
        operation: input.operation,
        external_id: record.externalId,
        shape: input.shape,
        data: tx.json(record.data) as unknown as string,
        first_seen_at: input.seenAt,
        last_seen_at: input.seenAt
      }));

      const written = await tx<{ inserted: boolean }[]>`
        insert into connector_records ${tx(rows, recordInsertColumns)}
        on conflict (tenant_id, instance_id, operation, external_id) do update
          set data = excluded.data,
              last_seen_at = excluded.last_seen_at,
              -- The shape follows the manifest that wrote it last, so a release that changes one
              -- does not leave rows expiring by a rule nobody can find any more.
              shape = excluded.shape
        returning (xmax = 0) as inserted`;

      const inserted = written.filter((row) => row.inserted).length;
      return { inserted, updated: written.length - inserted };
    }).catch(mapConstraint);
  }

  async readOperationState(
    context: TenantContext,
    instanceId: string,
    operation: string
  ): Promise<ConnectorOperationStateRecord | null> {
    return withTenant(this.database, context.tenantId, async (tx) => {
      const [state] = await tx<ConnectorOperationStateRecord[]>`
        select ${tx.unsafe(operationStateColumns)} from connector_operation_state
        where tenant_id = ${context.tenantId} and instance_id = ${instanceId} and operation = ${operation}`;
      return state ?? null;
    });
  }

  /**
   * Records where an operation got to, and when it last worked.
   *
   * `last_success_at` only moves on success, which is the whole point: it is the age a screen
   * shows. A failed pass that refreshed it would make a connector that has been broken for a day
   * look like it answered a moment ago.
   */
  async saveOperationState(context: TenantContext, input: SaveOperationStateInput): Promise<void> {
    await withTenant(this.database, context.tenantId, async (tx) => {
      await tx`
        insert into connector_operation_state
          (id, tenant_id, instance_id, operation, cursor, last_run_at, last_success_at)
        values (${randomUUID()}, ${context.tenantId}, ${input.instanceId}, ${input.operation},
          ${input.cursor}, ${input.ranAt}, ${input.succeeded ? input.ranAt : null})
        on conflict (tenant_id, instance_id, operation) do update
          set cursor = excluded.cursor,
              last_run_at = excluded.last_run_at,
              last_success_at = coalesce(excluded.last_success_at, connector_operation_state.last_success_at),
              updated_at = now()`;
    }).catch(mapConstraint);
  }

  /**
   * Retention. No tenant, and no delete privilege either: the function fixes the predicate in the
   * schema and runs as its owner, so this call cannot become a delete of somebody's choosing.
   */
  async purgeRecords(input: PurgeRecordsInput): Promise<PurgeRecordsResult> {
    const [result] = await this.database<{ purged: string; trimmed: string }[]>`
      select purged, trimmed from purge_connector_records(
        ${input.stateBefore}, ${input.eventBefore}, ${input.maxPerOperation}, ${input.batchLimit})`;
    return { purged: Number(result?.purged ?? 0), trimmed: Number(result?.trimmed ?? 0) };
  }

  /**
   * Writes an event, or reports that it is one we already hold.
   *
   * The verdict comes from the unique constraint. A read followed by a write would let two
   * workers both find nothing and both insert, which is exactly the duplicate the whole ingress
   * path exists to avoid.
   */
  async recordInboxEvent(context: TenantContext, input: RecordInboxInput): Promise<RecordInboxResult> {
    return withTenant(this.database, context.tenantId, async (tx) => {
      const [inserted] = await tx<{ id: string }[]>`
        insert into connector_inbox
          (id, tenant_id, endpoint_id, provider_event_id, payload_hash, payload)
        values (${randomUUID()}, ${context.tenantId}, ${input.endpointId}, ${input.providerEventId},
          ${input.payloadHash}, ${input.payload})
        on conflict (tenant_id, endpoint_id, provider_event_id) do nothing
        returning id`;
      if (inserted) return { id: inserted.id, duplicate: false };

      const [existing] = await tx<{ id: string }[]>`
        select id from connector_inbox
        where tenant_id = ${context.tenantId} and endpoint_id = ${input.endpointId}
          and provider_event_id = ${input.providerEventId}`;
      return { id: existing!.id, duplicate: true };
    }).catch(mapConstraint);
  }

  async listPendingInbox(context: TenantContext, limit: number): Promise<InboxRecord[]> {
    return withTenant(this.database, context.tenantId, async (tx) => {
      return tx<InboxRecord[]>`
        select ${tx.unsafe(inboxColumns)} from connector_inbox
        where tenant_id = ${context.tenantId} and status = 'pending'
        order by received_at asc, id asc limit ${limit}`;
    });
  }

  async recordInboxAttempt(context: TenantContext, eventId: string): Promise<void> {
    await withTenant(this.database, context.tenantId, async (tx) => {
      await tx`
        update connector_inbox set attempts = attempts + 1
        where tenant_id = ${context.tenantId} and id = ${eventId} and status = 'pending'`;
    }).catch(mapConstraint);
  }

  async finishInboxEvent(context: TenantContext, eventId: string, outcome: InboxOutcome): Promise<void> {
    await withTenant(this.database, context.tenantId, async (tx) => {
      await tx`
        update connector_inbox set status = ${outcome.status}, processed_at = ${outcome.processedAt}
        where tenant_id = ${context.tenantId} and id = ${eventId} and status = 'pending'`;
    }).catch(mapConstraint);
  }
}

/**
 * Turns the constraints above into codes the layers on top can act on.
 *
 * The distinction that matters is between a name a person chose twice and a live slot already
 * taken: the first is a form error, the second means a rotation is already open and finishing it
 * is a different operation from starting one.
 */
/** Narrow enough to be a fact about one index, rather than "some uniqueness was violated". */
function isUniqueViolation(error: unknown, indexName: string): boolean {
  const databaseError = error as DatabaseError;
  return databaseError.code === "23505" && databaseError.constraint_name === indexName;
}

function mapConstraint(error: unknown): never {
  const databaseError = error as DatabaseError;
  if (databaseError.code === "23505" && databaseError.constraint_name?.includes("live_slot")) {
    throw new ConnectorStorageError("CREDENTIAL_SLOT_TAKEN");
  }
  if (databaseError.code === "23505" && databaseError.constraint_name?.includes("name")) {
    throw new ConnectorStorageError("DUPLICATE_INSTANCE_NAME");
  }
  if (databaseError.code === "23505") throw new ConnectorStorageError("DUPLICATE_ENTRY");
  if (databaseError.code === "23503") throw new ConnectorStorageError("INSTANCE_NOT_FOUND");
  if (databaseError.code === "23514") throw new ConnectorStorageError("INVALID_INPUT");
  throw error;
}

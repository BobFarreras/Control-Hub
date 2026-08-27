import { randomUUID } from "node:crypto";
import {
  ConnectorActionError,
  normalizeMailRecipient,
  type ActionRequestRecord,
  type ConnectorActionRepository
} from "@control-hub/application";
import { withTenant, type DatabaseClient } from "@control-hub/database";
import type { TenantContext } from "@control-hub/domain";

const columns = `id, instance_id as "instanceId", action, status, external_id as "externalId",
  error_code as "errorCode", created_at as "createdAt", finished_at as "finishedAt"`;

export type MailActionWork = {
  requestId: string;
  instanceId: string;
  connectorType: string;
  recipient: string;
  subject: string;
  body: string;
};

export class PostgresConnectorActionRepository implements ConnectorActionRepository {
  constructor(private readonly database: DatabaseClient) {}

  async storeConfirmation(
    context: TenantContext,
    input: Parameters<ConnectorActionRepository["storeConfirmation"]>[1]
  ) {
    await withTenant(this.database, context.tenantId, async (tx) => {
      await tx`insert into connector_action_confirmations
        (id, tenant_id, instance_id, membership_id, action, nonce_hash, input_digest, expires_at)
        values (${randomUUID()}, ${context.tenantId}, ${input.instanceId}, ${context.membershipId}, ${input.action},
          ${input.nonceHash}, ${input.inputDigest}, ${input.expiresAt})`;
    });
  }

  async queueMailReply(
    context: TenantContext,
    input: Parameters<ConnectorActionRepository["queueMailReply"]>[1]
  ): Promise<ActionRequestRecord> {
    return withTenant(this.database, context.tenantId, async (tx) => {
      const [existing] = await tx<(ActionRequestRecord & { inputDigest: string })[]>`
        select ${tx.unsafe(columns)}, input_digest as "inputDigest" from connector_action_requests
        where tenant_id = ${context.tenantId} and instance_id = ${input.instanceId}
          and action = ${input.action} and idempotency_key = ${input.idempotencyKey}`;
      if (existing) {
        if (existing.inputDigest !== input.inputDigest) throw new ConnectorActionError("IDEMPOTENCY_KEY_REUSED");
        return existing;
      }

      const consumed = await tx`update connector_action_confirmations set consumed_at = ${input.now}
        where tenant_id = ${context.tenantId} and instance_id = ${input.instanceId}
          and membership_id = ${context.membershipId} and action = ${input.action}
          and nonce_hash = ${input.nonceHash} and input_digest = ${input.inputDigest}
          and consumed_at is null and expires_at > ${input.now} returning id`;
      if (consumed.length !== 1) throw new ConnectorActionError("ACTION_CONFIRMATION_INVALID");

      const [ticket] = await tx<{ recipient: string | null; subject: string }[]>`
        select c.billing_email as recipient, t.subject from tickets t
        join customers c on c.tenant_id = t.tenant_id and c.id = t.customer_id
        where t.tenant_id = ${context.tenantId} and t.id = ${input.ticketId} and t.status <> 'closed'`;
      if (!ticket) throw new ConnectorActionError("TICKET_NOT_FOUND");
      if (!ticket.recipient) throw new ConnectorActionError("MAIL_RECIPIENT_MISSING");
      const recipient = normalizeMailRecipient(ticket.recipient);
      const requestId = randomUUID();
      const messageId = randomUUID();
      const correlationId = randomUUID();
      const deliveryId = randomUUID();
      const subject = `Re: ${ticket.subject}`.slice(0, 500);

      const [request] = await tx<ActionRequestRecord[]>`insert into connector_action_requests
        (id, tenant_id, instance_id, membership_id, action, idempotency_key, input_digest, correlation_id)
        values (${requestId}, ${context.tenantId}, ${input.instanceId}, ${context.membershipId}, ${input.action},
          ${input.idempotencyKey}, ${input.inputDigest}, ${correlationId}) returning ${tx.unsafe(columns)}`;
      await tx`insert into ticket_messages
        (id, tenant_id, ticket_id, author_membership_id, body, visibility)
        values (${messageId}, ${context.tenantId}, ${input.ticketId}, ${context.membershipId}, ${input.body}, 'customer')`;
      await tx`insert into mail_deliveries
        (id, tenant_id, ticket_id, ticket_message_id, action_request_id, instance_id, recipient_address, subject)
        values (${deliveryId}, ${context.tenantId}, ${input.ticketId}, ${messageId}, ${requestId}, ${input.instanceId},
          ${recipient}, ${subject})`;
      await tx`insert into connector_action_outbox (request_id, tenant_id) values (${requestId}, ${context.tenantId})`;
      return request!;
    });
  }

  async get(context: TenantContext, instanceId: string, requestId: string) {
    return withTenant(this.database, context.tenantId, async (tx) => {
      const [request] = await tx<ActionRequestRecord[]>`select ${tx.unsafe(columns)} from connector_action_requests
        where tenant_id = ${context.tenantId} and instance_id = ${instanceId} and id = ${requestId}`;
      return request ?? null;
    });
  }

  async pendingOutbox(context: TenantContext): Promise<string[]> {
    return withTenant(this.database, context.tenantId, async (tx) =>
      (
        await tx<{ requestId: string }[]>`select request_id as "requestId" from connector_action_outbox
          where tenant_id = ${context.tenantId} and published_at is null and available_at <= now()
          order by available_at, request_id limit 100`
      ).map((row) => row.requestId)
    );
  }

  async markPublished(context: TenantContext, requestId: string) {
    await withTenant(this.database, context.tenantId, async (tx) => {
      await tx`update connector_action_outbox set published_at = now(), attempts = attempts + 1
        where tenant_id = ${context.tenantId} and request_id = ${requestId} and published_at is null`;
    });
  }

  async acquire(context: TenantContext, requestId: string): Promise<MailActionWork | null> {
    return withTenant(this.database, context.tenantId, async (tx) => {
      const rows = await tx<MailActionWork[]>`update connector_action_requests ar set status = 'running',
        started_at = now(), updated_at = now() from mail_deliveries d, ticket_messages tm, connector_instances ci
        where ar.tenant_id = ${context.tenantId} and ar.id = ${requestId} and ar.status = 'queued'
          and d.tenant_id = ar.tenant_id and d.action_request_id = ar.id
          and tm.tenant_id = d.tenant_id and tm.id = d.ticket_message_id
          and ci.tenant_id = ar.tenant_id and ci.id = ar.instance_id
        returning ar.id as "requestId", ar.instance_id as "instanceId", ci.connector_type as "connectorType",
          d.recipient_address as recipient, d.subject, tm.body`;
      return rows[0] ?? null;
    });
  }

  async complete(
    context: TenantContext,
    requestId: string,
    result: { status: "succeeded" | "failed" | "unknown"; externalId?: string; errorCode?: string }
  ) {
    await withTenant(this.database, context.tenantId, async (tx) => {
      await tx`update connector_action_requests set status = ${result.status}, external_id = ${result.externalId ?? null},
        error_code = ${result.errorCode ?? null}, finished_at = now(), updated_at = now()
        where tenant_id = ${context.tenantId} and id = ${requestId} and status = 'running'`;
    });
  }
}

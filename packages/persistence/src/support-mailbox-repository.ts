import { randomUUID } from "node:crypto";
import {
  SupportMailboxError,
  type ClassifiedInboundMessage,
  type InboundMessagePage,
  type MailboxTicketOption,
  type SlaTargets,
  type SupportMailboxInboxRepository,
  type SupportMailboxRepository
} from "@control-hub/application";
import { withTenant, type DatabaseClient } from "@control-hub/database";
import type { TenantContext, TicketPriority } from "@control-hub/domain";
import type postgres from "postgres";

export class PostgresSupportMailboxRepository implements SupportMailboxInboxRepository {
  constructor(private readonly database: DatabaseClient) {}

  async storePending(
    context: TenantContext,
    input: Parameters<SupportMailboxRepository["storePending"]>[1]
  ): Promise<{ inserted: number }> {
    return withTenant(this.database, context.tenantId, async (tx) => {
      const [channel] = await tx<{ id: string }[]>`
        insert into support_mailbox_channels (id, tenant_id, instance_id)
        values (${randomUUID()}, ${context.tenantId}, ${input.instanceId})
        on conflict (tenant_id, instance_id) do update set updated_at = support_mailbox_channels.updated_at
        returning id`;
      if (!channel) throw new Error("SUPPORT_MAILBOX_CHANNEL_NOT_FOUND");

      let inserted = 0;
      for (const message of input.messages) {
        const rows = await tx`
          insert into support_inbound_messages
            (id, tenant_id, channel_id, external_id, thread_key, sender_address, sender_name,
             subject, preview, received_at)
          values (${randomUUID()}, ${context.tenantId}, ${channel.id}, ${message.externalId},
            ${message.threadKey}, ${message.senderAddress}, ${message.senderName}, ${message.subject},
            ${message.preview}, ${message.receivedAt})
          on conflict (tenant_id, channel_id, external_id) do nothing
          returning id`;
        inserted += rows.length;
      }
      return { inserted };
    });
  }

  async list(
    context: TenantContext,
    query: Parameters<SupportMailboxInboxRepository["list"]>[1]
  ): Promise<InboundMessagePage> {
    return withTenant(this.database, context.tenantId, async (tx) => {
      const search = query.search?.trim() || null;
      const offset = (query.page - 1) * query.pageSize;
      const items = await tx<InboundMessagePage["items"]>`
        select m.id, ci.name as "instanceName", m.sender_address as "senderAddress",
          m.sender_name as "senderName", m.subject, m.preview, m.received_at as "receivedAt", m.status,
          m.customer_id as "customerId", c.display_name as "customerName", m.ticket_id as "ticketId",
          t.ticket_number::int as "ticketNumber", suggested.id as "suggestedCustomerId",
          suggested.display_name as "suggestedCustomerName"
        from support_inbound_messages m
        join support_mailbox_channels ch on ch.tenant_id = m.tenant_id and ch.id = m.channel_id
        join connector_instances ci on ci.tenant_id = ch.tenant_id and ci.id = ch.instance_id
        left join customers c on c.tenant_id = m.tenant_id and c.id = m.customer_id
        left join tickets t on t.tenant_id = m.tenant_id and t.id = m.ticket_id
        left join lateral (
          select candidate.id, candidate.display_name from customers candidate
          where candidate.tenant_id = m.tenant_id and (
            candidate.normalized_billing_email = lower(m.sender_address) or exists (
              select 1 from contacts contact where contact.tenant_id = candidate.tenant_id
                and contact.customer_id = candidate.id and contact.normalized_email = lower(m.sender_address)
            )
          ) order by candidate.display_name, candidate.id limit 1
        ) suggested on true
        where m.tenant_id = ${context.tenantId} and m.status = ${query.status}
          and (${search}::text is null or m.sender_address ilike '%' || ${search} || '%'
            or coalesce(m.sender_name, '') ilike '%' || ${search} || '%'
            or coalesce(m.subject, '') ilike '%' || ${search} || '%')
        order by m.received_at desc, m.id limit ${query.pageSize} offset ${offset}`;
      const [count] = await tx<{ total: string }[]>`
        select count(*)::text as total from support_inbound_messages m
        where m.tenant_id = ${context.tenantId} and m.status = ${query.status}
          and (${search}::text is null or m.sender_address ilike '%' || ${search} || '%'
            or coalesce(m.sender_name, '') ilike '%' || ${search} || '%'
            or coalesce(m.subject, '') ilike '%' || ${search} || '%')`;
      return { items, total: Number(count!.total), page: query.page, pageSize: query.pageSize };
    });
  }

  async listTicketOptions(context: TenantContext, customerId?: string): Promise<MailboxTicketOption[]> {
    return withTenant(
      this.database,
      context.tenantId,
      (tx) => tx<MailboxTicketOption[]>`
      select id, ticket_number::int as "ticketNumber", subject, customer_id as "customerId"
      from tickets where tenant_id = ${context.tenantId} and status <> 'closed'
        and (${customerId ?? null}::uuid is null or customer_id = ${customerId ?? null}::uuid)
      order by updated_at desc, id limit 250`
    );
  }

  async currentTargets(context: TenantContext, priority: TicketPriority, at: Date): Promise<SlaTargets | null> {
    return withTenant(this.database, context.tenantId, async (tx) => {
      const [row] = await tx<SlaTargets[]>`select first_response_minutes as "firstResponseMinutes",
        resolution_minutes as "resolutionMinutes" from sla_targets where tenant_id = ${context.tenantId}
        and priority = ${priority} and effective_from <= ${at} order by effective_from desc limit 1`;
      return row ?? null;
    });
  }

  async classifyExisting(
    context: TenantContext,
    input: Parameters<SupportMailboxInboxRepository["classifyExisting"]>[1]
  ): Promise<ClassifiedInboundMessage> {
    return withTenant(this.database, context.tenantId, async (tx) => {
      const message = await lockPending(tx, context, input.messageId);
      const [ticket] = await tx<{ id: string; ticketNumber: number; status: string }[]>`
        select id, ticket_number::int as "ticketNumber", status from tickets
        where tenant_id = ${context.tenantId} and id = ${input.ticketId} and customer_id = ${input.customerId}`;
      if (!ticket) throw new SupportMailboxError("TICKET_CUSTOMER_MISMATCH");
      if (ticket.status === "closed") throw new SupportMailboxError("TICKET_CLOSED");
      await tx`insert into ticket_messages (id, tenant_id, ticket_id, author_membership_id, body, visibility,
        external_reference, created_at) values (${randomUUID()}, ${context.tenantId}, ${ticket.id}, null,
        ${message.preview ?? message.subject ?? message.senderAddress}, 'customer', ${`mail-inbound:${message.id}`},
        ${message.receivedAt})`;
      await markClassified(tx, context, input, ticket.id);
      return { messageId: message.id, ticketId: ticket.id, ticketNumber: ticket.ticketNumber };
    });
  }

  async classifyNew(
    context: TenantContext,
    input: Parameters<SupportMailboxInboxRepository["classifyNew"]>[1]
  ): Promise<ClassifiedInboundMessage> {
    return withTenant(this.database, context.tenantId, async (tx) => {
      const message = await lockPending(tx, context, input.messageId);
      const [customer] =
        await tx`select id from customers where tenant_id = ${context.tenantId} and id = ${input.customerId}`;
      if (!customer) throw new SupportMailboxError("CUSTOMER_NOT_FOUND");
      await tx`insert into ticket_counters (tenant_id) values (${context.tenantId}) on conflict do nothing`;
      const [counter] = await tx<{ value: string }[]>`update ticket_counters set next_number = next_number + 1
        where tenant_id = ${context.tenantId} returning next_number - 1 as value`;
      const ticketId = randomUUID();
      const ticketNumber = Number(counter!.value);
      const subject = message.subject && message.subject.length >= 3 ? message.subject : message.senderAddress;
      await tx`insert into tickets (id, tenant_id, ticket_number, customer_id, subject, description, priority,
        category, first_response_target_minutes, resolution_target_minutes, opened_at)
        values (${ticketId}, ${context.tenantId}, ${ticketNumber}, ${input.customerId},
          ${subject}, ${message.preview ?? message.subject ?? message.senderAddress},
          ${input.priority}, 'email', ${input.targets.firstResponseMinutes}, ${input.targets.resolutionMinutes},
          ${message.receivedAt})`;
      await tx`insert into ticket_events (id, tenant_id, ticket_id, actor_membership_id, type, to_value, created_at)
        values (${randomUUID()}, ${context.tenantId}, ${ticketId}, ${context.membershipId}, 'created', 'new', ${input.at})`;
      await markClassified(tx, context, input, ticketId);
      return { messageId: message.id, ticketId, ticketNumber };
    });
  }

  async discard(context: TenantContext, input: Parameters<SupportMailboxInboxRepository["discard"]>[1]): Promise<void> {
    await withTenant(this.database, context.tenantId, async (tx) => {
      const rows = await tx`update support_inbound_messages set status = 'discarded',
        classified_by_membership_id = ${context.membershipId}, classified_at = ${input.at}, updated_at = ${input.at}
        where tenant_id = ${context.tenantId} and id = ${input.messageId} and status = 'pending' returning id`;
      if (rows.length === 0) throw new SupportMailboxError("INBOUND_MESSAGE_NOT_PENDING");
    });
  }

  async discardMany(
    context: TenantContext,
    input: Parameters<SupportMailboxInboxRepository["discardMany"]>[1]
  ): Promise<number> {
    return withTenant(this.database, context.tenantId, async (tx) => {
      const rows = await tx<{ id: string }[]>`update support_inbound_messages set status = 'discarded',
        classified_by_membership_id = ${context.membershipId}, classified_at = ${input.at}, updated_at = ${input.at}
        where tenant_id = ${context.tenantId} and id in ${tx(input.messageIds)} and status = 'pending' returning id`;
      if (rows.length !== input.messageIds.length) throw new SupportMailboxError("INBOUND_MESSAGE_NOT_PENDING");
      return rows.length;
    });
  }
}

type MailTx = postgres.TransactionSql;
type LockedMessage = {
  id: string;
  preview: string | null;
  subject: string | null;
  senderAddress: string;
  receivedAt: Date;
};

async function lockPending(tx: MailTx, context: TenantContext, messageId: string): Promise<LockedMessage> {
  const [message] = await tx<LockedMessage[]>`select id, preview, subject, sender_address as "senderAddress",
    received_at as "receivedAt" from support_inbound_messages where tenant_id = ${context.tenantId}
    and id = ${messageId} and status = 'pending' for update`;
  if (!message) throw new SupportMailboxError("INBOUND_MESSAGE_NOT_PENDING");
  return message;
}

async function markClassified(
  tx: MailTx,
  context: TenantContext,
  input: { messageId: string; customerId: string; at: Date },
  ticketId: string
) {
  await tx`update support_inbound_messages set status = 'classified', customer_id = ${input.customerId},
    ticket_id = ${ticketId}, classified_by_membership_id = ${context.membershipId},
    classified_at = ${input.at}, updated_at = ${input.at}
    where tenant_id = ${context.tenantId} and id = ${input.messageId}`;
}

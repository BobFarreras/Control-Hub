import { randomUUID } from "node:crypto";
import type { SupportMailboxRepository } from "@control-hub/application";
import { withTenant, type DatabaseClient } from "@control-hub/database";
import type { TenantContext } from "@control-hub/domain";

export class PostgresSupportMailboxRepository implements SupportMailboxRepository {
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
}

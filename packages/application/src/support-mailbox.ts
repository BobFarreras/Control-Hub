import { ticketPriorities, type TenantContext, type TicketPriority } from "@control-hub/domain";
import { SupportError, type SlaTargets } from "./support.js";

export class SupportMailboxError extends SupportError {
  constructor(public override readonly code: string) {
    super(code);
  }
}

export type InboundMessageStatus = "pending" | "classified" | "discarded";
export type InboundMessageRow = {
  id: string;
  instanceName: string;
  senderAddress: string;
  senderName: string | null;
  subject: string | null;
  preview: string | null;
  receivedAt: Date;
  status: InboundMessageStatus;
  customerId: string | null;
  customerName: string | null;
  ticketId: string | null;
  ticketNumber: number | null;
  suggestedCustomerId: string | null;
  suggestedCustomerName: string | null;
};
export type InboundMessagePage = { items: InboundMessageRow[]; total: number; page: number; pageSize: number };
export type MailboxTicketOption = { id: string; ticketNumber: number; subject: string; customerId: string };
export type MailboxListQuery = { status: InboundMessageStatus; search?: string; page: number; pageSize: number };
export type ClassifiedInboundMessage = { messageId: string; ticketId: string; ticketNumber: number };

export type MailboxConnectorRecord = {
  externalId: string;
  data: Readonly<Record<string, unknown>>;
};

export type PendingInboundMessage = {
  externalId: string;
  threadKey: string;
  senderAddress: string;
  senderName: string | null;
  subject: string | null;
  preview: string | null;
  receivedAt: Date;
};

export interface SupportMailboxRepository {
  storePending(
    context: TenantContext,
    input: { instanceId: string; messages: readonly PendingInboundMessage[] }
  ): Promise<{ inserted: number }>;
}

export interface SupportMailboxInboxRepository extends SupportMailboxRepository {
  list(context: TenantContext, query: MailboxListQuery): Promise<InboundMessagePage>;
  listTicketOptions(context: TenantContext, customerId?: string): Promise<MailboxTicketOption[]>;
  currentTargets(context: TenantContext, priority: TicketPriority, at: Date): Promise<SlaTargets | null>;
  classifyExisting(
    context: TenantContext,
    input: { messageId: string; customerId: string; ticketId: string; at: Date }
  ): Promise<ClassifiedInboundMessage>;
  classifyNew(
    context: TenantContext,
    input: { messageId: string; customerId: string; priority: TicketPriority; targets: SlaTargets; at: Date }
  ): Promise<ClassifiedInboundMessage>;
  discard(context: TenantContext, input: { messageId: string; at: Date }): Promise<void>;
  discardMany(context: TenantContext, input: { messageIds: readonly string[]; at: Date }): Promise<number>;
}

export class SupportMailboxService {
  constructor(private readonly repository: SupportMailboxInboxRepository) {}

  list(context: TenantContext, query: MailboxListQuery) {
    return this.repository.list(context, query);
  }

  listTicketOptions(context: TenantContext, customerId?: string) {
    return this.repository.listTicketOptions(context, customerId);
  }

  async classify(
    context: TenantContext,
    input: { messageId: string; customerId: string; ticketId?: string; priority?: TicketPriority },
    now = new Date()
  ) {
    if (input.ticketId)
      return this.repository.classifyExisting(context, {
        messageId: input.messageId,
        customerId: input.customerId,
        ticketId: input.ticketId,
        at: now
      });
    if (!input.priority || !ticketPriorities.includes(input.priority)) throw new SupportMailboxError("INVALID_INPUT");
    const targets = await this.repository.currentTargets(context, input.priority, now);
    if (!targets) throw new SupportMailboxError("SLA_TARGETS_NOT_CONFIGURED");
    return this.repository.classifyNew(context, {
      messageId: input.messageId,
      customerId: input.customerId,
      priority: input.priority,
      targets,
      at: now
    });
  }

  discard(context: TenantContext, messageId: string, now = new Date()) {
    return this.repository.discard(context, { messageId, at: now });
  }

  discardMany(context: TenantContext, messageIds: readonly string[], now = new Date()) {
    const unique = [...new Set(messageIds)];
    if (unique.length === 0 || unique.length > 100) throw new SupportMailboxError("INVALID_INPUT");
    return this.repository.discardMany(context, { messageIds: unique, at: now });
  }
}

/**
 * Validates and projects the deliberately small connector record into the support inbox.
 * Raw MIME and attachments never cross this boundary.
 */
export class SupportMailboxIngestor {
  constructor(private readonly repository: SupportMailboxRepository) {}

  async ingest(
    context: TenantContext,
    input: { instanceId: string; connectorType: string; operation: string; records: readonly MailboxConnectorRecord[] }
  ) {
    if (!mailConnectorTypes.has(input.connectorType) || input.operation !== "pull_messages") return { inserted: 0 };
    const messages = input.records.map(parseRecord);
    return this.repository.storePending(context, { instanceId: input.instanceId, messages });
  }
}

const mailConnectorTypes = new Set(["imap", "gmail", "microsoft_graph_mail"]);

function parseRecord(record: MailboxConnectorRecord): PendingInboundMessage {
  const value = record.data;
  const senderAddress = requiredString(value.from, 3, 320);
  const mailboxMessageId = requiredString(value.mailboxMessageId, 1, 512);
  const receivedAtText = requiredString(value.receivedAt, 1, 64);
  const receivedAt = new Date(receivedAtText);
  if (Number.isNaN(receivedAt.getTime()) || record.externalId.length < 1 || record.externalId.length > 512) invalid();

  return {
    externalId: record.externalId,
    threadKey: optionalString(value.threadId, 512) ?? optionalString(value.messageId, 512) ?? mailboxMessageId,
    senderAddress: senderAddress.toLowerCase(),
    senderName: optionalString(value.fromName, 200),
    subject: optionalString(value.subject, 500),
    preview: optionalString(value.preview, 4_000),
    receivedAt
  };
}

function requiredString(value: unknown, min: number, max: number): string {
  const parsed = optionalString(value, max);
  if (parsed === null || parsed.length < min) invalid();
  return parsed;
}

function optionalString(value: unknown, max: number): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") invalid();
  const parsed = value.trim();
  if (parsed.length === 0) return null;
  if (parsed.length > max || [...parsed].some(isForbiddenControlCharacter)) invalid();
  return parsed;
}

function isForbiddenControlCharacter(character: string): boolean {
  const codePoint = character.codePointAt(0)!;
  return codePoint === 127 || (codePoint < 32 && codePoint !== 9 && codePoint !== 10 && codePoint !== 13);
}

function invalid(): never {
  throw new SupportMailboxError("INVALID_MAILBOX_RECORD");
}

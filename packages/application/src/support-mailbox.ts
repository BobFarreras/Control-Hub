import type { TenantContext } from "@control-hub/domain";

export class SupportMailboxError extends Error {
  constructor(public readonly code: "INVALID_MAILBOX_RECORD") {
    super(code);
  }
}

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

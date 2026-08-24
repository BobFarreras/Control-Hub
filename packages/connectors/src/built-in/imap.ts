import { z } from "zod";
import { ConnectorError, connectorContractVersion, defineConnector, type MailMessage } from "../contract.js";

const imapConfigSchema = z.strictObject({
  mailboxUrl: z.url().refine((value) => value.startsWith("imaps://"), "IMAPS_REQUIRED"),
  folder: z.string().trim().min(1).max(255).default("INBOX")
});

export type ImapConfig = z.infer<typeof imapConfigSchema>;

const maxMessagesPerRun = 50;
const maxHeaderBytes = 64 * 1024;
const maxBodyBytes = 256 * 1024;
const maxPreviewCharacters = 4_000;

function recordData(message: MailMessage) {
  return {
    mailboxMessageId: message.id,
    threadId: message.threadId,
    messageId: message.messageIdHeader,
    subject: message.subject,
    from: message.from?.address ?? null,
    fromName: message.from?.name ?? null,
    to: message.to.map((address) => address.address),
    receivedAt: message.receivedAt.toISOString(),
    preview: message.text?.slice(0, maxPreviewCharacters) ?? null
  };
}

export const imap = defineConnector<ImapConfig>({
  type: "imap",
  contractVersion: connectorContractVersion,
  configSchema: imapConfigSchema,
  configFields: [
    { name: "mailboxUrl", kind: "url", group: "connection" },
    { name: "folder", kind: "text", group: "behaviour" }
  ],
  credentialKinds: ["imap_username", "imap_password"],
  capabilities: {
    egress: null,
    operations: { pull_messages: { shape: "event", everySeconds: 300 } },
    ingress: false,
    mailbox: { ports: [993], tls: "direct" }
  },
  async health(context) {
    const folders = await context.mailbox!.listFolders();
    return folders.some((folder) => folder.id === context.config.folder)
      ? { status: "ok" }
      : { status: "failed", failure: "not_found" };
  },
  operations: {
    async pull_messages(context, input) {
      const page = await context.mailbox!.changes({
        folderId: context.config.folder,
        cursor: input.cursor,
        limit: maxMessagesPerRun
      });
      const records = [];
      for (const change of page.changes) {
        const message = await context.mailbox!.message(
          { folderId: context.config.folder, messageId: change.messageId },
          { maxHeaderBytes, maxBodyBytes }
        );
        if (message.id !== change.messageId) throw new ConnectorError("MAILBOX_MESSAGE_MISMATCH");
        records.push({
          externalId: `${context.config.folder}:${message.id}`,
          data: recordData(message)
        });
      }
      return { records, cursor: page.cursor };
    }
  }
});

import { describe, expect, it } from "vitest";
import type { ConnectorContext, MailboxPort } from "../contract.js";
import { imap, type ImapConfig } from "./imap.js";

const mailbox: MailboxPort = {
  listFolders: () => Promise.resolve([{ id: "INBOX", name: "Inbox" }]),
  changes: (input) =>
    Promise.resolve({
      changes: [{ messageId: "42", receivedAt: new Date("2026-08-24T08:00:00Z") }],
      cursor: input.cursor === null ? "uid:42" : input.cursor
    }),
  message: (_ref, limits) => {
    expect(limits).toEqual({ maxHeaderBytes: 65_536, maxBodyBytes: 262_144 });
    return Promise.resolve({
      id: "42",
      threadId: null,
      messageIdHeader: "<42@example.test>",
      subject: "Need help",
      from: { address: "sender@example.test", name: "Sender" },
      to: [{ address: "support@example.test", name: null }],
      receivedAt: new Date("2026-08-24T08:00:00Z"),
      text: "The safe preview"
    });
  }
};

function context(): ConnectorContext<ImapConfig> {
  return {
    instanceId: "instance-1",
    config: { mailboxUrl: "imaps://mail.example.test:993", folder: "INBOX" },
    http: { send: () => Promise.reject(new Error("not used")) },
    secrets: { open: () => Promise.resolve("not used by the connector") },
    logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
    clock: { now: () => new Date("2026-08-24T08:00:00Z") },
    mailbox
  };
}

describe("IMAP connector", () => {
  it("reads a bounded incremental page and advances the opaque cursor", async () => {
    const result = await imap.run("pull_messages", context(), { cursor: null });
    expect(result.cursor).toBe("uid:42");
    expect(result.records).toEqual([
      {
        externalId: "INBOX:42",
        data: {
          mailboxMessageId: "42",
          threadId: null,
          messageId: "<42@example.test>",
          subject: "Need help",
          from: "sender@example.test",
          fromName: "Sender",
          to: ["support@example.test"],
          receivedAt: "2026-08-24T08:00:00.000Z",
          preview: "The safe preview"
        }
      }
    ]);
  });

  it("does not declare HTTP egress or insecure IMAP", () => {
    expect(imap.capabilities.egress).toBeNull();
    expect(imap.capabilities.mailbox).toEqual({ ports: [993], tls: "direct" });
  });
});

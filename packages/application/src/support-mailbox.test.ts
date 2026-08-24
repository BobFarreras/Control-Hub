import type { TenantContext } from "@control-hub/domain";
import { describe, expect, it, vi } from "vitest";
import { SupportMailboxIngestor, type SupportMailboxRepository } from "./support-mailbox.js";

const context: TenantContext = {
  tenantId: "00000000-0000-4000-8000-000000000001",
  membershipId: "system",
  userId: "system",
  roles: [],
  permissions: ["integrations:read"],
  mfaEnabled: true
};

function repository() {
  return { storePending: vi.fn<SupportMailboxRepository["storePending"]>().mockResolvedValue({ inserted: 1 }) };
}

describe("SupportMailboxIngestor", () => {
  it("projects only bounded support fields and normalizes the sender", async () => {
    const repo = repository();
    await new SupportMailboxIngestor(repo).ingest(context, {
      instanceId: "00000000-0000-4000-8000-000000000002",
      connectorType: "imap",
      operation: "pull_messages",
      records: [
        {
          externalId: "INBOX:42",
          data: {
            mailboxMessageId: "42",
            threadId: "thread-1",
            messageId: "<message@example.test>",
            from: " Client@Example.Test ",
            fromName: "Client",
            subject: "Help",
            preview: "The site is unavailable",
            receivedAt: "2026-08-24T10:00:00.000Z",
            attachment: "must not cross the boundary"
          }
        }
      ]
    });
    expect(repo.storePending).toHaveBeenCalledWith(context, {
      instanceId: "00000000-0000-4000-8000-000000000002",
      messages: [
        {
          externalId: "INBOX:42",
          threadKey: "thread-1",
          senderAddress: "client@example.test",
          senderName: "Client",
          subject: "Help",
          preview: "The site is unavailable",
          receivedAt: new Date("2026-08-24T10:00:00.000Z")
        }
      ]
    });
  });

  it("rejects malformed and oversized records before persistence", async () => {
    const repo = repository();
    const ingestor = new SupportMailboxIngestor(repo);
    await expect(
      ingestor.ingest(context, {
        instanceId: "instance",
        connectorType: "imap",
        operation: "pull_messages",
        records: [{ externalId: "x", data: { mailboxMessageId: "1", from: "a@b", receivedAt: "not-a-date" } }]
      })
    ).rejects.toMatchObject({ code: "INVALID_MAILBOX_RECORD" });
    expect(repo.storePending).not.toHaveBeenCalled();
  });

  it("ignores records from connectors that do not own the mailbox projection", async () => {
    const repo = repository();
    await expect(
      new SupportMailboxIngestor(repo).ingest(context, {
        instanceId: "instance",
        connectorType: "openai-usage",
        operation: "pull_usage",
        records: []
      })
    ).resolves.toEqual({ inserted: 0 });
    expect(repo.storePending).not.toHaveBeenCalled();
  });
});

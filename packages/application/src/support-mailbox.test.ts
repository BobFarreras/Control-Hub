import type { TenantContext } from "@control-hub/domain";
import { describe, expect, it, vi } from "vitest";
import {
  SupportMailboxIngestor,
  SupportMailboxService,
  type SupportMailboxInboxRepository,
  type SupportMailboxRepository
} from "./support-mailbox.js";

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

describe("SupportMailboxService", () => {
  function inboxRepository(): SupportMailboxInboxRepository {
    return {
      storePending: vi.fn(),
      list: vi.fn(),
      listTicketOptions: vi.fn(),
      currentTargets: vi.fn().mockResolvedValue({ firstResponseMinutes: 60, resolutionMinutes: 480 }),
      classifyExisting: vi.fn().mockResolvedValue({ messageId: "message", ticketId: "ticket", ticketNumber: 7 }),
      classifyNew: vi.fn().mockResolvedValue({ messageId: "message", ticketId: "ticket", ticketNumber: 8 }),
      discard: vi.fn(),
      discardMany: vi.fn().mockResolvedValue(2)
    };
  }

  it("uses the existing-ticket transaction when a ticket is selected", async () => {
    const repo = inboxRepository();
    await new SupportMailboxService(repo).classify(context, {
      messageId: "message",
      customerId: "customer",
      ticketId: "ticket"
    });
    expect(repo.classifyExisting).toHaveBeenCalledOnce();
    expect(repo.classifyNew).not.toHaveBeenCalled();
  });

  it("copies the current SLA targets when it creates a ticket", async () => {
    const repo = inboxRepository();
    await new SupportMailboxService(repo).classify(
      context,
      { messageId: "message", customerId: "customer", priority: "high" },
      new Date("2026-08-25T10:00:00Z")
    );
    expect(repo.classifyNew).toHaveBeenCalledWith(
      context,
      expect.objectContaining({ priority: "high", targets: { firstResponseMinutes: 60, resolutionMinutes: 480 } })
    );
  });

  it("refuses a new ticket without a valid priority", async () => {
    await expect(
      new SupportMailboxService(inboxRepository()).classify(context, { messageId: "message", customerId: "customer" })
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("deduplicates identifiers before a bulk discard", async () => {
    const repo = inboxRepository();
    await new SupportMailboxService(repo).discardMany(context, ["one", "one", "two"]);
    expect(repo.discardMany).toHaveBeenCalledWith(context, expect.objectContaining({ messageIds: ["one", "two"] }));
  });
});

import { describe, expect, it, vi } from "vitest";
import type { HttpPort } from "../contract.js";
import { microsoftGraphMail } from "./microsoft-graph-mail.js";

const context = (send: HttpPort["send"]) => ({
  instanceId: "instance",
  config: { baseUrl: "https://graph.microsoft.com", mailbox: "me", folderId: "inbox" },
  http: { send },
  secrets: { open: vi.fn().mockResolvedValue("oauth-access-token-for-tests") },
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  clock: { now: () => new Date() }
});

describe("microsoft graph mail", () => {
  it("keeps the opaque delta cursor and projects only safe mail fields", async () => {
    const cursor = "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$deltatoken=opaque";
    const send = vi.fn<HttpPort["send"]>().mockResolvedValue({
      status: 200,
      headers: {},
      body: JSON.stringify({
        "@odata.deltaLink": cursor,
        value: [
          {
            id: "m1",
            conversationId: "c1",
            internetMessageId: "<m1@test>",
            subject: "Help",
            bodyPreview: "Preview",
            receivedDateTime: "2026-08-24T10:00:00Z",
            from: { emailAddress: { address: "Client@Example.Test", name: "Client" } },
            hasAttachments: true
          }
        ]
      })
    });
    const result = await microsoftGraphMail.run("pull_messages", context(send), { cursor: null });
    expect(result.cursor).toBe(cursor);
    expect(result.records[0]).toEqual({
      externalId: "m1",
      data: {
        mailboxMessageId: "m1",
        threadId: "c1",
        messageId: "<m1@test>",
        subject: "Help",
        from: "client@example.test",
        fromName: "Client",
        to: [],
        receivedAt: "2026-08-24T10:00:00.000Z",
        preview: "Preview"
      }
    });
    expect(JSON.stringify(result.records)).not.toContain("hasAttachments");
  });

  it("refuses a cursor that points outside Graph", async () => {
    await expect(
      microsoftGraphMail.run("pull_messages", context(vi.fn<HttpPort["send"]>()), { cursor: "https://evil.test/steal" })
    ).rejects.toThrow("GRAPH_CURSOR_INVALID");
  });
});

import { describe, expect, it, vi } from "vitest";
import type { HttpPort } from "../contract.js";
import { gmail } from "./gmail.js";

const token = "oauth-access-token-for-tests";
const context = (send: HttpPort["send"]) => ({
  instanceId: "instance",
  config: { mailbox: "me", baseUrl: "https://gmail.googleapis.com", labelId: "INBOX" },
  http: { send },
  secrets: { open: vi.fn().mockResolvedValue(token) },
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  clock: { now: () => new Date("2026-08-24T10:00:00Z") }
});

describe("gmail", () => {
  it("performs an initial bounded read and returns the provider history cursor", async () => {
    const send = vi
      .fn<HttpPort["send"]>()
      .mockResolvedValueOnce({ status: 200, headers: {}, body: JSON.stringify({ messages: [{ id: "m1" }] }) })
      .mockResolvedValueOnce({
        status: 200,
        headers: {},
        body: JSON.stringify({
          id: "m1",
          threadId: "t1",
          historyId: "99",
          internalDate: "1787565600000",
          snippet: "Preview",
          payload: {
            headers: [
              { name: "From", value: "Client <client@example.test>" },
              { name: "Subject", value: "Help" }
            ]
          }
        })
      });
    const result = await gmail.run("pull_messages", context(send), { cursor: null });
    expect(result.cursor).toBe("99");
    expect(result.records[0]).toMatchObject({
      externalId: "m1",
      data: { from: "client@example.test", threadId: "t1" }
    });
    expect(send.mock.calls[1]?.[0].headers).toEqual({ authorization: `Bearer ${token}` });
  });

  it("deduplicates message ids returned by overlapping history entries", async () => {
    const send = vi
      .fn<HttpPort["send"]>()
      .mockResolvedValueOnce({
        status: 200,
        headers: {},
        body: JSON.stringify({
          history: [{ messagesAdded: [{ message: { id: "m1" } }] }, { messagesAdded: [{ message: { id: "m1" } }] }]
        })
      })
      .mockResolvedValueOnce({
        status: 200,
        headers: {},
        body: JSON.stringify({
          id: "m1",
          historyId: "101",
          internalDate: "1787565600000",
          payload: { headers: [{ name: "From", value: "a@b.test" }] }
        })
      });
    const result = await gmail.run("pull_messages", context(send), { cursor: "100" });
    expect(result.records).toHaveLength(1);
    expect(result.cursor).toBe("101");
  });
});

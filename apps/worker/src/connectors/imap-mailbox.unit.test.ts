import { describe, expect, it } from "vitest";
import { createImapMailbox } from "./imap-mailbox.js";

const missingSecrets = {
  open: () => Promise.reject(new Error("SECRET_REACHED"))
};

describe("guarded IMAP mailbox", () => {
  it("rejects plaintext and non-standard ports before opening a credential", async () => {
    await expect(
      createImapMailbox({ mailboxUrl: "imap://mail.example.test:143", secrets: missingSecrets, allowlist: [] })
    ).rejects.toThrow("SCHEME_NOT_ALLOWED");
    await expect(
      createImapMailbox({ mailboxUrl: "imaps://mail.example.test:994", secrets: missingSecrets, allowlist: [] })
    ).rejects.toThrow("DESTINATION_NOT_ALLOWLISTED");
  });

  it("rejects credentials embedded in the destination", async () => {
    await expect(
      createImapMailbox({
        mailboxUrl: "imaps://user:pass@mail.example.test:993",
        secrets: missingSecrets,
        allowlist: []
      })
    ).rejects.toThrow("URL_HAS_CREDENTIALS");
  });

  it("blocks private DNS answers unless the exact IMAPS origin is operator allowlisted", async () => {
    const resolve = () => Promise.resolve({ address: "10.0.0.4", family: 4 });
    await expect(
      createImapMailbox({
        mailboxUrl: "imaps://mail.internal:993",
        secrets: missingSecrets,
        allowlist: [],
        resolve
      })
    ).rejects.toThrow("ADDRESS_NOT_ROUTABLE");

    await expect(
      createImapMailbox({
        mailboxUrl: "imaps://mail.internal:993",
        secrets: missingSecrets,
        allowlist: [{ scheme: "imaps:", hostname: "mail.internal", port: 993 }],
        resolve
      })
    ).rejects.toThrow("SECRET_REACHED");
  });
});

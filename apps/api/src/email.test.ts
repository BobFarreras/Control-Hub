import { describe, expect, it } from "vitest";
import { mailTransportOptions } from "./email.js";

const relay = { host: "smtp.example.com", port: 587, secure: true, from: "hub@example.com" };

describe("the mail transport", () => {
  it("authenticates when the installation was given a credential", () => {
    const options = mailTransportOptions({ ...relay, user: "hub", password: "relay-password" });
    expect(options.auth).toEqual({ user: "hub", pass: "relay-password" });
  });

  it("sends none when there is nothing to send", () => {
    // Mailpit, and any relay that trusts its own network. An empty `auth` object is not the same
    // thing: nodemailer would offer AUTH with an empty user and a relay that accepts anonymous
    // mail would start refusing it.
    expect(mailTransportOptions(relay)).not.toHaveProperty("auth");
  });

  it("treats half a credential as none rather than as half", () => {
    // The configuration layer refuses this pair before it gets here. If that check is ever
    // removed, offering AUTH with an empty password is the worse of the two failures: it is a
    // rejected session instead of a refused boot.
    expect(mailTransportOptions({ ...relay, user: "hub" })).not.toHaveProperty("auth");
    expect(mailTransportOptions({ ...relay, password: "relay-password" })).not.toHaveProperty("auth");
  });

  it("keeps the two hardening flags nodemailer does not default", () => {
    const options = mailTransportOptions(relay);
    expect(options.disableFileAccess).toBe(true);
    expect(options.disableUrlAccess).toBe(true);
  });
});

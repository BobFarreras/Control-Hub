import { describe, expect, it } from "vitest";
import { allowlistLine, tunnelCommand } from "./connector-diagnosis.js";

/**
 * The one sentence in the guided check that needs an address, and the reason the check does not
 * ask the server for one.
 *
 * The API answers a diagnosis with no address in it at all -- not the configured `baseUrl`, not a
 * provider hostname, not a credential. That is deliberate, so the sentence about opening a tunnel
 * is composed here instead, out of what the person has just typed into the form in front of them.
 * Which makes this module the fence: everything it is handed is already the operator's own, and
 * everything it emits is read off a screen and pasted into a terminal.
 */
describe("the tunnel command the guided check offers", () => {
  it("opens the typed port against the loopback of the typed machine", () => {
    expect(tunnelCommand("http://vps.example.test:9090")).toEqual({
      command:
        "ssh -N -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -L 127.0.0.1:9090:127.0.0.1:9090 user@vps.example.test",
      needsHost: false
    });
  });

  /**
   * A URL with no port is not a URL with no port: it is a URL on the scheme's port, and a command
   * that forwarded nothing would send somebody looking for a fault in the tunnel.
   */
  it("falls back to the port the scheme implies", () => {
    expect(tunnelCommand("https://vps.example.test")?.command).toContain("443:127.0.0.1:443");
    expect(tunnelCommand("http://vps.example.test")?.command).toContain("80:127.0.0.1:80");
  });

  /**
   * The address that means "this machine" cannot name the far machine. Guessing one would be
   * inventing an address, which is the single thing this whole surface refuses to do, so the
   * command comes back with the hole visible and the screen says to fill it in.
   */
  it("leaves the far end blank when the typed address is the loopback itself", () => {
    const composed = tunnelCommand("http://127.0.0.1:9090");

    expect(composed).toEqual({
      command:
        "ssh -N -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -L 127.0.0.1:9090:127.0.0.1:9090 user@VPS_ADDRESS",
      needsHost: true
    });
    expect(composed?.command).not.toContain("127.0.0.1 user@");
  });

  it("treats localhost and the IPv6 loopback the same way", () => {
    expect(tunnelCommand("http://localhost:9090")?.needsHost).toBe(true);
    expect(tunnelCommand("http://[::1]:9090")?.needsHost).toBe(true);
  });

  /**
   * Somebody pasting an address with a password in it is not a hypothesis: it is how half the
   * internal endpoints in the world are written down. It must not reach the command, which is
   * headed for a terminal, a scrollback and very often a screenshot.
   */
  it("never carries a credential somebody typed into the address", () => {
    const composed = tunnelCommand("http://admin:hunter2@vps.example.test:9090");

    expect(composed?.command).toBe(
      "ssh -N -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -L 127.0.0.1:9090:127.0.0.1:9090 user@vps.example.test"
    );
    expect(composed?.command).not.toContain("hunter2");
    expect(composed?.command).not.toContain("admin");
  });

  it("has nothing to say about something that is not an address", () => {
    expect(tunnelCommand("")).toBeNull();
    expect(tunnelCommand("   ")).toBeNull();
    expect(tunnelCommand("not an address")).toBeNull();
    expect(tunnelCommand("ftp://vps.example.test")).toBeNull();
  });

  /**
   * A port is a number in a fixed range, and a string that is not one has come from somewhere
   * that should not decide what a terminal runs.
   */
  it("refuses a port that is not one", () => {
    expect(tunnelCommand("http://vps.example.test:0")).toBeNull();
    expect(tunnelCommand("http://vps.example.test:99999")).toBeNull();
  });

  /**
   * The command is pasted into a shell. A hostname carrying a space, a quote or a semicolon is
   * either a typo or an attempt to append a second command, and neither belongs in something a
   * screen invites you to copy and run.
   */
  it("refuses a hostname that could turn into a second command", () => {
    expect(tunnelCommand("http://vps.example.test;rm -rf ~:9090")).toBeNull();
    expect(tunnelCommand("http://vps example test:9090")).toBeNull();
  });
});

/**
 * The line somebody pastes into `.env` so the connector is allowed out to that address at all.
 *
 * The allowlist is deployment-level and deliberately not editable from any screen: a tenant who
 * could add an entry could point a connector at the panel's own database. So the screen's job
 * ends at showing the exact line, and a person with access to the machine puts it there.
 */
describe("the allowlist line the guided check offers", () => {
  it("is the origin of what was typed, and only the origin", () => {
    expect(allowlistLine("http://vps.example.test:9090/metrics?range=5m")).toBe(
      "CONNECTOR_INTERNAL_ALLOWLIST=http://vps.example.test:9090"
    );
  });

  /**
   * `parseEgressAllowlist` refuses an entry carrying a path rather than ignoring it, so a line
   * this screen offers that kept one would be a line that stops the API from starting.
   */
  it("never offers a line the allowlist parser would refuse", () => {
    const line = allowlistLine("https://vps.example.test/prometheus/");

    expect(line).toBe("CONNECTOR_INTERNAL_ALLOWLIST=https://vps.example.test");
    expect(line).not.toContain("/prometheus");
  });

  it("never carries a credential somebody typed into the address", () => {
    expect(allowlistLine("http://admin:hunter2@vps.example.test:9090")).toBe(
      "CONNECTOR_INTERNAL_ALLOWLIST=http://vps.example.test:9090"
    );
  });

  it("has nothing to say about something that is not an address", () => {
    expect(allowlistLine("")).toBeNull();
    expect(allowlistLine("not an address")).toBeNull();
    expect(allowlistLine("ftp://vps.example.test")).toBeNull();
  });
});

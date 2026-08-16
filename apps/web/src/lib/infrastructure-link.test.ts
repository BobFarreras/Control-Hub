import { describe, expect, it } from "vitest";
import { automationLink, workflowIdOf } from "./infrastructure-link";

/**
 * Acceptance criterion 3: a malicious external URL produces no link.
 *
 * Every case here is a way somebody could get the product to draw an anchor pointing somewhere it
 * was never configured to point. The answer is always the same — null, and the screen renders the
 * name as text — because a link that only *usually* goes where it says is worse than no link.
 */

const base = "https://n8n.internal.example";

describe("the id inside an external identifier", () => {
  it("reads the workflow id and refuses anything that is not one", () => {
    expect(workflowIdOf("workflow:42")).toBe("42");
    expect(workflowIdOf("workflow:aBc-123_x")).toBe("aBc-123_x");
    expect(workflowIdOf("execution:42")).toBeNull();
    expect(workflowIdOf("42")).toBeNull();
    expect(workflowIdOf("workflow:")).toBeNull();
  });

  /**
   * n8n names its own workflows, so the id is provider data. It reaches a URL path, which is
   * exactly why the shape is checked rather than trusted.
   */
  it("refuses an id carrying anything that would change what the path means", () => {
    expect(workflowIdOf("workflow:../../admin")).toBeNull();
    expect(workflowIdOf("workflow:42/settings")).toBeNull();
    expect(workflowIdOf("workflow:42?redirect=https://evil.example")).toBeNull();
    expect(workflowIdOf("workflow:42#fragment")).toBeNull();
    expect(workflowIdOf("workflow:42%2f..")).toBeNull();
    expect(workflowIdOf(`workflow:${"9".repeat(201)}`)).toBeNull();
  });
});

describe("building the link to a workflow", () => {
  it("composes the configured base and the workflow path, and nothing else", () => {
    expect(automationLink(base, "workflow:42")).toBe("https://n8n.internal.example/workflow/42");
  });

  it("does not care how many slashes the configured base was saved with", () => {
    expect(automationLink("https://n8n.internal.example/", "workflow:42")).toBe(
      "https://n8n.internal.example/workflow/42"
    );
    expect(automationLink("https://n8n.internal.example///", "workflow:42")).toBe(
      "https://n8n.internal.example/workflow/42"
    );
  });

  it("keeps a base that lives under a path, which a reverse proxy makes ordinary", () => {
    expect(automationLink("https://ops.example/n8n", "workflow:42")).toBe("https://ops.example/n8n/workflow/42");
  });

  it("keeps the port, because a base on one port is a different origin from the same host on another", () => {
    expect(automationLink("http://127.0.0.1:5678", "workflow:42")).toBe("http://127.0.0.1:5678/workflow/42");
  });

  /** A scheme nobody declared. `javascript:` is the one that matters and it is not alone. */
  it("draws nothing for a scheme the connector never declared", () => {
    expect(automationLink("javascript:alert(1)", "workflow:42")).toBeNull();
    expect(automationLink("data:text/html,<script>alert(1)</script>", "workflow:42")).toBeNull();
    expect(automationLink("file:///etc/passwd", "workflow:42")).toBeNull();
    expect(automationLink("ftp://n8n.internal.example", "workflow:42")).toBeNull();
  });

  /**
   * Credentials in a base would be sent to the provider by the browser on every click, and would
   * sit in the address bar and in the browsing history of whoever clicked.
   */
  it("draws nothing for a base carrying embedded credentials", () => {
    expect(automationLink("https://user:pass@n8n.internal.example", "workflow:42")).toBeNull();
    expect(automationLink("https://user@n8n.internal.example", "workflow:42")).toBeNull();
  });

  it("draws nothing for a base that is not a URL at all", () => {
    expect(automationLink("", "workflow:42")).toBeNull();
    expect(automationLink("   ", "workflow:42")).toBeNull();
    expect(automationLink("n8n.internal.example", "workflow:42")).toBeNull();
    expect(automationLink(null, "workflow:42")).toBeNull();
    expect(automationLink(undefined, "workflow:42")).toBeNull();
  });

  /**
   * The result is checked against the base it was built from, not merely composed out of it. This
   * is the property the whole function exists for: whatever the two halves were, what comes out
   * points at the configured origin and at nothing else.
   */
  it("refuses anything whose origin ends up different from the configured one", () => {
    // The whole address, not a prefix of it. A prefix is satisfied by
    // `https://n8n.internal.example.evil.test`, which is the family of hosts this file exists to
    // refuse -- an assertion that a link merely starts with the base would pass on exactly the
    // input it should catch.
    expect(automationLink(base, "workflow:42")).toBe(`${base}/workflow/42`);
    expect(automationLink("https://n8n.internal.example", "workflow://evil.example")).toBeNull();
    expect(automationLink("https://n8n.internal.example", "workflow:\\evil.example")).toBeNull();
    expect(automationLink("https://n8n.internal.example", "workflow:%2F%2Fevil.example")).toBeNull();
  });

  it("draws nothing for an identifier that is not a workflow", () => {
    expect(automationLink(base, "execution:42")).toBeNull();
    expect(automationLink(base, "")).toBeNull();
  });
});

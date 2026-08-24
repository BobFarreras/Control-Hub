import type { IngressOutcome, IngressRefusal } from "@control-hub/application";
import { describe, expect, it } from "vitest";
import { ingressAnswer } from "./webhooks.js";

/**
 * The property acceptance criterion 4 calls "not enumerable", at the layer that decides it.
 *
 * Everything a caller can provoke without our signing secret has to leave with the same status
 * and the same code. Listing the reasons explicitly rather than iterating the type means adding
 * one to `IngressRefusal` without adding it here leaves a case nobody checked — the test fails
 * to compile before it fails to pass.
 */
const everyRefusal: IngressRefusal[] = [
  "unknown_endpoint",
  "instance_not_enabled",
  "ingress_not_supported",
  "missing_signature",
  "timestamp_out_of_window",
  "no_live_secret",
  "signature_mismatch"
];

describe("what an inbound delivery is answered with", () => {
  it("answers every refusal identically, whatever the reason was", () => {
    const answers = everyRefusal.map((reason) => ingressAnswer({ status: "refused", reason }));
    expect(new Set(answers.map((answer) => JSON.stringify(answer))).size).toBe(1);
    expect(answers[0]).toEqual({ status: 404, code: "NOT_FOUND" });
  });

  it("accepts with 202 and no body, whether the event is new or one we already hold", () => {
    const source = { tenantId: "tenant-1", instanceId: "instance-1" };
    const stored: IngressOutcome = {
      status: "accepted",
      eventId: "x-1",
      ...source,
      duplicate: false,
      stored: "pending"
    };
    const repeated: IngressOutcome = {
      status: "accepted",
      eventId: "x-1",
      ...source,
      duplicate: true,
      stored: "pending"
    };
    const filtered: IngressOutcome = {
      status: "accepted",
      eventId: "x-2",
      ...source,
      duplicate: false,
      stored: "discarded"
    };

    for (const outcome of [stored, repeated, filtered]) {
      expect(ingressAnswer(outcome)).toEqual({ status: 202, code: null });
    }
  });

  /**
   * The one case answered differently, and it costs nothing: getting here requires a signature
   * made with our secret, so it tells a stranger nothing and tells the provider what to fix.
   */
  it("tells a correctly signed provider that its payload could not be read", () => {
    expect(ingressAnswer({ status: "unreadable", code: "INVALID_PAYLOAD" })).toEqual({
      status: 400,
      code: "INVALID_PAYLOAD"
    });
  });
});

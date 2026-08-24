import { connectorIngressJobName } from "@control-hub/contracts/jobs";
import { describe, expect, it, vi } from "vitest";
import { createConnectorIngressQueue } from "./connector-ingress-queue.js";

describe("connector ingress queue", () => {
  it("uses the inbox id as a stable BullMQ identity", async () => {
    const queue = { add: vi.fn().mockResolvedValue({ id: "job" }) };
    await createConnectorIngressQueue(queue).enqueue({
      tenantId: "11111111-1111-4111-8111-111111111111",
      eventId: "22222222-2222-4222-8222-222222222222"
    });
    expect(queue.add).toHaveBeenCalledWith(
      connectorIngressJobName,
      expect.any(Object),
      expect.objectContaining({ jobId: "ingress-22222222-2222-4222-8222-222222222222", attempts: 5 })
    );
  });
});

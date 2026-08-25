import { connectorRegistry } from "@control-hub/connectors";
import type { TenantContext } from "@control-hub/domain";
import { describe, expect, it, vi } from "vitest";
import { ConnectorActionService, type ConnectorActionRepository } from "./connector-actions.js";
import type { ConnectorRepository } from "./connectors.js";

const instanceId = "33333333-3333-4333-8333-333333333333";
const ticketId = "44444444-4444-4444-8444-444444444444";
const context: TenantContext = {
  tenantId: "11111111-1111-4111-8111-111111111111",
  membershipId: "22222222-2222-4222-8222-222222222222",
  userId: "user",
  roles: ["owner"],
  permissions: ["tickets:manage", "tickets:read"],
  mfaEnabled: true
};

function service(overrides: Partial<TenantContext> = {}) {
  const confirmations: Parameters<ConnectorActionRepository["storeConfirmation"]>[1][] = [];
  const actionRepository: ConnectorActionRepository = {
    storeConfirmation: vi.fn((_context, input) => Promise.resolve(void confirmations.push(input))),
    queueMailReply: vi.fn((_context, input) =>
      Promise.resolve({
        id: "55555555-5555-4555-8555-555555555555",
        instanceId: input.instanceId,
        action: input.action,
        status: "queued" as const,
        externalId: null,
        errorCode: null,
        createdAt: new Date(0),
        finishedAt: null
      })
    ),
    get: vi.fn(() => Promise.resolve(null))
  };
  const instanceRepository = {
    getInstance: vi.fn(() =>
      Promise.resolve({
        id: instanceId,
        connectorType: "gmail",
        name: "Support",
        status: "enabled",
        config: {},
        configVersion: 1,
        healthStatus: "healthy",
        healthCheckedAt: null,
        lastErrorCode: null,
        createdAt: new Date(0),
        updatedAt: new Date(0)
      })
    )
  } as unknown as ConnectorRepository;
  return {
    context: { ...context, ...overrides },
    confirmations,
    actionRepository,
    subject: new ConnectorActionService(instanceRepository, actionRepository, connectorRegistry)
  };
}

describe("ConnectorActionService", () => {
  it("binds a one-use confirmation to the normalized mail content", async () => {
    const fixture = service();
    const issued = await fixture.subject.confirmation(
      fixture.context,
      instanceId,
      "send_mail",
      { ticketId, body: "  Resolved  " },
      new Date("2026-08-25T08:00:00Z")
    );
    expect(issued.confirmation).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(fixture.confirmations[0]).toMatchObject({ action: "send_mail", instanceId });
    expect(fixture.confirmations[0]?.nonceHash).not.toContain(issued.confirmation);
  });

  it("refuses an external action without MFA enrollment", async () => {
    const fixture = service({ mfaEnabled: false });
    await expect(
      fixture.subject.confirmation(fixture.context, instanceId, "send_mail", { ticketId, body: "Resolved" })
    ).rejects.toEqual(expect.objectContaining({ code: "ACTION_MFA_REQUIRED" }));
  });
});

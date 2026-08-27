import { createHash, randomBytes } from "node:crypto";
import type { ConnectorRegistry } from "@control-hub/connectors";
import { hasPermission, normalizeEmail, type TenantContext } from "@control-hub/domain";
import type { ConnectorRepository } from "./connectors.js";

export class ConnectorActionError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}

export type MailActionContent = { ticketId: string; body: string };
export type ActionRequestRecord = {
  id: string;
  instanceId: string;
  action: string;
  status: "queued" | "running" | "succeeded" | "failed" | "unknown" | "canceled";
  externalId: string | null;
  errorCode: string | null;
  createdAt: Date;
  finishedAt: Date | null;
};

export interface ConnectorActionRepository {
  storeConfirmation(
    context: TenantContext,
    input: {
      instanceId: string;
      action: string;
      nonceHash: string;
      inputDigest: string;
      expiresAt: Date;
    }
  ): Promise<void>;
  queueMailReply(
    context: TenantContext,
    input: {
      instanceId: string;
      action: string;
      nonceHash: string;
      inputDigest: string;
      idempotencyKey: string;
      ticketId: string;
      body: string;
      now: Date;
    }
  ): Promise<ActionRequestRecord>;
  get(context: TenantContext, instanceId: string, requestId: string): Promise<ActionRequestRecord | null>;
}

export class ConnectorActionService {
  constructor(
    private readonly instances: ConnectorRepository,
    private readonly actions: ConnectorActionRepository,
    private readonly registry: ConnectorRegistry
  ) {}

  async confirmation(
    context: TenantContext,
    instanceId: string,
    action: string,
    content: MailActionContent,
    now = new Date()
  ) {
    await this.assertAllowed(context, instanceId, action);
    validateContent(content);
    const nonce = randomBytes(32).toString("base64url");
    await this.actions.storeConfirmation(context, {
      instanceId,
      action,
      nonceHash: digest(nonce),
      inputDigest: inputDigest(context, instanceId, action, content),
      expiresAt: new Date(now.getTime() + 5 * 60_000)
    });
    return { confirmation: nonce, expiresAt: new Date(now.getTime() + 5 * 60_000) };
  }

  async executeMailReply(
    context: TenantContext,
    instanceId: string,
    action: string,
    content: MailActionContent,
    confirmation: string,
    idempotencyKey: string,
    now = new Date()
  ) {
    await this.assertAllowed(context, instanceId, action);
    validateContent(content);
    if (!/^[A-Za-z0-9_-]{43}$/.test(confirmation)) throw new ConnectorActionError("ACTION_CONFIRMATION_INVALID");
    if (!/^[A-Za-z0-9._:-]{16,128}$/.test(idempotencyKey)) throw new ConnectorActionError("IDEMPOTENCY_KEY_INVALID");
    return this.actions.queueMailReply(context, {
      instanceId,
      action,
      nonceHash: digest(confirmation),
      inputDigest: inputDigest(context, instanceId, action, content),
      idempotencyKey,
      ticketId: content.ticketId,
      body: content.body.trim(),
      now
    });
  }

  async get(context: TenantContext, instanceId: string, requestId: string) {
    if (!hasPermission(context, "tickets:read")) throw new ConnectorActionError("FORBIDDEN");
    const request = await this.actions.get(context, instanceId, requestId);
    if (!request) throw new ConnectorActionError("ACTION_NOT_FOUND");
    return request;
  }

  private async assertAllowed(context: TenantContext, instanceId: string, action: string) {
    const instance = await this.instances.getInstance(context, instanceId);
    if (!instance || instance.status !== "enabled") throw new ConnectorActionError("INSTANCE_NOT_FOUND");
    const declaration = this.registry.find(instance.connectorType)?.capabilities.actions?.[action];
    if (!declaration) throw new ConnectorActionError("ACTION_NOT_DECLARED");
    if (!hasPermission(context, declaration.permission)) throw new ConnectorActionError("FORBIDDEN");
    if (declaration.requiresMfa && !context.mfaEnabled) throw new ConnectorActionError("ACTION_MFA_REQUIRED");
  }
}

function validateContent(content: MailActionContent) {
  if (!/^[0-9a-f-]{36}$/i.test(content.ticketId)) throw new ConnectorActionError("INVALID_INPUT");
  if (content.body.trim().length < 1 || content.body.length > 20_000) throw new ConnectorActionError("INVALID_INPUT");
}

function inputDigest(context: TenantContext, instanceId: string, action: string, content: MailActionContent) {
  return digest(
    JSON.stringify({
      tenantId: context.tenantId,
      membershipId: context.membershipId,
      instanceId,
      action,
      ticketId: content.ticketId,
      body: content.body.trim()
    })
  );
}

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

// Kept here as the one normalization boundary action adapters and repositories share.
export const normalizeMailRecipient = normalizeEmail;

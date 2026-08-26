import { randomUUID } from "node:crypto";
import {
  canTransitionCredentialCatalogEntry,
  credentialCatalogCategories,
  credentialCatalogEnvironments,
  credentialCatalogStatuses,
  hasPermission,
  passwordManagerDeploymentModes,
  passwordManagerStatuses,
  type CredentialCatalogCategory,
  type CredentialCatalogEnvironment,
  type CredentialCatalogStatus,
  type PasswordManagerDeploymentMode,
  type PasswordManagerStatus,
  type TenantContext
} from "@control-hub/domain";

export type CredentialCatalogReferenceEnvelope = {
  keyId: string;
  nonce: Uint8Array;
  ciphertext: Uint8Array;
};

export interface CredentialCatalogReferenceSealer {
  seal(plaintext: string, context: { tenantId: string; entryId: string }): CredentialCatalogReferenceEnvelope;
}

export interface CredentialCatalogReferenceReader {
  open(envelope: CredentialCatalogReferenceEnvelope, context: { tenantId: string; entryId: string }): string;
}

export type PasswordManagerInstallationRecord = {
  id: string;
  displayName: string;
  provider: "bitwarden";
  baseUrl: string;
  deploymentMode: PasswordManagerDeploymentMode;
  status: PasswordManagerStatus;
  lastReviewedAt: Date | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
};

export type CredentialCatalogEntryRecord = {
  id: string;
  installationId: string;
  clientId: string | null;
  companySubscriptionId: string | null;
  applicationName: string;
  category: CredentialCatalogCategory;
  environment: CredentialCatalogEnvironment;
  accountLabel: string | null;
  ownerMembershipId: string;
  status: CredentialCatalogStatus;
  reviewDueAt: Date | null;
  lastReviewedAt: Date | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
};

export type CredentialCatalogVisibility = { mode: "all" } | { mode: "assigned"; membershipId: string };

export type CreateCredentialCatalogEntryPersistence = {
  id: string;
  installationId: string;
  clientId: string | null;
  companySubscriptionId: string | null;
  applicationName: string;
  category: CredentialCatalogCategory;
  environment: CredentialCatalogEnvironment;
  accountLabel: string | null;
  ownerMembershipId: string;
  reviewDueAt: Date | null;
  createdByMembershipId: string;
  reference: CredentialCatalogReferenceEnvelope;
};

export interface CredentialCatalogRepository {
  createInstallation(
    context: TenantContext,
    input: {
      id: string;
      displayName: string;
      baseUrl: string;
      deploymentMode: PasswordManagerDeploymentMode;
      status: PasswordManagerStatus;
      createdByMembershipId: string;
    }
  ): Promise<PasswordManagerInstallationRecord>;
  listInstallations(context: TenantContext): Promise<PasswordManagerInstallationRecord[]>;
  getInstallation(context: TenantContext, installationId: string): Promise<PasswordManagerInstallationRecord | null>;
  updateInstallation(
    context: TenantContext,
    input: {
      installationId: string;
      displayName: string;
      baseUrl: string;
      deploymentMode: PasswordManagerDeploymentMode;
      status: PasswordManagerStatus;
      expectedVersion: number;
    }
  ): Promise<PasswordManagerInstallationRecord | null>;
  createEntry(
    context: TenantContext,
    input: CreateCredentialCatalogEntryPersistence
  ): Promise<CredentialCatalogEntryRecord>;
  listEntries(context: TenantContext, visibility: CredentialCatalogVisibility): Promise<CredentialCatalogEntryRecord[]>;
  getEntry(
    context: TenantContext,
    entryId: string,
    visibility: CredentialCatalogVisibility
  ): Promise<CredentialCatalogEntryRecord | null>;
  transitionEntry(
    context: TenantContext,
    input: {
      entryId: string;
      from: CredentialCatalogStatus;
      to: CredentialCatalogStatus;
      expectedVersion: number;
      actorMembershipId: string;
    }
  ): Promise<CredentialCatalogEntryRecord | null>;
  readReference(context: TenantContext, entryId: string): Promise<CredentialCatalogReferenceEnvelope | null>;
  recordOpen(context: TenantContext, entryId: string, actorMembershipId: string): Promise<void>;
  reviewEntry(
    context: TenantContext,
    input: { entryId: string; expectedVersion: number; actorMembershipId: string; reviewedAt: Date }
  ): Promise<CredentialCatalogEntryRecord | null>;
}

export class CredentialCatalogError extends Error {
  constructor(
    public readonly code:
      | "INVALID_INPUT"
      | "FORBIDDEN"
      | "MFA_REQUIRED"
      | "CREDENTIAL_ENTRY_NOT_FOUND"
      | "PASSWORD_MANAGER_INSTALLATION_NOT_FOUND"
      | "CREDENTIAL_ENTRY_INVALID_TRANSITION"
      | "CREDENTIAL_ENTRY_CONFLICT"
  ) {
    super(code);
  }
}

function requireMfa(context: TenantContext): void {
  if (!context.mfaEnabled) throw new CredentialCatalogError("MFA_REQUIRED");
}

function requireOwnerConfiguration(context: TenantContext): void {
  requireMfa(context);
  if (!context.roles.includes("owner") || !hasPermission(context, "vault:manage"))
    throw new CredentialCatalogError("FORBIDDEN");
}

function requireManage(context: TenantContext): void {
  requireMfa(context);
  if (!hasPermission(context, "credentials:manage")) throw new CredentialCatalogError("FORBIDDEN");
}

function visibilityFor(context: TenantContext): CredentialCatalogVisibility {
  if (!hasPermission(context, "credentials:read")) throw new CredentialCatalogError("FORBIDDEN");
  return hasPermission(context, "credentials:manage") || context.roles.includes("owner")
    ? { mode: "all" }
    : { mode: "assigned", membershipId: context.membershipId };
}

function normalizeBaseUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new CredentialCatalogError("INVALID_INPUT");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    parsed.pathname !== "/" ||
    parsed.hostname.length === 0
  )
    throw new CredentialCatalogError("INVALID_INPUT");
  return parsed.origin;
}

function normalizedLabel(value: string | null | undefined, max: number): string | null {
  const normalized = value?.trim() || null;
  if (normalized !== null && normalized.length > max) throw new CredentialCatalogError("INVALID_INPUT");
  return normalized;
}

/** Validate an official item link and retain only the origin-independent part. */
export function normalizeBitwardenItemReference(value: string, baseUrl: string): string {
  let link: URL;
  try {
    link = new URL(value.trim());
  } catch {
    throw new CredentialCatalogError("INVALID_INPUT");
  }
  if (link.protocol !== "https:" || link.origin !== baseUrl || link.username || link.password)
    throw new CredentialCatalogError("INVALID_INPUT");
  const search = new URLSearchParams(link.search);
  const hashQuery = link.hash.includes("?") ? new URLSearchParams(link.hash.slice(link.hash.indexOf("?") + 1)) : null;
  const itemIds = [...search.getAll("itemId"), ...(hashQuery?.getAll("itemId") ?? [])];
  if (
    itemIds.length !== 1 ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(itemIds[0]!)
  )
    throw new CredentialCatalogError("INVALID_INPUT");
  const allowedSearch = [...search.keys()].every((key) => key === "itemId");
  const allowedHash = !hashQuery || [...hashQuery.keys()].every((key) => key === "itemId");
  const recognizedShape = link.hash
    ? link.search === "" && link.hash.startsWith("#/vault?")
    : link.hash === "" && search.has("itemId");
  if (!allowedSearch || !allowedHash || !recognizedShape || link.pathname.includes(".."))
    throw new CredentialCatalogError("INVALID_INPUT");
  return `${link.pathname}${link.search}${link.hash}`;
}

export function reconstructBitwardenDestination(relative: string, baseUrl: string): string {
  const destination = new URL(relative, `${baseUrl}/`);
  if (destination.protocol !== "https:" || destination.origin !== baseUrl)
    throw new CredentialCatalogError("INVALID_INPUT");
  return destination.toString();
}

export class CredentialCatalogService {
  constructor(
    private readonly repository: CredentialCatalogRepository,
    private readonly sealer: CredentialCatalogReferenceSealer,
    private readonly reader?: CredentialCatalogReferenceReader
  ) {}

  createInstallation(
    context: TenantContext,
    input: {
      displayName: string;
      baseUrl: string;
      deploymentMode: PasswordManagerDeploymentMode;
      status?: PasswordManagerStatus;
    }
  ): Promise<PasswordManagerInstallationRecord> {
    requireOwnerConfiguration(context);
    const displayName = input.displayName.trim();
    const status = input.status ?? "active";
    if (
      displayName.length < 2 ||
      displayName.length > 120 ||
      !passwordManagerDeploymentModes.includes(input.deploymentMode) ||
      !passwordManagerStatuses.includes(status)
    )
      throw new CredentialCatalogError("INVALID_INPUT");
    return this.repository.createInstallation(context, {
      id: randomUUID(),
      displayName,
      baseUrl: normalizeBaseUrl(input.baseUrl),
      deploymentMode: input.deploymentMode,
      status,
      createdByMembershipId: context.membershipId
    });
  }

  listInstallations(context: TenantContext): Promise<PasswordManagerInstallationRecord[]> {
    if (!hasPermission(context, "credentials:read")) throw new CredentialCatalogError("FORBIDDEN");
    return this.repository.listInstallations(context);
  }

  async updateInstallation(
    context: TenantContext,
    input: {
      installationId: string;
      displayName: string;
      baseUrl: string;
      deploymentMode: PasswordManagerDeploymentMode;
      status: PasswordManagerStatus;
      expectedVersion: number;
    }
  ): Promise<PasswordManagerInstallationRecord> {
    requireOwnerConfiguration(context);
    const displayName = input.displayName.trim();
    if (
      displayName.length < 2 ||
      displayName.length > 120 ||
      !passwordManagerDeploymentModes.includes(input.deploymentMode) ||
      !passwordManagerStatuses.includes(input.status) ||
      !Number.isInteger(input.expectedVersion)
    )
      throw new CredentialCatalogError("INVALID_INPUT");
    const updated = await this.repository.updateInstallation(context, {
      ...input,
      displayName,
      baseUrl: normalizeBaseUrl(input.baseUrl)
    });
    if (!updated) throw new CredentialCatalogError("CREDENTIAL_ENTRY_CONFLICT");
    return updated;
  }

  async createEntry(
    context: TenantContext,
    input: {
      installationId: string;
      clientId?: string | null;
      companySubscriptionId?: string | null;
      applicationName: string;
      category: CredentialCatalogCategory;
      environment: CredentialCatalogEnvironment;
      accountLabel?: string | null;
      ownerMembershipId: string;
      reviewDueAt?: Date | null;
      opaqueReference: string;
    }
  ): Promise<CredentialCatalogEntryRecord> {
    requireManage(context);
    const id = randomUUID();
    const applicationName = input.applicationName.trim();
    const reference = input.opaqueReference.trim();
    if (
      !input.installationId ||
      applicationName.length < 2 ||
      applicationName.length > 160 ||
      !credentialCatalogCategories.includes(input.category) ||
      !credentialCatalogEnvironments.includes(input.environment) ||
      !input.ownerMembershipId ||
      reference.length < 1 ||
      Buffer.byteLength(reference, "utf8") > 4096 ||
      (input.reviewDueAt !== undefined && input.reviewDueAt !== null && Number.isNaN(input.reviewDueAt.getTime()))
    )
      throw new CredentialCatalogError("INVALID_INPUT");

    const installation = await this.repository.getInstallation(context, input.installationId);
    if (!installation) throw new CredentialCatalogError("PASSWORD_MANAGER_INSTALLATION_NOT_FOUND");
    const normalizedReference = normalizeBitwardenItemReference(reference, installation.baseUrl);
    const envelope = this.sealer.seal(normalizedReference, { tenantId: context.tenantId, entryId: id });
    return this.repository.createEntry(context, {
      id,
      installationId: input.installationId,
      clientId: input.clientId ?? null,
      companySubscriptionId: input.companySubscriptionId ?? null,
      applicationName,
      category: input.category,
      environment: input.environment,
      accountLabel: normalizedLabel(input.accountLabel, 320),
      ownerMembershipId: input.ownerMembershipId,
      reviewDueAt: input.reviewDueAt ?? null,
      createdByMembershipId: context.membershipId,
      reference: envelope
    });
  }

  async openEntry(context: TenantContext, entryId: string): Promise<{ destination: string; expiresAt: string }> {
    requireMfa(context);
    if (!hasPermission(context, "credentials:open")) throw new CredentialCatalogError("FORBIDDEN");
    if (!this.reader) throw new CredentialCatalogError("INVALID_INPUT");
    const entry = await this.getEntry(context, entryId);
    const [installation, envelope] = await Promise.all([
      this.repository.getInstallation(context, entry.installationId),
      this.repository.readReference(context, entryId)
    ]);
    if (!installation || !envelope || installation.status !== "active")
      throw new CredentialCatalogError("CREDENTIAL_ENTRY_NOT_FOUND");
    const relative = this.reader.open(envelope, { tenantId: context.tenantId, entryId });
    const destination = reconstructBitwardenDestination(relative, installation.baseUrl);
    await this.repository.recordOpen(context, entryId, context.membershipId);
    return { destination, expiresAt: new Date(Date.now() + 60_000).toISOString() };
  }

  listEntries(context: TenantContext): Promise<CredentialCatalogEntryRecord[]> {
    return this.repository.listEntries(context, visibilityFor(context));
  }

  getEntry(context: TenantContext, entryId: string): Promise<CredentialCatalogEntryRecord> {
    return this.repository.getEntry(context, entryId, visibilityFor(context)).then((entry) => {
      if (!entry) throw new CredentialCatalogError("CREDENTIAL_ENTRY_NOT_FOUND");
      return entry;
    });
  }

  async transitionEntry(
    context: TenantContext,
    input: { entryId: string; status: CredentialCatalogStatus; expectedVersion: number }
  ): Promise<CredentialCatalogEntryRecord> {
    requireManage(context);
    if (!credentialCatalogStatuses.includes(input.status) || !Number.isInteger(input.expectedVersion))
      throw new CredentialCatalogError("INVALID_INPUT");
    const current = await this.repository.getEntry(context, input.entryId, { mode: "all" });
    if (!current) throw new CredentialCatalogError("CREDENTIAL_ENTRY_NOT_FOUND");
    if (!canTransitionCredentialCatalogEntry(current.status, input.status))
      throw new CredentialCatalogError("CREDENTIAL_ENTRY_INVALID_TRANSITION");
    const updated = await this.repository.transitionEntry(context, {
      entryId: input.entryId,
      from: current.status,
      to: input.status,
      expectedVersion: input.expectedVersion,
      actorMembershipId: context.membershipId
    });
    if (!updated) throw new CredentialCatalogError("CREDENTIAL_ENTRY_CONFLICT");
    return updated;
  }

  async reviewEntry(
    context: TenantContext,
    entryId: string,
    expectedVersion: number
  ): Promise<CredentialCatalogEntryRecord> {
    requireManage(context);
    if (!Number.isInteger(expectedVersion)) throw new CredentialCatalogError("INVALID_INPUT");
    const reviewed = await this.repository.reviewEntry(context, {
      entryId,
      expectedVersion,
      actorMembershipId: context.membershipId,
      reviewedAt: new Date()
    });
    if (!reviewed) throw new CredentialCatalogError("CREDENTIAL_ENTRY_CONFLICT");
    return reviewed;
  }
}

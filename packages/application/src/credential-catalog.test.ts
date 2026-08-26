import type { TenantContext } from "@control-hub/domain";
import { describe, expect, it } from "vitest";
import {
  CredentialCatalogError,
  CredentialCatalogService,
  normalizeBitwardenItemReference,
  reconstructBitwardenDestination,
  type CreateCredentialCatalogEntryPersistence,
  type CredentialCatalogReferenceEnvelope,
  type CredentialCatalogReferenceSealer,
  type CredentialCatalogEntryRecord,
  type CredentialCatalogRepository,
  type CredentialCatalogVisibility,
  type PasswordManagerInstallationRecord
} from "./credential-catalog.js";

const now = new Date("2026-08-26T08:00:00.000Z");

function context(
  permissions: TenantContext["permissions"],
  roles: TenantContext["roles"] = ["administrator"],
  overrides: Partial<TenantContext> = {}
): TenantContext {
  return {
    tenantId: "tenant-a",
    membershipId: "member-a",
    userId: "user-a",
    roles,
    permissions,
    mfaEnabled: true,
    ...overrides
  };
}

class FakeSealer implements CredentialCatalogReferenceSealer {
  calls: Array<{ plaintext: string; context: { tenantId: string; entryId: string } }> = [];
  seal(plaintext: string, context: { tenantId: string; entryId: string }): CredentialCatalogReferenceEnvelope {
    this.calls.push({ plaintext, context });
    return { keyId: "workspace", nonce: Buffer.alloc(12, 1), ciphertext: Buffer.from(`sealed:${plaintext}`) };
  }
}

class FakeRepository implements CredentialCatalogRepository {
  installations: PasswordManagerInstallationRecord[] = [];
  entries: CredentialCatalogEntryRecord[] = [];
  persisted: CreateCredentialCatalogEntryPersistence[] = [];
  lastVisibility: CredentialCatalogVisibility | null = null;

  createInstallation(
    _context: TenantContext,
    input: {
      id: string;
      displayName: string;
      baseUrl: string;
      deploymentMode: PasswordManagerInstallationRecord["deploymentMode"];
      status: PasswordManagerInstallationRecord["status"];
    }
  ): Promise<PasswordManagerInstallationRecord> {
    const record = {
      ...input,
      provider: "bitwarden" as const,
      lastReviewedAt: null,
      version: 1,
      createdAt: now,
      updatedAt: now
    };
    this.installations.push(record);
    return Promise.resolve(record);
  }
  listInstallations(): Promise<PasswordManagerInstallationRecord[]> {
    return Promise.resolve(this.installations);
  }
  getInstallation(_context: TenantContext, installationId: string): Promise<PasswordManagerInstallationRecord | null> {
    return Promise.resolve(this.installations.find((installation) => installation.id === installationId) ?? null);
  }
  updateInstallation(): Promise<PasswordManagerInstallationRecord | null> {
    return Promise.resolve(null);
  }
  reference: CredentialCatalogReferenceEnvelope | null = null;
  opens = 0;
  readReference(): Promise<CredentialCatalogReferenceEnvelope | null> {
    return Promise.resolve(this.reference);
  }
  recordOpen(): Promise<void> {
    this.opens += 1;
    return Promise.resolve();
  }
  reviewEntry(): Promise<CredentialCatalogEntryRecord | null> {
    return Promise.resolve(null);
  }
  createEntry(
    _context: TenantContext,
    input: CreateCredentialCatalogEntryPersistence
  ): Promise<CredentialCatalogEntryRecord> {
    this.persisted.push(input);
    const record: CredentialCatalogEntryRecord = {
      id: input.id,
      installationId: input.installationId,
      clientId: input.clientId,
      companySubscriptionId: input.companySubscriptionId,
      applicationName: input.applicationName,
      category: input.category,
      environment: input.environment,
      accountLabel: input.accountLabel,
      ownerMembershipId: input.ownerMembershipId,
      status: "active",
      reviewDueAt: input.reviewDueAt,
      lastReviewedAt: null,
      version: 1,
      createdAt: now,
      updatedAt: now
    };
    this.entries.push(record);
    return Promise.resolve(record);
  }
  listEntries(
    _context: TenantContext,
    visibility: CredentialCatalogVisibility
  ): Promise<CredentialCatalogEntryRecord[]> {
    this.lastVisibility = visibility;
    return Promise.resolve(
      visibility.mode === "all"
        ? this.entries
        : this.entries.filter((entry) => entry.ownerMembershipId === visibility.membershipId)
    );
  }
  getEntry(
    _context: TenantContext,
    entryId: string,
    visibility: CredentialCatalogVisibility
  ): Promise<CredentialCatalogEntryRecord | null> {
    this.lastVisibility = visibility;
    return Promise.resolve(
      this.entries.find(
        (entry) =>
          entry.id === entryId && (visibility.mode === "all" || entry.ownerMembershipId === visibility.membershipId)
      ) ?? null
    );
  }
  transitionEntry(
    _context: TenantContext,
    input: {
      entryId: string;
      from: CredentialCatalogEntryRecord["status"];
      to: CredentialCatalogEntryRecord["status"];
      expectedVersion: number;
    }
  ): Promise<CredentialCatalogEntryRecord | null> {
    const index = this.entries.findIndex(
      (entry) => entry.id === input.entryId && entry.status === input.from && entry.version === input.expectedVersion
    );
    if (index < 0) return Promise.resolve(null);
    const current = this.entries[index]!;
    const updated = { ...current, status: input.to, version: current.version + 1, updatedAt: now };
    this.entries[index] = updated;
    return Promise.resolve(updated);
  }
}

describe("credential catalog service", () => {
  it("keeps installation configuration owner-only and normalizes its origin", async () => {
    const repository = new FakeRepository();
    const service = new CredentialCatalogService(repository, new FakeSealer());
    expect(() =>
      service.createInstallation(context(["vault:manage"], ["administrator"]), {
        displayName: "Main vault",
        baseUrl: "https://vault.example.test",
        deploymentMode: "self_hosted_shared_vps"
      })
    ).toThrow(expect.objectContaining({ code: "FORBIDDEN" }));

    const created = await service.createInstallation(context(["vault:manage"], ["owner"]), {
      displayName: " Main vault ",
      baseUrl: "https://vault.example.test/",
      deploymentMode: "self_hosted_shared_vps"
    });
    expect(created.baseUrl).toBe("https://vault.example.test");
  });

  it("seals the opaque reference against tenant, entry and purpose without returning it", async () => {
    const repository = new FakeRepository();
    const sealer = new FakeSealer();
    const service = new CredentialCatalogService(repository, sealer);
    repository.installations.push({
      id: "installation-a",
      displayName: "Vault",
      provider: "bitwarden",
      baseUrl: "https://vault.example.test",
      deploymentMode: "cloud",
      status: "active",
      lastReviewedAt: null,
      version: 1,
      createdAt: now,
      updatedAt: now
    });
    const created = await service.createEntry(context(["credentials:manage", "credentials:read"]), {
      installationId: "installation-a",
      applicationName: "Hostinger",
      category: "hosting",
      environment: "production",
      ownerMembershipId: "member-a",
      opaqueReference: "https://vault.example.test/#/vault?itemId=11111111-1111-4111-8111-111111111111"
    });
    expect(sealer.calls[0]).toMatchObject({
      plaintext: "/#/vault?itemId=11111111-1111-4111-8111-111111111111",
      context: { tenantId: "tenant-a", entryId: created.id }
    });
    expect(JSON.stringify(created)).not.toContain("opaque");
    expect(repository.persisted[0]?.reference.ciphertext).toBeDefined();
  });

  it("limits technical readers to their assigned entries", async () => {
    const repository = new FakeRepository();
    const service = new CredentialCatalogService(repository, new FakeSealer());
    repository.entries.push(
      {
        id: "entry-a",
        installationId: "installation-a",
        clientId: null,
        companySubscriptionId: null,
        applicationName: "A",
        category: "other",
        environment: "production",
        accountLabel: null,
        ownerMembershipId: "member-a",
        status: "active",
        reviewDueAt: null,
        lastReviewedAt: null,
        version: 1,
        createdAt: now,
        updatedAt: now
      },
      {
        id: "entry-b",
        installationId: "installation-a",
        clientId: null,
        companySubscriptionId: null,
        applicationName: "B",
        category: "other",
        environment: "production",
        accountLabel: null,
        ownerMembershipId: "member-b",
        status: "active",
        reviewDueAt: null,
        lastReviewedAt: null,
        version: 1,
        createdAt: now,
        updatedAt: now
      }
    );
    const visible = await service.listEntries(context(["credentials:read"], ["technical"]));
    expect(visible.map((entry) => entry.id)).toEqual(["entry-a"]);
    expect(repository.lastVisibility).toEqual({ mode: "assigned", membershipId: "member-a" });
  });

  it("requires MFA for writes and rejects lost updates", async () => {
    const repository = new FakeRepository();
    const service = new CredentialCatalogService(repository, new FakeSealer());
    await expect(
      service.createEntry(context(["credentials:manage"], ["administrator"], { mfaEnabled: false }), {
        installationId: "installation-a",
        applicationName: "Hostinger",
        category: "hosting",
        environment: "production",
        ownerMembershipId: "member-a",
        opaqueReference: "reference"
      })
    ).rejects.toMatchObject({ code: "MFA_REQUIRED" });

    repository.entries.push({
      id: "entry-a",
      installationId: "installation-a",
      clientId: null,
      companySubscriptionId: null,
      applicationName: "Hostinger",
      category: "hosting",
      environment: "production",
      accountLabel: null,
      ownerMembershipId: "member-a",
      status: "active",
      reviewDueAt: null,
      lastReviewedAt: null,
      version: 2,
      createdAt: now,
      updatedAt: now
    });
    await expect(
      service.transitionEntry(context(["credentials:manage"], ["administrator"]), {
        entryId: "entry-a",
        status: "review_due",
        expectedVersion: 1
      })
    ).rejects.toMatchObject({ code: "CREDENTIAL_ENTRY_CONFLICT" });
  });

  it("does not accept insecure or ambiguous installation URLs", () => {
    const service = new CredentialCatalogService(new FakeRepository(), new FakeSealer());
    const owner = context(["vault:manage"], ["owner"]);
    for (const baseUrl of [
      "http://vault.test",
      "https://user@vault.test",
      "https://vault.test/path",
      "https://vault.test?q=1"
    ])
      expect(() =>
        service.createInstallation(owner, { displayName: "Vault", baseUrl, deploymentMode: "cloud" })
      ).toThrow(CredentialCatalogError);
  });

  it("accepts only one official item identifier under the registered HTTPS origin", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    expect(normalizeBitwardenItemReference(`https://vault.test/#/vault?itemId=${id}`, "https://vault.test")).toBe(
      `/#/vault?itemId=${id}`
    );
    for (const link of [
      `https://vault.test.evil.example/#/vault?itemId=${id}`,
      `https://vault.test/#/vault?itemId=${id}&next=https://evil.test`,
      "https://vault.test/#/vault?itemId=not-a-uuid"
    ])
      expect(() => normalizeBitwardenItemReference(link, "https://vault.test")).toThrow(CredentialCatalogError);
    expect(() => reconstructBitwardenDestination("//evil.test/x", "https://vault.test")).toThrow(
      CredentialCatalogError
    );
  });

  it("opens only visible entries and reconstructs the destination from the registered origin", async () => {
    const repository = new FakeRepository();
    const id = "11111111-1111-4111-8111-111111111111";
    repository.installations.push({
      id: "installation-a",
      displayName: "Vault",
      provider: "bitwarden",
      baseUrl: "https://vault.test",
      deploymentMode: "cloud",
      status: "active",
      lastReviewedAt: null,
      version: 1,
      createdAt: now,
      updatedAt: now
    });
    repository.entries.push({
      id: "entry-a",
      installationId: "installation-a",
      clientId: null,
      companySubscriptionId: null,
      applicationName: "Hosting",
      category: "hosting",
      environment: "production",
      accountLabel: null,
      ownerMembershipId: "member-a",
      status: "active",
      reviewDueAt: null,
      lastReviewedAt: null,
      version: 1,
      createdAt: now,
      updatedAt: now
    });
    repository.reference = { keyId: "workspace", nonce: Buffer.alloc(12), ciphertext: Buffer.alloc(20) };
    const reader = { open: () => `/#/vault?itemId=${id}` };
    const service = new CredentialCatalogService(repository, new FakeSealer(), reader);
    const result = await service.openEntry(context(["credentials:read", "credentials:open"], ["technical"]), "entry-a");
    expect(result.destination).toBe(`https://vault.test/#/vault?itemId=${id}`);
    expect(repository.opens).toBe(1);
  });
});

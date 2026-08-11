import type { Permission, TenantContext } from "@control-hub/domain";
import { beforeEach, describe, expect, it } from "vitest";
import { ConnectorCredentialError, ConnectorCredentialService, ConnectorSecretReader } from "./connector-credentials.js";
import type {
  ConnectorRepository,
  CredentialAad,
  CredentialEnvelope,
  CredentialMetadata,
  CredentialSlot,
  PutCredentialInput,
  SealedCredential
} from "./connectors.js";

const tenantId = "11111111-1111-4111-8111-111111111111";
const otherTenantId = "22222222-2222-4222-8222-222222222222";
const instanceId = "33333333-3333-4333-8333-333333333333";

function context(permissions: Permission[], overrides: Partial<TenantContext> = {}): TenantContext {
  return {
    tenantId,
    membershipId: "m-1",
    userId: "u-1",
    roles: ["administrator"],
    permissions,
    mfaEnabled: true,
    ...overrides
  };
}

const rotator = context(["credentials:rotate", "integrations:read"]);

/**
 * A sealer that is reversible and observable, so a test can say what was sealed and under what.
 *
 * It is not encryption and does not pretend to be: the real one is `CredentialVault`, tested
 * against `node:crypto` in `packages/persistence`. What these tests own is which secret reaches
 * the sealer, which slot it lands in, and who is allowed to ask.
 */
class FakeSealer {
  readonly sealed: { plaintext: string; aad: CredentialAad }[] = [];

  seal(plaintext: string, aad: CredentialAad): CredentialEnvelope {
    this.sealed.push({ plaintext, aad });
    return {
      keyId: "test-key",
      nonce: Buffer.alloc(12, 7),
      ciphertext: Buffer.from(`${aad.tenantId}|${aad.instanceId}|${plaintext}`, "utf8")
    };
  }

  open(envelope: CredentialEnvelope, aad: CredentialAad): string {
    const [sealedTenant, sealedInstance, ...rest] = Buffer.from(envelope.ciphertext).toString("utf8").split("|");
    if (sealedTenant !== aad.tenantId || sealedInstance !== aad.instanceId) throw new Error("ENVELOPE_NOT_AUTHENTIC");
    return rest.join("|");
  }
}

type Row = SealedCredential & { instanceId: string; revoked: boolean; usedAt: Date | null };

/** Only the credential half of the port. Everything else throws if a test reaches for it. */
class FakeRepository {
  readonly rows: Row[] = [];
  private next = 0;

  putCredential(_context: TenantContext, input: PutCredentialInput): Promise<CredentialMetadata> {
    this.next += 1;
    const row: Row = {
      id: `c-${this.next}`,
      instanceId: input.instanceId,
      kind: input.kind,
      slot: input.slot,
      keyId: input.keyId,
      nonce: input.nonce,
      ciphertext: input.ciphertext,
      revoked: false,
      usedAt: null
    };
    this.rows.push(row);
    return Promise.resolve(metadata(row));
  }

  readSealedCredentials(_context: TenantContext, instance: string, kind: string): Promise<SealedCredential[]> {
    return Promise.resolve(
      this.live(instance, kind)
        .slice()
        .sort((a, b) => order(a.slot) - order(b.slot))
    );
  }

  listCredentials(_context: TenantContext, instance: string): Promise<CredentialMetadata[]> {
    return Promise.resolve(this.rows.filter((row) => row.instanceId === instance).map(metadata));
  }

  markCredentialUsed(_context: TenantContext, credentialId: string): Promise<void> {
    const row = this.rows.find((candidate) => candidate.id === credentialId);
    if (row && !row.revoked) row.usedAt = new Date();
    return Promise.resolve();
  }

  revokeCredentials(_context: TenantContext, instance: string, kind?: string): Promise<number> {
    const targets = this.rows.filter(
      (row) => row.instanceId === instance && !row.revoked && (kind === undefined || row.kind === kind)
    );
    for (const row of targets) row.revoked = true;
    return Promise.resolve(targets.length);
  }

  promoteCredential(_context: TenantContext, instance: string, kind: string): Promise<CredentialMetadata | null> {
    const secondary = this.live(instance, kind).find((row) => row.slot === "secondary");
    if (!secondary) return Promise.resolve(null);
    const primary = this.live(instance, kind).find((row) => row.slot === "primary");
    if (primary) primary.revoked = true;
    secondary.slot = "primary";
    return Promise.resolve(metadata(secondary));
  }

  private live(instance: string, kind: string) {
    return this.rows.filter((row) => row.instanceId === instance && row.kind === kind && !row.revoked);
  }
}

const order = (slot: CredentialSlot) => (slot === "secondary" ? 0 : 1);

function metadata(row: Row): CredentialMetadata {
  return {
    id: row.id,
    kind: row.kind,
    slot: row.slot,
    keyId: row.keyId,
    rotatedAt: new Date(0),
    expiresAt: null,
    lastUsedAt: row.usedAt,
    revokedAt: row.revoked ? new Date(0) : null,
    createdAt: new Date(0)
  };
}

let repository: FakeRepository;
let sealer: FakeSealer;
let service: ConnectorCredentialService;
let reader: ConnectorSecretReader;

const asPort = () => repository as unknown as ConnectorRepository;

beforeEach(() => {
  repository = new FakeRepository();
  sealer = new FakeSealer();
  service = new ConnectorCredentialService(asPort(), sealer);
  reader = new ConnectorSecretReader(asPort(), sealer);
});

describe("writing a credential", () => {
  it("seals it and never stores the plain value", async () => {
    const written = await service.write(rotator, { instanceId, kind: "api_key", secret: "sk_live_9f2c8ab4" });
    expect(written.slot).toBe("primary");
    expect(sealer.sealed).toEqual([
      { plaintext: "sk_live_9f2c8ab4", aad: { tenantId, instanceId } }
    ]);
    expect(JSON.stringify(repository.rows)).not.toContain("sk_live_9f2c8ab4");
  });

  it("binds the envelope to the tenant of the caller, not to one the caller names", async () => {
    await service.write(context(["credentials:rotate"], { tenantId: otherTenantId }), {
      instanceId,
      kind: "api_key",
      secret: "sk_live_9f2c8ab4"
    });
    expect(sealer.sealed[0]?.aad.tenantId).toBe(otherTenantId);
  });

  it("fills the second slot next, leaving the working credential alone", async () => {
    const first = await service.write(rotator, { instanceId, kind: "api_key", secret: "sk_live_9f2c8ab4" });
    const second = await service.write(rotator, { instanceId, kind: "api_key", secret: "sk_live_0000aaaa" });
    expect([first.slot, second.slot]).toEqual(["primary", "secondary"]);
    expect(repository.rows.every((row) => !row.revoked)).toBe(true);
  });

  it("refuses a third, because that would be a rotation on top of a rotation", async () => {
    await service.write(rotator, { instanceId, kind: "api_key", secret: "sk_live_9f2c8ab4" });
    await service.write(rotator, { instanceId, kind: "api_key", secret: "sk_live_0000aaaa" });
    await expect(
      service.write(rotator, { instanceId, kind: "api_key", secret: "sk_live_1111bbbb" })
    ).rejects.toThrow("ROTATION_ALREADY_OPEN");
  });

  it("counts slots per kind, so a signing secret does not block an api key", async () => {
    await service.write(rotator, { instanceId, kind: "api_key", secret: "sk_live_9f2c8ab4" });
    await service.write(rotator, { instanceId, kind: "api_key", secret: "sk_live_0000aaaa" });
    const other = await service.write(rotator, { instanceId, kind: "signing_secret", secret: "whsec_abcd1234" });
    expect(other.slot).toBe("primary");
  });

  it("refuses a secret too short to be kept out of a log", async () => {
    await expect(service.write(rotator, { instanceId, kind: "api_key", secret: "short" })).rejects.toThrow(
      "SECRET_TOO_SHORT"
    );
    expect(sealer.sealed).toEqual([]);
  });

  it("refuses one too long for the column that has to hold it", async () => {
    await expect(
      service.write(rotator, { instanceId, kind: "api_key", secret: "a".repeat(8193) })
    ).rejects.toThrow("SECRET_TOO_LONG");
  });

  it("refuses an expiry already in the past", async () => {
    await expect(
      service.write(rotator, {
        instanceId,
        kind: "api_key",
        secret: "sk_live_9f2c8ab4",
        expiresAt: new Date(Date.now() - 1_000)
      })
    ).rejects.toThrow("ALREADY_EXPIRED");
  });

  it("refuses a kind that is not a plain identifier", async () => {
    for (const kind of ["", "API_KEY", "api key", "9key", "a".repeat(70)]) {
      await expect(service.write(rotator, { instanceId, kind, secret: "sk_live_9f2c8ab4" })).rejects.toThrow(
        "INVALID_KIND"
      );
    }
  });
});

describe("who may touch a credential", () => {
  const write = (caller: TenantContext) =>
    service.write(caller, { instanceId, kind: "api_key", secret: "sk_live_9f2c8ab4" });

  it("needs credentials:rotate, which reading integrations does not grant", async () => {
    await expect(write(context(["integrations:read", "integrations:manage"]))).rejects.toThrow("FORBIDDEN");
    await expect(write(context([]))).rejects.toThrow(ConnectorCredentialError);
  });

  it("needs a second factor even from somebody who has the permission", async () => {
    await expect(write(context(["credentials:rotate"], { mfaEnabled: false }))).rejects.toThrow("MFA_REQUIRED");
  });

  it("guards promotion and revocation the same way", async () => {
    const onlyReads = context(["integrations:read"]);
    await expect(service.promote(onlyReads, instanceId, "api_key")).rejects.toThrow("FORBIDDEN");
    await expect(service.revoke(onlyReads, instanceId)).rejects.toThrow("FORBIDDEN");
  });

  it("lets somebody with integrations:read list metadata, and nobody read a secret", async () => {
    await write(rotator);
    const listed = await service.list(context(["integrations:read"]), instanceId);
    expect(listed).toHaveLength(1);
    expect(Object.keys(listed[0]!)).not.toContain("ciphertext");
    expect(service).not.toHaveProperty("open");
    await expect(service.list(context([]), instanceId)).rejects.toThrow("FORBIDDEN");
  });
});

describe("finishing a rotation", () => {
  beforeEach(async () => {
    await service.write(rotator, { instanceId, kind: "api_key", secret: "sk_live_9f2c8ab4" });
    await service.write(rotator, { instanceId, kind: "api_key", secret: "sk_live_0000aaaa" });
  });

  it("makes the new secret the one that goes out, and retires the old one", async () => {
    const promoted = await service.promote(rotator, instanceId, "api_key");
    expect(promoted.slot).toBe("primary");
    expect(await reader.open(rotator, instanceId, "api_key")).toBe("sk_live_0000aaaa");
    expect(repository.rows.filter((row) => !row.revoked)).toHaveLength(1);
  });

  it("frees the slot again, so the next rotation can start", async () => {
    await service.promote(rotator, instanceId, "api_key");
    const next = await service.write(rotator, { instanceId, kind: "api_key", secret: "sk_live_2222cccc" });
    expect(next.slot).toBe("secondary");
  });

  it("says so rather than quietly succeeding when no rotation was started", async () => {
    await service.promote(rotator, instanceId, "api_key");
    await expect(service.promote(rotator, instanceId, "api_key")).rejects.toThrow("NO_ROTATION_IN_PROGRESS");
  });
});

describe("revoking", () => {
  it("takes every kind when told nothing, and one kind when told which", async () => {
    await service.write(rotator, { instanceId, kind: "api_key", secret: "sk_live_9f2c8ab4" });
    await service.write(rotator, { instanceId, kind: "signing_secret", secret: "whsec_abcd1234" });

    expect(await service.revoke(rotator, instanceId, "api_key")).toBe(1);
    expect(await reader.open(rotator, instanceId, "api_key")).toBeNull();
    expect(await reader.open(rotator, instanceId, "signing_secret")).toBe("whsec_abcd1234");
    expect(await service.revoke(rotator, instanceId)).toBe(1);
  });
});

describe("the worker reading a secret", () => {
  it("sends the primary out, never the half-installed secondary", async () => {
    await service.write(rotator, { instanceId, kind: "api_key", secret: "sk_live_9f2c8ab4" });
    await service.write(rotator, { instanceId, kind: "api_key", secret: "sk_live_0000aaaa" });
    expect(await reader.open(rotator, instanceId, "api_key")).toBe("sk_live_9f2c8ab4");
  });

  it("answers null rather than throwing when an instance has no credential of that kind", async () => {
    expect(await reader.open(rotator, instanceId, "api_key")).toBeNull();
  });

  it("records that it was used, which is what makes an abandoned rotation visible", async () => {
    await service.write(rotator, { instanceId, kind: "api_key", secret: "sk_live_9f2c8ab4" });
    await reader.open(rotator, instanceId, "api_key");
    expect(repository.rows[0]?.usedAt).toBeInstanceOf(Date);
  });

  it("offers both secrets to verify an inbound signature, the newest first", async () => {
    await service.write(rotator, { instanceId, kind: "signing_secret", secret: "whsec_old12345" });
    await service.write(rotator, { instanceId, kind: "signing_secret", secret: "whsec_new67890" });
    const candidates = await reader.openAll(rotator, instanceId, "signing_secret");
    expect(candidates.map((candidate) => candidate.secret)).toEqual(["whsec_new67890", "whsec_old12345"]);
  });

  it("marks the one that actually matched, not every one it tried", async () => {
    await service.write(rotator, { instanceId, kind: "signing_secret", secret: "whsec_old12345" });
    await service.write(rotator, { instanceId, kind: "signing_secret", secret: "whsec_new67890" });
    const candidates = await reader.openAll(rotator, instanceId, "signing_secret");
    await reader.markUsed(rotator, candidates[1]!.id);
    expect(repository.rows.filter((row) => row.usedAt !== null).map((row) => row.slot)).toEqual(["primary"]);
  });

  it("cannot open an envelope belonging to another tenant, whatever it was asked", async () => {
    await service.write(rotator, { instanceId, kind: "api_key", secret: "sk_live_9f2c8ab4" });
    const intruder = context(["credentials:rotate"], { tenantId: otherTenantId });
    await expect(reader.open(intruder, instanceId, "api_key")).rejects.toThrow("ENVELOPE_NOT_AUTHENTIC");
  });
});

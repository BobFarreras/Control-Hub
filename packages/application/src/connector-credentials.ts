import { hasPermission, type TenantContext } from "@control-hub/domain";
import type {
  ConnectorRepository,
  CredentialAad,
  CredentialMetadata,
  CredentialSealer,
  CredentialSlot
} from "./connectors.js";

/**
 * Writing and reading connector credentials, split into two classes on purpose.
 *
 * `ConnectorCredentialService` can seal and can never open: the API imports it, so no route can
 * return a secret even by mistake, because the object it holds has no method that produces one.
 * `ConnectorSecretReader` can open, and the only things that hold one are the worker, which is
 * the single process that talks to a provider, and `ConnectorIngressService`, which keeps its own
 * private and answers whether a signature matched rather than what it matched against. No route
 * is ever handed a reader. The boundary is a type, not a convention in a comment.
 *
 * Decision: `docs/adr/0008-connector-credential-vault.md`.
 */

export class ConnectorCredentialError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}

export type WriteCredentialInput = {
  instanceId: string;
  /** What the secret is for — `api_key`, `signing_secret`. The connector names its own kinds. */
  kind: string;
  secret: string;
  expiresAt?: Date | undefined;
};

/**
 * Below this a value is refused rather than stored.
 *
 * `redact` in the domain will not censor a value shorter than this, because doing so would blank
 * ordinary words out of every log line. A secret we cannot keep out of a log is a secret we
 * should not accept, and this is the only place that can still say no.
 */
const shortestAcceptableSecret = 8;

/**
 * And above this. The column holds 16 KiB of ciphertext; this leaves room for the tag and for a
 * secret whose characters are not all one byte, so the refusal is ours and legible rather than a
 * check constraint violation the caller cannot read.
 */
const longestAcceptableSecretBytes = 8_192;

const kindPattern = /^[a-z][a-z0-9_]{1,62}$/;

function assertWritable(context: TenantContext) {
  // The API already refuses a session without a second factor. Repeated here because this is the
  // one call that puts a customer's provider credential into our database: if the two layers ever
  // disagree, the safe one has to be the one closest to the secret.
  if (!context.mfaEnabled) throw new ConnectorCredentialError("MFA_REQUIRED");
  if (!hasPermission(context, "credentials:rotate")) throw new ConnectorCredentialError("FORBIDDEN");
}

function aadFor(context: TenantContext, instanceId: string): CredentialAad {
  return { tenantId: context.tenantId, instanceId };
}

export class ConnectorCredentialService {
  constructor(
    private readonly repository: ConnectorRepository,
    private readonly sealer: CredentialSealer
  ) {}

  /**
   * Stores a secret, sealed, in the first free slot.
   *
   * The slot is chosen here rather than by the caller so a rotation cannot be started by
   * overwriting the credential that is currently working. Both slots taken means a rotation is
   * already open and somebody has to finish or abandon it, which is a decision, not a retry.
   */
  async write(context: TenantContext, input: WriteCredentialInput): Promise<CredentialMetadata> {
    assertWritable(context);
    await this.requireInstance(context, input.instanceId);

    const kind = input.kind.trim();
    if (!kindPattern.test(kind)) throw new ConnectorCredentialError("INVALID_KIND");
    if (input.secret.length < shortestAcceptableSecret) throw new ConnectorCredentialError("SECRET_TOO_SHORT");
    if (Buffer.byteLength(input.secret, "utf8") > longestAcceptableSecretBytes) {
      throw new ConnectorCredentialError("SECRET_TOO_LONG");
    }
    if (input.expiresAt && input.expiresAt.getTime() <= Date.now()) {
      throw new ConnectorCredentialError("ALREADY_EXPIRED");
    }

    const live = await this.repository.readSealedCredentials(context, input.instanceId, kind);
    const slot = freeSlot(live.map((credential) => credential.slot));
    if (!slot) throw new ConnectorCredentialError("ROTATION_ALREADY_OPEN");

    const envelope = this.sealer.seal(input.secret, aadFor(context, input.instanceId));
    return this.repository.putCredential(context, {
      instanceId: input.instanceId,
      kind,
      slot,
      ...envelope,
      ...(input.expiresAt ? { expiresAt: input.expiresAt } : {})
    });
  }

  /**
   * Ends a rotation: the secondary becomes the primary and the old one is revoked, together.
   *
   * Failing loudly when there is no secondary matters more than it looks. The alternative — a
   * silent success — would let an operator believe they had rotated a credential that is still
   * the old one, which is worse than not rotating at all because it stops them from checking.
   */
  async promote(context: TenantContext, instanceId: string, kind: string): Promise<CredentialMetadata> {
    assertWritable(context);
    await this.requireInstance(context, instanceId);
    const promoted = await this.repository.promoteCredential(context, instanceId, kind.trim());
    if (!promoted) throw new ConnectorCredentialError("NO_ROTATION_IN_PROGRESS");
    return promoted;
  }

  /** Revokes every live credential of an instance, or of one kind. Returns how many it revoked. */
  async revoke(context: TenantContext, instanceId: string, kind?: string): Promise<number> {
    assertWritable(context);
    await this.requireInstance(context, instanceId);
    const trimmed = kind?.trim();
    return trimmed
      ? this.repository.revokeCredentials(context, instanceId, trimmed)
      : this.repository.revokeCredentials(context, instanceId);
  }

  /** Metadata only. There is no method here that returns a secret; see the note at the top. */
  async list(context: TenantContext, instanceId: string): Promise<CredentialMetadata[]> {
    if (!hasPermission(context, "integrations:read")) throw new ConnectorCredentialError("FORBIDDEN");
    await this.requireInstance(context, instanceId);
    return this.repository.listCredentials(context, instanceId);
  }

  /**
   * The instance has to exist, in this tenant, before anything is sealed against it.
   *
   * Without this the identifier reaches the foreign key and comes back as a constraint violation,
   * which says the same thing far less clearly — and an identifier from another tenant would be
   * refused by a database error rather than by a rule, which is not a boundary anybody can read.
   */
  private async requireInstance(context: TenantContext, instanceId: string): Promise<void> {
    const instance = await this.repository.getInstance(context, instanceId);
    if (!instance) throw new ConnectorCredentialError("INSTANCE_NOT_FOUND");
  }
}

/**
 * The secondary is filled first, so the primary keeps working while the new value is installed at
 * the provider. Once both exist, `promote` is the only way forward.
 */
function freeSlot(taken: readonly CredentialSlot[]): CredentialSlot | null {
  if (!taken.includes("primary")) return "primary";
  if (!taken.includes("secondary")) return "secondary";
  return null;
}

/**
 * The worker's side of the vault.
 *
 * It takes no permission because there is no person on the other end: a queued job runs under the
 * tenant it was enqueued for, and the isolation is the database's. What it does take is the
 * responsibility to record that a credential was used, which is what makes an abandoned rotation
 * visible on the integrations screen.
 */
export class ConnectorSecretReader {
  constructor(
    private readonly repository: ConnectorRepository,
    private readonly sealer: CredentialSealer
  ) {}

  /**
   * The credential to call a provider with: the primary, never the secondary.
   *
   * Egress has to be unambiguous. During a rotation the secondary exists but is not yet the value
   * the provider expects, and sending it would break every call for the length of the rotation.
   */
  async open(context: TenantContext, instanceId: string, kind: string): Promise<string | null> {
    const live = await this.repository.readSealedCredentials(context, instanceId, kind);
    const primary = live.find((credential) => credential.slot === "primary");
    if (!primary) return null;
    const secret = this.sealer.open(primary, aadFor(context, instanceId));
    await this.repository.markCredentialUsed(context, primary.id);
    return secret;
  }

  /**
   * Every live secret of one kind, the newest first, for verifying something a provider sent.
   *
   * Ingress is the mirror image of egress: while a rotation is open, a signature may legitimately
   * have been made with either value, so both have to be tried. The caller records which one
   * matched through `markUsed`, and a secondary that never matches is a rotation that was started
   * and never carried out at the provider.
   */
  async openAll(context: TenantContext, instanceId: string, kind: string): Promise<{ id: string; secret: string }[]> {
    const live = await this.repository.readSealedCredentials(context, instanceId, kind);
    const aad = aadFor(context, instanceId);
    return live.map((credential) => ({ id: credential.id, secret: this.sealer.open(credential, aad) }));
  }

  markUsed(context: TenantContext, credentialId: string): Promise<void> {
    return this.repository.markCredentialUsed(context, credentialId);
  }
}

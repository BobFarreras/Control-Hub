import { randomBytes } from "node:crypto";

/**
 * What the first Owner is created from, and where the password comes from.
 *
 * The interesting field is `passwordIsOurs`. `docs/specifications/deployment.md` makes it an
 * invariant that nothing the installer asks reaches a shell history or a log, and a password is
 * the answer that makes that hard: typed, it is in the history; printed, it is in the scrollback;
 * put in `.env`, it is on disk in plain text for as long as the installation lives.
 *
 * So the installer does not ask for one. When none is supplied this generates a password nobody
 * will ever see or need, and the caller sends the Owner a reset link instead -- which is the same
 * flow every other member of the installation goes through, rather than a second way in that
 * exists only for the first account.
 */
export type BootstrapInput = {
  email: string;
  name: string;
  tenantName: string;
  tenantSlug: string;
  password: string;
  /** True when this password was generated here, has never been displayed, and is not recoverable. */
  passwordIsOurs: boolean;
};

export class BootstrapInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BootstrapInputError";
  }
}

/** Better Auth's own floor, named here so a supplied password is refused for the same reason. */
export const minimumPasswordLength = 12;

const slugPattern = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;
const emailPattern = /^[^\s@]+@[^\s@.]+\.[^\s@]+$/;

/**
 * 32 bytes of `crypto.randomBytes`, which is 256 bits and not a compromise.
 *
 * There is no reason to be frugal: the length costs nothing because no human types it, and the
 * account it protects is the one that owns the installation. Between generating this and the Owner
 * setting their own, the password's only job is to be unguessable by whoever finds the port open.
 */
export function generatePassword(): string {
  return randomBytes(32).toString("base64url");
}

export function parseBootstrapInput(environment: NodeJS.ProcessEnv): BootstrapInput {
  const email = environment.BOOTSTRAP_OWNER_EMAIL?.trim().toLowerCase();
  const name = environment.BOOTSTRAP_OWNER_NAME?.trim();
  const tenantName = environment.BOOTSTRAP_TENANT_NAME?.trim();
  const tenantSlug = environment.BOOTSTRAP_TENANT_SLUG?.trim();
  const supplied = environment.BOOTSTRAP_OWNER_PASSWORD;

  if (!email || !emailPattern.test(email)) throw new BootstrapInputError("BOOTSTRAP_OWNER_EMAIL must be an address");
  if (!name) throw new BootstrapInputError("BOOTSTRAP_OWNER_NAME is required");
  if (!tenantName) throw new BootstrapInputError("BOOTSTRAP_TENANT_NAME is required");
  if (!tenantSlug || !slugPattern.test(tenantSlug)) {
    throw new BootstrapInputError("BOOTSTRAP_TENANT_SLUG must be lowercase letters, digits and hyphens");
  }
  // Supplied deliberately, so it is held to the same floor as any other password on the
  // installation. The generated path skips this check because it cannot fail it -- but a supplied
  // one that is too short is somebody choosing a weak password for the account that owns
  // everything, and the fact that it arrives through an environment variable does not change that.
  if (supplied !== undefined && supplied.length < minimumPasswordLength) {
    throw new BootstrapInputError(`BOOTSTRAP_OWNER_PASSWORD must be at least ${minimumPasswordLength} characters`);
  }

  return {
    email,
    name,
    tenantName,
    tenantSlug,
    password: supplied ?? generatePassword(),
    passwordIsOurs: supplied === undefined
  };
}

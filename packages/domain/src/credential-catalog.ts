export const passwordManagerProviders = ["bitwarden"] as const;
export type PasswordManagerProvider = (typeof passwordManagerProviders)[number];

export const passwordManagerDeploymentModes = ["cloud", "self_hosted_shared_vps", "self_hosted_dedicated_vps"] as const;
export type PasswordManagerDeploymentMode = (typeof passwordManagerDeploymentModes)[number];

export const passwordManagerStatuses = ["active", "degraded", "disabled"] as const;
export type PasswordManagerStatus = (typeof passwordManagerStatuses)[number];

export const credentialCatalogCategories = [
  "hosting",
  "email",
  "domain",
  "website_admin",
  "billing",
  "social",
  "infrastructure",
  "other"
] as const;
export type CredentialCatalogCategory = (typeof credentialCatalogCategories)[number];

export const credentialCatalogEnvironments = ["production", "staging", "development", "other"] as const;
export type CredentialCatalogEnvironment = (typeof credentialCatalogEnvironments)[number];

export const credentialCatalogStatuses = ["active", "review_due", "revoked", "archived"] as const;
export type CredentialCatalogStatus = (typeof credentialCatalogStatuses)[number];

const transitions: Record<CredentialCatalogStatus, readonly CredentialCatalogStatus[]> = {
  active: ["review_due", "revoked", "archived"],
  review_due: ["active", "revoked", "archived"],
  revoked: ["archived"],
  archived: ["active"]
};

export function canTransitionCredentialCatalogEntry(
  from: CredentialCatalogStatus,
  to: CredentialCatalogStatus
): boolean {
  return transitions[from].includes(to);
}

/**
 * The feature flags this installation knows about.
 *
 * Declared, not free text: a flag nobody can spell wrong is a flag that cannot be silently on
 * in one service and off in another. Each one carries an owner and the day it has to be gone
 * by, because the expensive kind of flag is the one everybody forgot was there.
 *
 * A flag decides whether a capability is *deployed*, never who may use it. Authorisation stays
 * with permissions; turning a flag on does not grant anybody anything.
 */
export const featureFlags = {
  projects_and_time: {
    description: "Projects, time entries, hourly rates and profitability (Phase 5B).",
    owner: "owner",
    retireOn: "2026-12-31"
  }
} as const;

export type FeatureFlag = keyof typeof featureFlags;
export type FeatureFlagSet = ReadonlySet<FeatureFlag>;

const declared = new Set(Object.keys(featureFlags) as FeatureFlag[]);

/**
 * Reads the enabled flags from a comma-separated list, ignoring names nobody declared.
 *
 * Ignoring rather than throwing is deliberate: a typo in an environment variable should not
 * stop a service from booting, and a flag that is not in the registry can only ever be off.
 */
export function parseFeatureFlags(value: string | undefined): FeatureFlagSet {
  const requested = (value ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
  return new Set(requested.filter((name): name is FeatureFlag => declared.has(name as FeatureFlag)));
}

export function isFeatureEnabled(flags: FeatureFlagSet, flag: FeatureFlag): boolean {
  return flags.has(flag);
}

/** Names that were asked for but are not declared, so a deployment can report them. */
export function unknownFeatureFlags(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name.length > 0 && !declared.has(name as FeatureFlag));
}

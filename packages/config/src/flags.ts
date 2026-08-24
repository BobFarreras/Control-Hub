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
  },
  /**
   * Off until the accountancy confirms the shape of the record is acceptable, which is a
   * conversation and not a deployment. The code ships regardless: this is the case the registry
   * was built for, per `docs/specifications/attendance.md`.
   */
  attendance: {
    description: "Working time records, corrections and reconciliation against logged hours (Phase 5C).",
    owner: "owner",
    retireOn: "2027-06-30"
  },
  /**
   * Off until the platform is complete. It gates the inbound webhook route as well as the
   * integrations screen: a signing endpoint that answers before anything can process what it
   * accepts is an open door, not a partial feature. See `docs/specifications/connectors.md`.
   */
  connectors: {
    description: "Connector contract, credential vault, outbound calls and signed webhooks (Phase 6).",
    owner: "owner",
    retireOn: "2027-06-30"
  },
  /**
   * Off by default, and it gates more than a screen: with it closed the worker schedules no
   * connector operation at all and removes any schedule it finds. A phase that polls a provider
   * every five minutes has to be switchable off from the outside, or the only way to stop it is a
   * deploy. See `docs/specifications/infrastructure.md`.
   */
  infrastructure: {
    description: "Infrastructure and n8n: pulled records, scheduled operations, alerts (Phase 7).",
    owner: "owner",
    retireOn: "2027-12-31"
  },
  usage_costs: {
    description: "Provider usage ingestion, reproducible valuation and informative budgets (Phase 8).",
    owner: "owner",
    retireOn: "2028-06-30"
  },
  mail: {
    description: "Support mailbox import and confirmed replies through connector actions (Phase 8).",
    owner: "owner",
    retireOn: "2028-06-30"
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

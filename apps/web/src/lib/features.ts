import { isFeatureEnabled, parseFeatureFlags, type FeatureFlag } from "@control-hub/config/flags";

/**
 * The flags this process was started with, read at request time.
 *
 * Read from the server environment rather than from a `NEXT_PUBLIC_` variable on purpose: a
 * public variable is inlined into the bundle when the image is built, and a flag that can only
 * be changed by rebuilding is not a flag. Pages resolve it on the server and pass the answer
 * down, so a client component never has to ask.
 */
export function enabledFeatures(): FeatureFlag[] {
  return [...parseFeatureFlags(process.env.CONTROL_HUB_FLAGS)];
}

export function featureEnabled(flag: FeatureFlag): boolean {
  return isFeatureEnabled(parseFeatureFlags(process.env.CONTROL_HUB_FLAGS), flag);
}

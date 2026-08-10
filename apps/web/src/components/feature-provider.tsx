"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * The enabled feature flags, resolved once on the server and handed to the tree.
 *
 * A client component cannot read `CONTROL_HUB_FLAGS`: the environment is not there, and asking
 * would quietly answer "off" rather than fail. That is exactly how the security page, which is
 * a client component, would have ended up with a menu different from every other page.
 *
 * A `NEXT_PUBLIC_` variable would reach the browser, but it is inlined when the image is built,
 * and a flag that needs a rebuild to change is not a flag.
 */
const FeatureContext = createContext<readonly string[]>([]);

export function FeatureProvider({ features, children }: { features: readonly string[]; children: ReactNode }) {
  return <FeatureContext.Provider value={features}>{children}</FeatureContext.Provider>;
}

export function useFeature(flag: string): boolean {
  return useContext(FeatureContext).includes(flag);
}

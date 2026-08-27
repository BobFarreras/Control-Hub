"use client";

import type { UpdateCheckState } from "@control-hub/contracts/release";
import { createContext, useContext, type ReactNode } from "react";

/**
 * What the worker last found, resolved once on the server and handed to the whole tree.
 *
 * The same reasoning as the feature flags and the clock state beside it: the notice sits above
 * the topbar of every screen, and fetching it from the browser after mount would paint the page
 * and then push it down, on every navigation.
 *
 * There is a second reason here that the others do not have. The browser must never be what asks
 * whether a new version exists -- `docs/specifications/deployment.md` (D5) -- and resolving this
 * on the server keeps the whole question on one side of the boundary. The browser reads a value
 * this installation already knew.
 *
 * Null means there is nothing to show: no session, no check has run, or the person is neither
 * Owner nor Administrator, which the API decides rather than this.
 */
const UpdateContext = createContext<UpdateCheckState | null>(null);

export function UpdateProvider({ state, children }: { state: UpdateCheckState | null; children: ReactNode }) {
  return <UpdateContext.Provider value={state}>{children}</UpdateContext.Provider>;
}

export function usePendingUpdate(): UpdateCheckState | null {
  return useContext(UpdateContext);
}

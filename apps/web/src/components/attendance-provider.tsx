"use client";

import { createContext, useContext, type ReactNode } from "react";

export type AttendanceState = "out" | "in" | "paused";
export type AttendanceStatus = { state: AttendanceState; policy: { pausesEnabled: boolean } };

/**
 * Where this person stands, resolved once on the server and handed to the tree.
 *
 * The same reasoning as the feature flags above it: the control lives in the topbar of every
 * screen, and fetching it from the browser after mount would paint an empty gap on first render
 * and then a button, on every navigation. Resolved here it is right in the first paint.
 *
 * Null means there is nothing to show -- no session, the flag off, or the API unreachable -- and
 * the button renders nothing rather than guessing a state it does not know.
 */
const AttendanceContext = createContext<AttendanceStatus | null>(null);

export function AttendanceProvider({ status, children }: { status: AttendanceStatus | null; children: ReactNode }) {
  return <AttendanceContext.Provider value={status}>{children}</AttendanceContext.Provider>;
}

export function useAttendanceStatus(): AttendanceStatus | null {
  return useContext(AttendanceContext);
}

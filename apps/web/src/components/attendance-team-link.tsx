"use client";

import { Users } from "lucide-react";
import Link from "next/link";
import { useAttendanceStatus } from "@/components/attendance-provider";

/**
 * The way through to everybody's record, shown only to somebody who may read it.
 *
 * A client component so it can read the status the root layout already resolved: the answer is
 * about the person, and asking the API a second time on every page to learn one boolean would be
 * a request nobody needed. The screen it leads to refuses on its own account anyway -- the link
 * being absent is courtesy, not the control.
 */
export function AttendanceTeamLink({ href, label }: { href: string; label: string }) {
  if (!useAttendanceStatus()?.canManage) return null;
  return (
    <Link className="secondary-button" href={href}>
      <Users size={16} aria-hidden="true" />
      {label}
    </Link>
  );
}

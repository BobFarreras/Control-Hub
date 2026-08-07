"use client";

import { getAttendanceDictionary, isLocale } from "@control-hub/i18n";
import { Coffee, LogIn, LogOut, Play } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { useAttendanceStatus, type AttendanceStatus } from "@/components/attendance-provider";
import { useToast } from "@/components/toast";

type PunchKind = "clock_in" | "clock_out" | "pause_start" | "pause_end";

/**
 * Clocking in and out, from wherever somebody happens to be in the product.
 *
 * It lives in the topbar rather than on a screen of its own because the specification is blunt
 * about it: if clocking in takes more than two seconds it will not get done, and a record with
 * holes in it is worth less than no record at all.
 *
 * The state is a word and an icon, never a colour on its own. Somebody who cannot separate green
 * from red still has to be able to tell whether they are at work.
 */
export function ClockButton() {
  const initial = useAttendanceStatus();
  const pathname = usePathname();
  const router = useRouter();
  const { toast } = useToast();

  // Seeded from the server so the first paint is already right, then moved on by what each punch
  // answers. There is no effect here on purpose: nothing to fetch after mount, nothing to flash.
  const [status, setStatus] = useState<AttendanceStatus | null>(initial);
  const [busy, setBusy] = useState(false);

  if (!status) return null;

  const segment = pathname.split("/")[1] ?? "";
  const t = getAttendanceDictionary(isLocale(segment) ? segment : "ca");

  async function punch(kind: PunchKind) {
    setBusy(true);
    const response = await fetch("/api/v1/attendance/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind })
    });
    setBusy(false);

    const payload = (await response.json().catch(() => null)) as ({ code?: string } & Partial<AttendanceStatus>) | null;

    if (!response.ok) {
      /**
       * A refusal here almost always means the same person clocked in somewhere else, so the
       * useful answer is what their record now says. Re-rendering the route re-reads the state on
       * the server rather than guessing it here.
       */
      if (payload?.code === "PUNCH_NOT_ALLOWED") {
        router.refresh();
        return toast("warning", t.notAllowed);
      }
      return toast("error", t.failed);
    }

    // The state comes back with the entry, so the screen never keeps its own copy of the rules
    // about what may be pressed next. Two versions of that would drift.
    if (payload?.state) setStatus({ state: payload.state, policy: payload.policy ?? status!.policy });
    toast("success", t.saved);
    // So a record open on another tab, or the month below, sees the new entry.
    router.refresh();
  }

  const label = status.state === "in" ? t.stateIn : status.state === "paused" ? t.statePaused : t.stateOut;

  return (
    <div className="clock-control" data-state={status.state}>
      <span className="clock-state">
        <span className="clock-dot" aria-hidden="true" />
        {label}
      </span>

      {status.state === "out" && (
        <button className="clock-action" disabled={busy} onClick={() => void punch("clock_in")}>
          <LogIn size={16} aria-hidden="true" />
          {t.clockIn}
        </button>
      )}

      {status.state === "in" && (
        <>
          {status.policy.pausesEnabled && (
            <button className="clock-action secondary" disabled={busy} onClick={() => void punch("pause_start")}>
              <Coffee size={16} aria-hidden="true" />
              {t.pauseStart}
            </button>
          )}
          <button className="clock-action" disabled={busy} onClick={() => void punch("clock_out")}>
            <LogOut size={16} aria-hidden="true" />
            {t.clockOut}
          </button>
        </>
      )}

      {/*
        On a break, resuming is the only thing offered. Clocking out from here is refused by the
        domain on purpose, and the screen says so by not pretending otherwise: closing the break
        silently at the clock out would make the day's total depend on a rule nobody reads. The
        record screen is where a break somebody forgot to close gets put right.
      */}
      {status.state === "paused" && (
        <button className="clock-action" disabled={busy} onClick={() => void punch("pause_end")}>
          <Play size={16} aria-hidden="true" />
          {t.pauseEnd}
        </button>
      )}
    </div>
  );
}

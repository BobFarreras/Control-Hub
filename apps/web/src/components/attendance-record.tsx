"use client";

import { AlertTriangle, Clock, PencilLine } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { MetricTile } from "@/components/metric-tile";
import { useToast } from "@/components/toast";
import type { AttendanceEvent, AttendanceMonth } from "@/lib/api-types";
import { formValue } from "@/lib/form";
import { formatHours } from "@/lib/format";

type Labels = Record<string, string>;

/** The entries that still count, so a corrected one can be shown as retired without recomputing. */
function supersededIds(events: AttendanceEvent[]): Set<string> {
  return new Set(events.map((event) => event.correctsEventId).filter((id): id is string => Boolean(id)));
}

/** Written later than it says it happened, which is what makes it a declaration and not a punch. */
function wasDeclared(event: AttendanceEvent): boolean {
  return Boolean(event.correctsEventId) || new Date(event.occurredAt) < new Date(event.recordedAt);
}

/** `YYYY-MM-DDTHH:mm` in local time, which is what `datetime-local` expects. */
function toLocalInput(value: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}T${pad(value.getHours())}:${pad(value.getMinutes())}`;
}

/**
 * A person's own month: what they worked, and every entry behind it.
 *
 * Both halves are on screen at once on purpose. The totals are what somebody checks against their
 * payslip; the entries are what makes the record defensible, and hiding a correction behind a tab
 * would make the tidy version the one everybody reads.
 */
export function AttendanceRecord({
  month,
  labels: t,
  locale
}: {
  month: AttendanceMonth;
  labels: Labels;
  locale: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [correcting, setCorrecting] = useState<AttendanceEvent | null>(null);
  const [busy, setBusy] = useState(false);

  const superseded = supersededIds(month.events);
  const time = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" });
  const date = new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short" });

  async function submitCorrection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!correcting) return;
    const data = new FormData(event.currentTarget);
    setBusy(true);
    const response = await fetch("/api/v1/attendance/corrections", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: correcting.kind,
        // Sent as an instant, so what reaches the record is a moment in time and not a reading of
        // whatever clock the browser happens to be set to.
        occurredAt: new Date(formValue(data, "occurredAt")).toISOString(),
        reason: formValue(data, "reason"),
        correctsEventId: correcting.id
      })
    });
    setBusy(false);

    if (!response.ok) return toast("error", t.failed!);
    setCorrecting(null);
    toast("success", t.correctionSaved!);
    router.refresh();
  }

  return (
    <>
      <section className="metric-row" aria-label={t.total}>
        <MetricTile label={t.total!} icon={Clock} value={formatHours(month.totalMinutes)} />
      </section>

      <section className="project-panel" aria-label={t.title}>
        <h3>{t.day}</h3>
        <div className="crm-table-wrap inside-panel">
          <table className="crm-table">
            <thead>
              <tr>
                <th>{t.day}</th>
                <th>{t.worked}</th>
              </tr>
            </thead>
            <tbody>
              {month.days.length === 0 && (
                <tr>
                  <td colSpan={2}>{t.empty}</td>
                </tr>
              )}
              {month.days.map((day) => (
                <tr key={day.day}>
                  <td>{date.format(new Date(`${day.day}T12:00:00`))}</td>
                  <td>
                    {formatHours(day.workedMinutes)}
                    {/*
                      A day still holding an unfinished session says so beside its total. Without
                      this it reads as a short day rather than an unfinished one, and those are
                      not the same thing at all.
                    */}
                    {day.hasOpenSession && (
                      <span className="metric-todo">
                        <AlertTriangle size={13} aria-hidden="true" />
                        {t.openSession}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="project-panel" aria-label={t.history}>
        <h3>{t.history}</h3>
        <div className="crm-table-wrap inside-panel">
          <table className="crm-table">
            <thead>
              <tr>
                <th>{t.kind}</th>
                <th>{t.at}</th>
                <th>{t.reason}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {month.events.length === 0 && (
                <tr>
                  <td colSpan={4}>{t.empty}</td>
                </tr>
              )}
              {month.events.map((event) => {
                const retired = superseded.has(event.id);
                return (
                  <tr key={event.id} className={retired ? "attendance-retired" : undefined}>
                    <td>
                      {t[kindKey(event.kind)]}
                      {/*
                        Both marks are words, not styling. A row that only looked faded would say
                        nothing on a printout, and a printout is what an inspection reads.
                      */}
                      {retired && <span className="attendance-mark">{t.corrected}</span>}
                      {!retired && wasDeclared(event) && <span className="attendance-mark">{t.declared}</span>}
                    </td>
                    <td>{time.format(new Date(event.occurredAt))}</td>
                    <td>{event.reason ?? ""}</td>
                    <td>
                      {!retired && (
                        <button className="icon-button" aria-label={t.correct} onClick={() => setCorrecting(event)}>
                          <PencilLine size={16} />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {correcting && (
        <div className="dialog-backdrop" role="presentation">
          <section className="crm-dialog" role="dialog" aria-modal="true" aria-label={t.correctTitle}>
            <header>
              <h2>{t.correctTitle}</h2>
            </header>
            {/* Said before the form, not after a failure: it is why the two fields are mandatory. */}
            <p className="dialog-note">{t.correctBody}</p>
            <form className="commerce-form" onSubmit={(event) => void submitCorrection(event)}>
              <label>
                {t.occurredAt}
                <input
                  name="occurredAt"
                  type="datetime-local"
                  required
                  disabled={busy}
                  defaultValue={toLocalInput(new Date(correcting.occurredAt))}
                />
              </label>
              <label className="full-width">
                {t.reason}
                <input name="reason" required minLength={1} maxLength={500} disabled={busy} />
              </label>
              <div className="dialog-actions">
                <button type="button" className="secondary-button" disabled={busy} onClick={() => setCorrecting(null)}>
                  {t.cancel}
                </button>
                <button className="primary-button" disabled={busy}>
                  {t.save}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </>
  );
}

function kindKey(kind: AttendanceEvent["kind"]): string {
  return kind === "clock_in"
    ? "clockIn"
    : kind === "clock_out"
      ? "clockOut"
      : kind === "pause_start"
        ? "pauseStart"
        : "pauseEnd";
}

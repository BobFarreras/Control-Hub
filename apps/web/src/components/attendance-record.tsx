"use client";

import { AlertTriangle, Clock, PencilLine, Plane, FileText, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useEffect, useRef, type FormEvent } from "react";
import { MetricTile } from "@/components/metric-tile";
import { useToast } from "@/components/toast";
import type {
  AttendanceEvent,
  AttendanceMonth,
  AttendanceHoliday,
  AttendanceVacation,
  AttendanceAbsence
} from "@/lib/api-types";
import { formValue } from "@/lib/form";
import { formatHours } from "@/lib/format";

type Labels = Record<string, string>;
type HolidaysResponse = { holidays: AttendanceHoliday[] };
type VacationsResponse = { vacations: AttendanceVacation[] };
type AbsencesResponse = { absences: AttendanceAbsence[] };

function supersededIds(events: AttendanceEvent[]): Set<string> {
  return new Set(events.map((event) => event.correctsEventId).filter((id): id is string => Boolean(id)));
}

function wasDeclared(event: AttendanceEvent): boolean {
  return Boolean(event.correctsEventId) || new Date(event.occurredAt) < new Date(event.recordedAt);
}

function toLocalInput(value: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}T${pad(value.getHours())}:${pad(value.getMinutes())}`;
}

export function AttendanceRecord({
  month,
  labels: t,
  locale,
  view = "table"
}: {
  month: AttendanceMonth;
  labels: Labels;
  locale: string;
  view?: "table" | "calendar";
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [correcting, setCorrecting] = useState<AttendanceEvent | null>(null);
  const [showVacationForm, setShowVacationForm] = useState(false);
  const [showAbsenceForm, setShowAbsenceForm] = useState(false);
  const [vacationFormDate, setVacationFormDate] = useState("");
  const [absenceFormDate, setAbsenceFormDate] = useState("");
  const [busy, setBusy] = useState(false);

  const [holidays, setHolidays] = useState<AttendanceHoliday[]>([]);
  const [vacations, setVacations] = useState<AttendanceVacation[]>([]);
  const [absences, setAbsences] = useState<AttendanceAbsence[]>([]);
  const [calendarVersion, setCalendarVersion] = useState(0);

  const superseded = supersededIds(month.events);
  const time = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" });
  const date = new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short" });

  useEffect(() => {
    if (view !== "calendar" || month.days.length === 0) return;
    const from = month.days[0]!.day;
    const to = month.days[month.days.length - 1]!.day;
    const params = `from=${from}&to=${to}&membershipId=${month.membershipId}`;

    void Promise.all([
      fetch(`/api/v1/attendance/holidays?${params}`).then(async (response): Promise<HolidaysResponse> =>
        response.ok ? ((await response.json()) as HolidaysResponse) : { holidays: [] }
      ),
      fetch(`/api/v1/attendance/vacations?${params}`).then(async (response): Promise<VacationsResponse> =>
        response.ok ? ((await response.json()) as VacationsResponse) : { vacations: [] }
      ),
      fetch(`/api/v1/attendance/absences?${params}`).then(async (response): Promise<AbsencesResponse> =>
        response.ok ? ((await response.json()) as AbsencesResponse) : { absences: [] }
      )
    ]).then(([h, v, a]) => {
      setHolidays(h.holidays ?? []);
      setVacations(v.vacations ?? []);
      setAbsences(a.absences ?? []);
    });
  }, [view, month.days, month.membershipId, calendarVersion]);

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

  async function submitVacation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    const response = await fetch("/api/v1/attendance/vacations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        membershipId: month.membershipId,
        startDate: formValue(data, "startDate"),
        endDate: formValue(data, "endDate"),
        notes: formValue(data, "notes") || undefined
      })
    });
    setBusy(false);

    if (!response.ok) return toast("error", t.failed!);
    setShowVacationForm(false);
    toast("success", t.vacationRequested!);
    setCalendarVersion((v) => v + 1);
  }

  async function submitAbsence(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    const response = await fetch("/api/v1/attendance/absences", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        membershipId: month.membershipId,
        startDate: formValue(data, "startDate"),
        endDate: formValue(data, "endDate"),
        type: formValue(data, "type"),
        notes: formValue(data, "notes") || undefined
      })
    });
    setBusy(false);

    if (!response.ok) return toast("error", t.failed!);
    setShowAbsenceForm(false);
    toast("success", t.absenceRequested!);
    setCalendarVersion((v) => v + 1);
  }

  async function cancelVacation(vacationId: string) {
    if (!confirm(t.confirmCancel)) return;
    setBusy(true);
    const response = await fetch(`/api/v1/attendance/vacations/${vacationId}`, { method: "DELETE" });
    setBusy(false);
    if (!response.ok) return toast("error", t.failed!);
    toast("success", t.vacationCancelled!);
    setCalendarVersion((v) => v + 1);
  }

  async function cancelAbsence(absenceId: string) {
    if (!confirm(t.confirmCancel)) return;
    setBusy(true);
    const response = await fetch(`/api/v1/attendance/absences/${absenceId}`, { method: "DELETE" });
    setBusy(false);
    if (!response.ok) return toast("error", t.failed!);
    toast("success", t.absenceCancelled!);
    setCalendarVersion((v) => v + 1);
  }

  return (
    <>
      <section className="metric-row" aria-label={t.total}>
        <MetricTile label={t.total!} icon={Clock} value={formatHours(month.totalMinutes)} />
      </section>

      {view === "calendar" ? (
        <CalendarView
          month={month}
          labels={t}
          time={time}
          date={date}
          holidays={holidays}
          vacations={vacations}
          absences={absences}
          onVacationClick={(d) => {
            setVacationFormDate(d);
            setShowVacationForm(true);
          }}
          onAbsenceClick={(d) => {
            setAbsenceFormDate(d);
            setShowAbsenceForm(true);
          }}
          onCancelVacation={(id) => void cancelVacation(id)}
          onCancelAbsence={(id) => void cancelAbsence(id)}
        />
      ) : (
        <TableView month={month} labels={t} time={time} date={date} />
      )}

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

      {showVacationForm && (
        <div className="dialog-backdrop" role="presentation">
          <section className="crm-dialog" role="dialog" aria-modal="true" aria-label={t.requestVacation}>
            <header>
              <h2>{t.requestVacation}</h2>
            </header>
            <p className="dialog-note">{t.vacationNote}</p>
            <form className="commerce-form" onSubmit={(event) => void submitVacation(event)}>
              <label>
                {t.vacationStart}
                <input name="startDate" type="date" required disabled={busy} defaultValue={vacationFormDate} />
              </label>
              <label>
                {t.vacationEnd}
                <input name="endDate" type="date" required disabled={busy} defaultValue={vacationFormDate} />
              </label>
              <label className="full-width">
                {t.notes}
                <input name="notes" maxLength={1000} disabled={busy} />
              </label>
              <div className="dialog-actions">
                <button
                  type="button"
                  className="secondary-button"
                  disabled={busy}
                  onClick={() => setShowVacationForm(false)}
                >
                  {t.cancel}
                </button>
                <button className="primary-button" disabled={busy}>
                  {t.send}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

      {showAbsenceForm && (
        <div className="dialog-backdrop" role="presentation">
          <section className="crm-dialog" role="dialog" aria-modal="true" aria-label={t.requestAbsence}>
            <header>
              <h2>{t.requestAbsence}</h2>
            </header>
            <p className="dialog-note">{t.absenceNote}</p>
            <form className="commerce-form" onSubmit={(event) => void submitAbsence(event)}>
              <label>
                {t.absenceType}
                <select name="type" required disabled={busy}>
                  <option value="sick_leave">{t.absenceSick}</option>
                  <option value="personal_leave">{t.absencePersonal}</option>
                  <option value="other">{t.absenceOther}</option>
                </select>
              </label>
              <label>
                {t.absenceStart}
                <input name="startDate" type="date" required disabled={busy} defaultValue={absenceFormDate} />
              </label>
              <label>
                {t.absenceEnd}
                <input name="endDate" type="date" required disabled={busy} defaultValue={absenceFormDate} />
              </label>
              <label className="full-width">
                {t.notes}
                <input name="notes" maxLength={1000} disabled={busy} />
              </label>
              <div className="dialog-actions">
                <button
                  type="button"
                  className="secondary-button"
                  disabled={busy}
                  onClick={() => setShowAbsenceForm(false)}
                >
                  {t.cancel}
                </button>
                <button className="primary-button" disabled={busy}>
                  {t.send}
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

function TableView({
  month,
  labels: t,
  time,
  date
}: {
  month: AttendanceMonth;
  labels: Labels;
  time: Intl.DateTimeFormat;
  date: Intl.DateTimeFormat;
}) {
  return (
    <section className="project-panel" aria-label={t.title}>
      <h3>{t.day}</h3>
      <div className="crm-table-wrap inside-panel">
        <table className="crm-table">
          <thead>
            <tr>
              <th>{t.day}</th>
              <th>{t.entry}</th>
              <th>{t.worked}</th>
            </tr>
          </thead>
          <tbody>
            {month.days.length === 0 && (
              <tr>
                <td colSpan={3}>{t.empty}</td>
              </tr>
            )}
            {month.days.map((day) => (
              <tr key={day.day}>
                <td>{date.format(new Date(`${day.day}T12:00:00`))}</td>
                <td className="attendance-times">
                  {month.sessions
                    .filter((session) => session.day === day.day)
                    .map((session) => (
                      <span key={session.startedAt}>
                        {time.format(new Date(session.startedAt))}
                        {"–"}
                        {session.endedAt ? time.format(new Date(session.endedAt)) : ""}
                      </span>
                    ))}
                </td>
                <td>
                  {formatHours(day.workedMinutes)}
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
  );
}

function CalendarView({
  month,
  labels: t,
  time,
  date,
  holidays,
  vacations,
  absences,
  onVacationClick,
  onAbsenceClick,
  onCancelVacation,
  onCancelAbsence
}: {
  month: AttendanceMonth;
  labels: Labels;
  time: Intl.DateTimeFormat;
  date: Intl.DateTimeFormat;
  holidays: AttendanceHoliday[];
  vacations: AttendanceVacation[];
  absences: AttendanceAbsence[];
  onVacationClick: (date: string) => void;
  onAbsenceClick: (date: string) => void;
  onCancelVacation: (id: string) => void;
  onCancelAbsence: (id: string) => void;
}) {
  const [popover, setPopover] = useState<{ dayStr: string; x: number; y: number } | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!popover) return;
    function handleClickOutside(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setPopover(null);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [popover]);

  const firstDay = month.days[0]?.day ?? new Date().toISOString().slice(0, 10);
  const parts = firstDay.split("-");
  const year = parseInt(parts[0] ?? "0", 10);
  const monthNum = parseInt(parts[1] ?? "1", 10);
  const daysInMonth = new Date(year, monthNum, 0).getDate();
  const firstDayOfWeek = (new Date(`${firstDay}T12:00:00`).getDay() + 6) % 7;

  const calendarDays: (string | null)[] = [];
  for (let i = 0; i < firstDayOfWeek; i++) {
    calendarDays.push(null);
  }
  for (let day = 1; day <= daysInMonth; day++) {
    const dayStr = `${year}-${String(monthNum).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    calendarDays.push(dayStr);
  }

  const dayDataMap = new Map(
    month.days.map((day) => [
      day.day,
      {
        workedMinutes: day.workedMinutes,
        hasOpenSession: day.hasOpenSession,
        sessions: month.sessions.filter((session) => session.day === day.day)
      }
    ])
  );

  const holidayDates = new Set(holidays.map((h) => h.date));
  const vacationMap = new Map<string, { vacation: AttendanceVacation; isPending: boolean }>();
  for (const v of vacations) {
    const isPending = v.status === "pending";
    if (v.status !== "approved" && !isPending) continue;
    const start = new Date(v.startDate + "T12:00:00");
    const end = new Date(v.endDate + "T12:00:00");
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const ds = d.toISOString().slice(0, 10);
      if (ds >= v.startDate && ds <= v.endDate) vacationMap.set(ds, { vacation: v, isPending });
    }
  }
  const absenceMap = new Map<string, { absence: AttendanceAbsence; isPending: boolean }>();
  for (const a of absences) {
    const start = new Date(a.startDate + "T12:00:00");
    const end = new Date(a.endDate + "T12:00:00");
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const ds = d.toISOString().slice(0, 10);
      if (ds >= a.startDate && ds <= a.endDate) absenceMap.set(ds, { absence: a, isPending: false });
    }
  }

  const dayNames = [t.monday, t.tuesday, t.wednesday, t.thursday, t.friday, t.saturday, t.sunday];

  function handleCellClick(dayStr: string, e: React.MouseEvent) {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setPopover({ dayStr, x: rect.left + rect.width / 2, y: rect.bottom + 4 });
  }

  return (
    <section className="project-panel" aria-label={t.calendarView}>
      <h3>{t.calendar}</h3>
      <div className="attendance-calendar">
        <div className="calendar-header" role="row">
          {dayNames.map((name) => (
            <div key={name} className="calendar-day-name" role="columnheader">
              {name}
            </div>
          ))}
        </div>
        <div className="calendar-grid" role="grid">
          {calendarDays.map((dayStr, index) => {
            if (!dayStr) {
              return <div key={`empty-${index}`} className="calendar-cell empty" role="gridcell" />;
            }

            const dayData = dayDataMap.get(dayStr);
            const dayParts = dayStr.split("-");
            const dayNum = parseInt(dayParts[2] ?? "1", 10);
            const hasWorked = dayData && dayData.workedMinutes > 0;
            const hasOpenSession = dayData?.hasOpenSession ?? false;
            const isHoliday = holidayDates.has(dayStr);
            const vacationEntry = vacationMap.get(dayStr);
            const absenceEntry = absenceMap.get(dayStr);
            const vacation = vacationEntry?.vacation;
            const absence = absenceEntry?.absence;
            const isPendingVacation = vacationEntry?.isPending ?? false;

            const cellClass = [
              "calendar-cell",
              hasWorked ? "worked" : "",
              hasOpenSession ? "open" : "",
              isHoliday ? "holiday" : "",
              vacation ? (isPendingVacation ? "vacation-pending" : "vacation") : "",
              absence ? "absence" : ""
            ]
              .filter(Boolean)
              .join(" ");

            const labelParts: string[] = [];
            if (isHoliday) labelParts.push(t.holiday!);
            if (vacation) labelParts.push(isPendingVacation ? t.vacationPending! : t.vacation!);
            if (absence) labelParts.push(t.absence!);
            if (hasWorked) labelParts.push(formatHours(dayData.workedMinutes));
            if (hasOpenSession) labelParts.push(t.openSession!);
            const ariaParts = labelParts.length > 0 ? labelParts.join(", ") : t.empty!;

            return (
              <div
                key={dayStr}
                className={cellClass}
                role="gridcell"
                aria-label={`${date.format(new Date(`${dayStr}T12:00:00`))}: ${ariaParts}`}
                onClick={(e) => handleCellClick(dayStr, e)}
                style={{ cursor: "pointer" }}
              >
                <span className="calendar-day-number">{dayNum}</span>
                <div className="calendar-day-content">
                  {isHoliday && <span className="calendar-day-label">{t.holiday}</span>}
                  {vacation && (
                    <span className="calendar-day-label">{isPendingVacation ? t.vacationPending : t.vacation}</span>
                  )}
                  {absence && <span className="calendar-day-label">{t.absence}</span>}
                  {hasWorked && (
                    <>
                      <span className="calendar-hours">{formatHours(dayData.workedMinutes)}</span>
                      {dayData.sessions.length > 0 && (
                        <span className="calendar-session-range">
                          {time.format(new Date(dayData.sessions[0]!.startedAt))}
                          {dayData.sessions[0]!.endedAt && `–${time.format(new Date(dayData.sessions[0]!.endedAt))}`}
                        </span>
                      )}
                    </>
                  )}
                  {hasOpenSession && (
                    <span className="calendar-status" aria-label={t.openSession}>
                      <AlertTriangle size={10} aria-hidden="true" />
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {popover && (
        <div
          ref={popoverRef}
          className="calendar-popover"
          style={{ position: "fixed", left: popover.x, top: popover.y, transform: "translateX(-50%)", zIndex: 1000 }}
        >
          <div className="calendar-popover-header">
            <span>{date.format(new Date(`${popover.dayStr}T12:00:00`))}</span>
            <button className="icon-button" onClick={() => setPopover(null)} aria-label={t.cancel}>
              <X size={14} />
            </button>
          </div>
          {(() => {
            const vacationEntry = vacationMap.get(popover.dayStr);
            const absenceEntry = absenceMap.get(popover.dayStr);
            const vacation = vacationEntry?.vacation;
            const absence = absenceEntry?.absence;
            const isPendingVacation = vacationEntry?.isPending ?? false;
            const holiday = holidayDates.has(popover.dayStr);

            if (vacation) {
              return (
                <div className="calendar-popover-content">
                  <span className="calendar-popover-label">{isPendingVacation ? t.vacationPending : t.vacation}</span>
                  <button
                    className="secondary-button danger"
                    onClick={() => {
                      onCancelVacation(vacation.id);
                      setPopover(null);
                    }}
                  >
                    {t.cancelVacation}
                  </button>
                </div>
              );
            }
            if (absence) {
              return (
                <div className="calendar-popover-content">
                  <span className="calendar-popover-label">{t.absence}</span>
                  <button
                    className="secondary-button danger"
                    onClick={() => {
                      onCancelAbsence(absence.id);
                      setPopover(null);
                    }}
                  >
                    {t.cancelAbsence}
                  </button>
                </div>
              );
            }
            if (holiday) {
              return (
                <div className="calendar-popover-content">
                  <span className="calendar-popover-label">{t.holiday}</span>
                </div>
              );
            }
            return (
              <div className="calendar-popover-actions">
                <button
                  className="secondary-button"
                  onClick={() => {
                    onVacationClick(popover.dayStr);
                    setPopover(null);
                  }}
                >
                  <Plane size={14} aria-hidden="true" />
                  {t.vacation}
                </button>
                <button
                  className="secondary-button"
                  onClick={() => {
                    onAbsenceClick(popover.dayStr);
                    setPopover(null);
                  }}
                >
                  <FileText size={14} aria-hidden="true" />
                  {t.absence}
                </button>
              </div>
            );
          })()}
        </div>
      )}
    </section>
  );
}

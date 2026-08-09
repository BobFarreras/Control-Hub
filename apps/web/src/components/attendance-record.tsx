"use client";

import { AlertTriangle, Clock, PencilLine, Plane, FileText } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useEffect, type FormEvent } from "react";
import { MetricTile } from "@/components/metric-tile";
import { useToast } from "@/components/toast";
import type { AttendanceEvent, AttendanceMonth, AttendanceHoliday, AttendanceVacation, AttendanceAbsence } from "@/lib/api-types";
import { formValue } from "@/lib/form";
import { formatHours } from "@/lib/format";

type Labels = Record<string, string>;

const ANNUAL_VACATION_DAYS = 28;

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

function daysBetween(start: string, end: string): number {
  const s = new Date(start + "T12:00:00");
  const e = new Date(end + "T12:00:00");
  return Math.round((e.getTime() - s.getTime()) / 86_400_000) + 1;
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
  const [busy, setBusy] = useState(false);

  const [holidays, setHolidays] = useState<AttendanceHoliday[]>([]);
  const [vacations, setVacations] = useState<AttendanceVacation[]>([]);
  const [absences, setAbsences] = useState<AttendanceAbsence[]>([]);

  const superseded = supersededIds(month.events);
  const time = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" });
  const date = new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short" });

  useEffect(() => {
    if (view !== "calendar" || month.days.length === 0) return;
    const from = month.days[0]!.day;
    const to = month.days[month.days.length - 1]!.day;
    const params = `from=${from}&to=${to}&membershipId=${month.membershipId}`;

    void Promise.all([
      fetch(`/api/v1/attendance/holidays?${params}`).then((r) => (r.ok ? r.json() : { holidays: [] })),
      fetch(`/api/v1/attendance/vacations?${params}`).then((r) => (r.ok ? r.json() : { vacations: [] })),
      fetch(`/api/v1/attendance/absences?${params}`).then((r) => (r.ok ? r.json() : { absences: [] }))
    ]).then(([h, v, a]) => {
      setHolidays(h.holidays ?? []);
      setVacations(v.vacations ?? []);
      setAbsences(a.absences ?? []);
    });
  }, [view, month.days, month.membershipId]);

  const vacationDaysTaken = vacations
    .filter((v) => v.status === "approved")
    .reduce((sum, v) => sum + daysBetween(v.startDate, v.endDate), 0);
  const vacationDaysLeft = ANNUAL_VACATION_DAYS - vacationDaysTaken;

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
    router.refresh();
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
    router.refresh();
  }

  return (
    <>
      <section className="metric-row" aria-label={t.total}>
        <MetricTile label={t.total!} icon={Clock} value={formatHours(month.totalMinutes)} />
      </section>

      {view === "calendar" && (
        <div className="attendance-calendar-summary">
          <span className="member-name">{month.memberName}</span>
          <span className="total-hours">{formatHours(month.totalMinutes)} {t.thisMonth}</span>
          <span className="vacation-days-left">
            {t.vacationDaysLeft}: <strong>{vacationDaysLeft}</strong> / {ANNUAL_VACATION_DAYS}
          </span>
          <div className="request-buttons">
            <button
              className="secondary-button"
              onClick={() => setShowVacationForm(true)}
              aria-label={t.requestVacation}
            >
              <Plane size={14} aria-hidden="true" />
              {t.vacation}
            </button>
            <button
              className="secondary-button"
              onClick={() => setShowAbsenceForm(true)}
              aria-label={t.requestAbsence}
            >
              <FileText size={14} aria-hidden="true" />
              {t.absence}
            </button>
          </div>
        </div>
      )}

      {view === "calendar" ? (
        <CalendarView
          month={month}
          labels={t}
          locale={locale}
          time={time}
          date={date}
          superseded={superseded}
          holidays={holidays}
          vacations={vacations}
          absences={absences}
        />
      ) : (
        <TableView month={month} labels={t} locale={locale} time={time} date={date} superseded={superseded} />
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
                <input name="startDate" type="date" required disabled={busy} />
              </label>
              <label>
                {t.vacationEnd}
                <input name="endDate" type="date" required disabled={busy} />
              </label>
              <label className="full-width">
                {t.notes}
                <input name="notes" maxLength={1000} disabled={busy} />
              </label>
              <div className="dialog-actions">
                <button type="button" className="secondary-button" disabled={busy} onClick={() => setShowVacationForm(false)}>
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
                <input name="startDate" type="date" required disabled={busy} />
              </label>
              <label>
                {t.absenceEnd}
                <input name="endDate" type="date" required disabled={busy} />
              </label>
              <label className="full-width">
                {t.notes}
                <input name="notes" maxLength={1000} disabled={busy} />
              </label>
              <div className="dialog-actions">
                <button type="button" className="secondary-button" disabled={busy} onClick={() => setShowAbsenceForm(false)}>
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
  locale,
  time,
  date,
  superseded
}: {
  month: AttendanceMonth;
  labels: Labels;
  locale: string;
  time: Intl.DateTimeFormat;
  date: Intl.DateTimeFormat;
  superseded: Set<string>;
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
  locale,
  time,
  date,
  superseded,
  holidays,
  vacations,
  absences
}: {
  month: AttendanceMonth;
  labels: Labels;
  locale: string;
  time: Intl.DateTimeFormat;
  date: Intl.DateTimeFormat;
  superseded: Set<string>;
  holidays: AttendanceHoliday[];
  vacations: AttendanceVacation[];
  absences: AttendanceAbsence[];
}) {
  const firstDay = month.days[0]?.day ?? new Date().toISOString().slice(0, 10);
  const parts = firstDay.split("-");
  const year = parseInt(parts[0] ?? "0", 10);
  const monthNum = parseInt(parts[1] ?? "1", 10);
  const daysInMonth = new Date(year, monthNum, 0).getDate();
  // getDay(): 0=Sun,1=Mon,...6=Sat. Shift so Monday=0.
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
  const vacationDates = new Set<string>();
  for (const v of vacations) {
    if (v.status !== "approved") continue;
    const start = new Date(v.startDate + "T12:00:00");
    const end = new Date(v.endDate + "T12:00:00");
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const ds = d.toISOString().slice(0, 10);
      if (ds >= v.startDate && ds <= v.endDate) vacationDates.add(ds);
    }
  }
  const absenceDates = new Map<string, string>();
  for (const a of absences) {
    const start = new Date(a.startDate + "T12:00:00");
    const end = new Date(a.endDate + "T12:00:00");
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const ds = d.toISOString().slice(0, 10);
      if (ds >= a.startDate && ds <= a.endDate) absenceDates.set(ds, a.type);
    }
  }

  const dayNames = [t.monday, t.tuesday, t.wednesday, t.thursday, t.friday, t.saturday, t.sunday];

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
            const isVacation = vacationDates.has(dayStr);
            const absenceType = absenceDates.get(dayStr);

            const cellClass = [
              "calendar-cell",
              hasWorked ? "worked" : "",
              hasOpenSession ? "open" : "",
              isHoliday ? "holiday" : "",
              isVacation ? "vacation" : "",
              absenceType ? "absence" : ""
            ].filter(Boolean).join(" ");

            const labelParts: string[] = [];
            if (isHoliday) labelParts.push(t.holiday!);
            if (isVacation) labelParts.push(t.vacation!);
            if (absenceType) labelParts.push(t.absence!);
            if (hasWorked) labelParts.push(formatHours(dayData!.workedMinutes));
            if (hasOpenSession) labelParts.push(t.openSession!);
            const ariaParts = labelParts.length > 0 ? labelParts.join(", ") : t.empty!;

            return (
              <div
                key={dayStr}
                className={cellClass}
                role="gridcell"
                aria-label={`${date.format(new Date(`${dayStr}T12:00:00`))}: ${ariaParts}`}
              >
                <span className="calendar-day-number">{dayNum}</span>
                <div className="calendar-day-content">
                  {isHoliday && <span className="calendar-day-label">{t.holiday}</span>}
                  {isVacation && <span className="calendar-day-label">{t.vacation}</span>}
                  {absenceType && <span className="calendar-day-label">{t.absence}</span>}
                  {hasWorked && (
                    <>
                      <span className="calendar-hours">{formatHours(dayData!.workedMinutes)}</span>
                      {dayData!.sessions.length > 0 && (
                        <span className="calendar-session-range">
                          {time.format(new Date(dayData!.sessions[0]!.startedAt))}
                          {dayData!.sessions[0]!.endedAt && `–${time.format(new Date(dayData!.sessions[0]!.endedAt))}`}
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
    </section>
  );
}

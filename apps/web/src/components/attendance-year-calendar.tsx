"use client";

import { AlertTriangle, CalendarDays, ChevronLeft, ChevronRight, Clock3, Plane, Stethoscope } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { SelectField } from "@/components/form-field";
import { useToast } from "@/components/toast";
import type { AttendanceAbsence, AttendanceHoliday, AttendanceMonth, AttendanceVacation } from "@/lib/api-types";
import { formValue } from "@/lib/form";

type Labels = Record<string, string>;

function datesBetween(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  const current = new Date(`${startDate}T12:00:00Z`);
  const end = new Date(`${endDate}T12:00:00Z`);
  while (current <= end) {
    dates.push(current.toISOString().slice(0, 10));
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return dates;
}

export function AttendanceYearCalendar({
  year,
  month,
  holidays,
  vacations,
  absences,
  labels: t,
  locale
}: {
  year: number;
  month: AttendanceMonth;
  holidays: AttendanceHoliday[];
  vacations: AttendanceVacation[];
  absences: AttendanceAbsence[];
  labels: Labels;
  locale: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [request, setRequest] = useState<"vacation" | "absence" | null>(null);
  const [selection, setSelection] = useState<{ start: string; end?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const worked = new Map(month.days.map((day) => [day.day, day]));
  const holiday = new Map(holidays.map((item) => [item.date, item]));
  const vacation = new Map<string, AttendanceVacation>();
  const absence = new Map<string, AttendanceAbsence>();
  for (const item of vacations) {
    if (item.status === "rejected") continue;
    for (const date of datesBetween(item.startDate, item.endDate)) vacation.set(date, item);
  }
  for (const item of absences) {
    if (item.status === "rejected") continue;
    for (const date of datesBetween(item.startDate, item.endDate)) absence.set(date, item);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!request) return;
    const data = new FormData(event.currentTarget);
    const isVacation = request === "vacation";
    setBusy(true);
    const response = await fetch(`/api/v1/attendance/${isVacation ? "vacations" : "absences"}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        membershipId: month.membershipId,
        startDate: formValue(data, "startDate"),
        endDate: formValue(data, "endDate"),
        ...(isVacation ? {} : { type: formValue(data, "type") }),
        notes: formValue(data, "notes") || undefined
      })
    });
    setBusy(false);
    if (!response.ok) return toast("error", t.failed!);
    toast("success", isVacation ? t.vacationRequested! : t.absenceRequested!);
    setRequest(null);
    setSelection(null);
    router.refresh();
  }

  const weekdays = [t.monday!, t.tuesday!, t.wednesday!, t.thursday!, t.friday!, t.saturday!, t.sunday!];
  const selectedFrom = selection?.start ?? "";
  const selectedTo = selection?.end ?? selection?.start ?? "";

  function selectDay(date: string) {
    setSelection((current) => {
      if (!current || current.end) return { start: date };
      return date < current.start ? { start: date, end: current.start } : { start: current.start, end: date };
    });
  }

  return (
    <div className="attendance-year-layout">
      <aside className="attendance-year-aside" aria-label={t.legend}>
        <section>
          <h2>{month.memberName}</h2>
          <p>
            {t.showingYear}: {year}
          </p>
        </section>
        <section>
          <h3>{t.legend}</h3>
          <ul className="attendance-legend">
            <li>
              <span className="legend-mark worked">
                <Clock3 size={15} />
              </span>
              {t.workedDay}
            </li>
            <li>
              <span className="legend-mark vacation">
                <Plane size={15} />
              </span>
              {t.vacation}
            </li>
            <li>
              <span className="legend-mark pending">
                <CalendarDays size={15} />
              </span>
              {t.vacationPending}
            </li>
            <li>
              <span className="legend-mark absence">
                <Stethoscope size={15} />
              </span>
              {t.absence}
            </li>
            <li>
              <span className="legend-mark holiday">
                <CalendarDays size={15} />
              </span>
              {t.holiday}
            </li>
            <li>
              <span className="legend-mark open">
                <AlertTriangle size={15} />
              </span>
              {t.openDay}
            </li>
          </ul>
        </section>
        <div className="attendance-request-actions">
          <p className="attendance-selection-summary" aria-live="polite">
            {selection ? `${t.selectedRange}: ${selectedFrom} — ${selectedTo}` : t.selectDays}
          </p>
          <button className="primary-button" disabled={!month.membershipId} onClick={() => setRequest("vacation")}>
            <Plane size={16} />
            {t.requestVacation}
          </button>
          <button className="secondary-button" disabled={!month.membershipId} onClick={() => setRequest("absence")}>
            <Stethoscope size={16} />
            {t.requestAbsence}
          </button>
        </div>
      </aside>

      <section className="attendance-year-panel" aria-label={t.calendarTitle}>
        <header className="attendance-year-toolbar">
          <p>
            {t.showingYear}: <strong>{year}</strong>
          </p>
          <div className="attendance-year-selector">
            <Link
              className="icon-button"
              href={`/${locale}/attendance/calendar?year=${year - 1}`}
              aria-label={t.yearPrevious}
              title={t.yearPrevious}
            >
              <ChevronLeft size={18} />
            </Link>
            <strong>{year}</strong>
            <Link
              className="icon-button"
              href={`/${locale}/attendance/calendar?year=${year + 1}`}
              aria-label={t.yearNext}
              title={t.yearNext}
            >
              <ChevronRight size={18} />
            </Link>
          </div>
        </header>
        <div className="attendance-year-grid">
          {Array.from({ length: 12 }, (_, monthIndex) => {
            const first = new Date(Date.UTC(year, monthIndex, 1));
            const days = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
            const offset = (first.getUTCDay() + 6) % 7;
            const title = new Intl.DateTimeFormat(locale, { month: "long" }).format(first);
            return (
              <section className="attendance-mini-month" key={monthIndex} aria-label={`${title} ${year}`}>
                <h3>{title}</h3>
                <div className="attendance-mini-weekdays" aria-hidden="true">
                  {weekdays.map((day) => (
                    <span key={day}>{day.slice(0, 1)}</span>
                  ))}
                </div>
                <div className="attendance-mini-days">
                  {Array.from({ length: offset }, (_, index) => (
                    <span key={`empty-${index}`} />
                  ))}
                  {Array.from({ length: days }, (_, index) => {
                    const day = index + 1;
                    const date = `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
                    const work = worked.get(date);
                    const holidayItem = holiday.get(date);
                    const vacationItem = vacation.get(date);
                    const absenceItem = absence.get(date);
                    const isSelected = Boolean(selection && date >= selectedFrom && date <= selectedTo);
                    const states = [
                      work?.workedMinutes ? t.workedDay : null,
                      work?.hasOpenSession ? t.openDay : null,
                      holidayItem ? `${t.holiday}: ${holidayItem.name}` : null,
                      vacationItem ? (vacationItem.status === "pending" ? t.vacationPending : t.vacation) : null,
                      absenceItem
                        ? absenceItem.status === "pending"
                          ? t.absencePending
                          : absenceItem.status === "approved"
                            ? t.absence
                            : null
                        : null,
                      isSelected ? t.selectedDay : null
                    ].filter(Boolean);
                    const className = [
                      "attendance-mini-day",
                      work?.workedMinutes ? "worked" : "",
                      work?.hasOpenSession ? "open" : "",
                      holidayItem ? "holiday" : "",
                      vacationItem ? (vacationItem.status === "pending" ? "pending" : "vacation") : "",
                      absenceItem?.status === "approved" ? "absence" : "",
                      absenceItem?.status === "pending" ? "pending" : "",
                      isSelected ? "selected" : ""
                    ]
                      .filter(Boolean)
                      .join(" ");
                    return (
                      <button
                        type="button"
                        key={date}
                        className={className}
                        aria-pressed={isSelected}
                        aria-label={`${date}: ${states.join(", ") || t.empty}`}
                        onClick={() => selectDay(date)}
                      >
                        {day}
                      </button>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      </section>

      {request && (
        <div className="dialog-backdrop" role="presentation">
          <section
            className="crm-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={request === "vacation" ? t.requestVacation : t.requestAbsence}
          >
            <header>
              <h2>{request === "vacation" ? t.requestVacation : t.requestAbsence}</h2>
            </header>
            <form className="commerce-form" onSubmit={(event) => void submit(event)}>
              {request === "absence" && (
                <SelectField
                  name="type"
                  label={t.absenceType!}
                  required
                  disabled={busy}
                  defaultValue="sick_leave"
                  options={[
                    { value: "sick_leave", label: t.absenceSick! },
                    { value: "personal_leave", label: t.absencePersonal! },
                    { value: "other", label: t.absenceOther! }
                  ]}
                />
              )}
              <label>
                {t.from}
                <input name="startDate" type="date" required disabled={busy} defaultValue={selectedFrom} />
              </label>
              <label>
                {t.to}
                <input name="endDate" type="date" required disabled={busy} defaultValue={selectedTo} />
              </label>
              <label className="full-width">
                {t.notes}
                <input name="notes" maxLength={1000} disabled={busy} />
              </label>
              <div className="dialog-actions">
                <button type="button" className="secondary-button" disabled={busy} onClick={() => setRequest(null)}>
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
    </div>
  );
}

"use client";

import { AlertTriangle, ArrowRight, CalendarDays, Clock3, Plane, Stethoscope } from "lucide-react";
import Link from "next/link";
import { ClockButton } from "@/components/clock-button";
import type { AttendanceAbsence, AttendanceHoliday, AttendanceMonth, AttendanceVacation } from "@/lib/api-types";
import { formatHours } from "@/lib/format";

type Labels = Record<string, string>;

export function AttendanceOverview({
  month,
  holidays,
  vacations,
  absences,
  labels: t,
  locale,
  today
}: {
  month: AttendanceMonth;
  holidays: AttendanceHoliday[];
  vacations: AttendanceVacation[];
  absences: AttendanceAbsence[];
  labels: Labels;
  locale: string;
  today: string;
}) {
  const todayRecord = month.days.find((day) => day.day === today);
  const upcoming = [
    ...holidays.map((item) => ({ date: item.date, label: item.name, tone: "holiday" })),
    ...vacations
      .filter((item) => item.status === "approved")
      .map((item) => ({
        date: item.startDate,
        label: t.vacation!,
        tone: "vacation"
      })),
    ...absences
      .filter((item) => item.status === "approved")
      .map((item) => ({ date: item.startDate, label: t.absence!, tone: "absence" }))
  ]
    .filter((item) => item.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 5);
  const date = new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short" });
  const pending = [
    ...vacations.filter((item) => item.status === "pending").map((item) => ({ ...item, label: t.vacationPending! })),
    ...absences.filter((item) => item.status === "pending").map((item) => ({ ...item, label: t.absencePending! }))
  ].sort((a, b) => a.startDate.localeCompare(b.startDate));

  return (
    <div className="attendance-overview-grid">
      <section className="attendance-overview-clock" aria-label={t.today}>
        <header>
          <div>
            <span>{t.today}</span>
            <h2>{month.memberName}</h2>
          </div>
          <Clock3 size={22} />
        </header>
        <strong className="attendance-today-total">{formatHours(todayRecord?.workedMinutes ?? 0)}</strong>
        <p>{t.todayWorked}</p>
        {todayRecord?.hasOpenSession && (
          <span className="metric-todo">
            <AlertTriangle size={14} />
            {t.openSession}
          </span>
        )}
        <ClockButton />
      </section>

      <section className="attendance-overview-schedule" aria-label={t.nextDays}>
        <header>
          <div>
            <span>{t.monthWorked}</span>
            <strong>{formatHours(month.totalMinutes)}</strong>
          </div>
          <Link href={`/${locale}/attendance/calendar`} className="icon-button" aria-label={t.calendar}>
            <ArrowRight size={17} />
          </Link>
        </header>
        <h2>{t.nextDays}</h2>
        {upcoming.length ? (
          <ul>
            {upcoming.map((item) => (
              <li key={`${item.tone}-${item.date}`}>
                <span className={`overview-event-icon ${item.tone}`}>
                  {item.tone === "holiday" ? (
                    <CalendarDays size={16} />
                  ) : item.tone === "vacation" ? (
                    <Plane size={16} />
                  ) : (
                    <Stethoscope size={16} />
                  )}
                </span>
                <span>
                  <strong>{item.label}</strong>
                  <small>{date.format(new Date(`${item.date}T12:00:00`))}</small>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="empty-copy">{t.noUpcomingEvents}</p>
        )}
      </section>

      <section className="attendance-overview-requests" aria-label={t.personalRequests}>
        <header>
          <div>
            <span>{t.personalRequests}</span>
            <h2>
              {pending.length} {t.pendingRequests!.toLowerCase()}
            </h2>
          </div>
          <Plane size={22} />
        </header>
        {pending.length ? (
          <ul>
            {pending.slice(0, 3).map((item) => (
              <li key={item.id}>
                <span>{date.format(new Date(`${item.startDate}T12:00:00`))}</span>
                <strong>
                  {item.label}:{" "}
                  {item.startDate === item.endDate ? item.startDate : `${item.startDate} — ${item.endDate}`}
                </strong>
              </li>
            ))}
          </ul>
        ) : (
          <p className="empty-copy">{t.noRequests}</p>
        )}
        <Link className="secondary-button" href={`/${locale}/attendance/calendar`}>
          {t.calendar}
          <ArrowRight size={16} />
        </Link>
      </section>

      <section className="attendance-overview-history" aria-label={t.dailyRecords}>
        <header>
          <div>
            <span>{t.dailyRecords}</span>
            <h2>
              {month.days.length} {t.results}
            </h2>
          </div>
          <Link href={`/${locale}/attendance/records`} className="icon-button" aria-label={t.records}>
            <ArrowRight size={17} />
          </Link>
        </header>
        <div className="attendance-overview-days">
          {month.days
            .slice(-7)
            .reverse()
            .map((day) => (
              <div key={day.day}>
                <span>{date.format(new Date(`${day.day}T12:00:00`))}</span>
                <strong>{formatHours(day.workedMinutes)}</strong>
                {day.hasOpenSession && <AlertTriangle size={14} aria-label={t.openSession} />}
              </div>
            ))}
          {!month.days.length && <p className="empty-copy">{t.empty}</p>}
        </div>
      </section>
    </div>
  );
}

"use client";

import { AlertTriangle, PencilLine } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { AttendanceMonthNavigation } from "@/components/attendance-month-navigation";
import { SmartDataTable, type SmartColumn } from "@/components/smart-data-table";
import type { AttendanceDay, AttendanceEvent, AttendanceMonth, TablePreference } from "@/lib/api-types";
import { formatHours } from "@/lib/format";

type Labels = Record<string, string>;
type DayRow = AttendanceDay & { id: string; sessions: AttendanceMonth["sessions"] };

const preference = (tableId: string): TablePreference => ({
  tableId,
  columnOrder: [],
  hiddenColumns: [],
  columnWidths: {},
  pageSize: 10
});

const numberParam = (value: string | null, fallback: number) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

export function AttendanceTables({
  month,
  range,
  labels: t,
  locale,
  onCorrect
}: {
  month: AttendanceMonth;
  range: { from: string; to: string; month: string };
  labels: Labels;
  locale: string;
  onCorrect: (event: AttendanceEvent) => void;
}) {
  const params = useSearchParams();
  const date = new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short" });
  const dateTime = new Intl.DateTimeFormat(locale, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  });
  const time = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" });
  const tableLabels = {
    sort: t.sort!,
    columns: t.columns!,
    visibility: t.visibility!,
    narrower: t.narrower!,
    wider: t.wider!,
    moveUp: t.moveUp!,
    moveDown: t.moveDown!,
    filter: t.filter!,
    all: t.all!,
    results: t.results!,
    rows: t.rows!,
    previous: t.previous!,
    nextPage: t.nextPage!
  };

  const daySort = params.get("daySort") ?? "date_desc";
  const dayStatus = params.get("dayStatus");
  const dayPage = numberParam(params.get("dayPage"), 1);
  const daySize = numberParam(params.get("daySize"), 10) as TablePreference["pageSize"];
  let days: DayRow[] = month.days.map((day) => ({
    ...day,
    id: day.day,
    sessions: month.sessions.filter((session) => session.day === day.day)
  }));
  if (dayStatus === "open") days = days.filter((day) => day.hasOpenSession);
  if (dayStatus === "closed") days = days.filter((day) => !day.hasOpenSession);
  days.sort((a, b) => (daySort === "date_asc" ? a.day.localeCompare(b.day) : b.day.localeCompare(a.day)));
  const dayTotal = days.length;
  days = days.slice((dayPage - 1) * daySize, dayPage * daySize);

  const dayColumns: SmartColumn<DayRow>[] = [
    {
      id: "day",
      label: t.day!,
      locked: true,
      width: 180,
      sort: { asc: "date_asc", desc: "date_desc" },
      render: (row) => date.format(new Date(`${row.day}T12:00:00`))
    },
    {
      id: "sessions",
      label: t.sessions!,
      width: 220,
      render: (row) => (
        <span className="attendance-times">
          {row.sessions.map((session) => (
            <span key={session.startedAt}>
              {time.format(new Date(session.startedAt))}–
              {session.endedAt ? time.format(new Date(session.endedAt)) : t.openSession}
            </span>
          ))}
        </span>
      )
    },
    { id: "worked", label: t.worked!, width: 140, render: (row) => formatHours(row.workedMinutes) },
    {
      id: "status",
      label: t.status!,
      width: 160,
      filter: {
        parameter: "dayStatus",
        options: [
          { value: "closed", label: t.closed! },
          { value: "open", label: t.openSession! }
        ]
      },
      render: (row) =>
        row.hasOpenSession ? (
          <span className="metric-todo">
            <AlertTriangle size={13} aria-hidden="true" />
            {t.openSession}
          </span>
        ) : (
          t.closed
        )
    }
  ];

  const superseded = new Set(month.events.map((event) => event.correctsEventId).filter(Boolean));
  const eventSort = params.get("eventSort") ?? "occurred_desc";
  const eventKind = params.get("eventKind");
  const eventPage = numberParam(params.get("eventPage"), 1);
  const eventSize = numberParam(params.get("eventSize"), 10) as TablePreference["pageSize"];
  let events = eventKind ? month.events.filter((event) => event.kind === eventKind) : [...month.events];
  events.sort((a, b) =>
    eventSort === "occurred_asc" ? a.occurredAt.localeCompare(b.occurredAt) : b.occurredAt.localeCompare(a.occurredAt)
  );
  const eventTotal = events.length;
  events = events.slice((eventPage - 1) * eventSize, eventPage * eventSize);
  const eventColumns: SmartColumn<AttendanceEvent>[] = [
    {
      id: "occurredAt",
      label: t.at!,
      locked: true,
      width: 210,
      sort: { asc: "occurred_asc", desc: "occurred_desc" },
      render: (row) => dateTime.format(new Date(row.occurredAt))
    },
    {
      id: "kind",
      label: t.kind!,
      width: 170,
      filter: {
        parameter: "eventKind",
        options: ["clock_in", "clock_out", "pause_start", "pause_end"].map((value) => ({
          value,
          label:
            t[
              value === "clock_in"
                ? "clockIn"
                : value === "clock_out"
                  ? "clockOut"
                  : value === "pause_start"
                    ? "pauseStart"
                    : "pauseEnd"
            ]!
        }))
      },
      render: (row) =>
        t[
          row.kind === "clock_in"
            ? "clockIn"
            : row.kind === "clock_out"
              ? "clockOut"
              : row.kind === "pause_start"
                ? "pauseStart"
                : "pauseEnd"
        ]
    },
    { id: "reason", label: t.reason!, width: 280, render: (row) => row.reason || "—" },
    {
      id: "state",
      label: t.status!,
      width: 140,
      render: (row) => (superseded.has(row.id) ? t.corrected : row.correctsEventId ? t.declared : t.original)
    },
    {
      id: "actions",
      label: t.actions!,
      width: 90,
      render: (row) =>
        superseded.has(row.id) ? null : (
          <button className="icon-button" aria-label={t.correct} onClick={() => onCorrect(row)}>
            <PencilLine size={16} />
          </button>
        )
    }
  ];

  return (
    <div className="attendance-table-stack">
      <section className="project-panel" aria-label={t.dailyRecords}>
        <SmartDataTable
          tableId="attendance.days"
          rows={days}
          columns={dayColumns}
          preference={preference("attendance.days")}
          total={dayTotal}
          page={dayPage}
          pageSize={daySize}
          pageParam="dayPage"
          pageSizeParam="daySize"
          sortParam="daySort"
          sort={daySort}
          sortOptions={[
            { value: "date_desc", label: t.newest! },
            { value: "date_asc", label: t.oldest! }
          ]}
          empty={t.empty!}
          labels={tableLabels}
          primaryControls={
            <div className="attendance-table-heading">
              <h3>{t.dailyRecords}</h3>
              <AttendanceMonthNavigation
                month={range.month}
                locale={locale}
                href={(monthValue) => `/${locale}/attendance/records?month=${monthValue}`}
                previousLabel={t.monthPrevious!}
                nextLabel={t.monthNext!}
              />
            </div>
          }
        />
      </section>
      <section className="project-panel" aria-label={t.history}>
        <SmartDataTable
          tableId="attendance.events"
          rows={events}
          columns={eventColumns}
          preference={preference("attendance.events")}
          total={eventTotal}
          page={eventPage}
          pageSize={eventSize}
          pageParam="eventPage"
          pageSizeParam="eventSize"
          sortParam="eventSort"
          sort={eventSort}
          sortOptions={[
            { value: "occurred_desc", label: t.newest! },
            { value: "occurred_asc", label: t.oldest! }
          ]}
          empty={t.empty!}
          labels={tableLabels}
          primaryControls={<h3 className="attendance-table-title">{t.history}</h3>}
        />
      </section>
    </div>
  );
}

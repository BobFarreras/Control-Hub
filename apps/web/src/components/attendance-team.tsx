"use client";

import ExcelJS from "exceljs";
import { Clock, Download, Receipt, TrendingUp, Users } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { AttendanceMonthNavigation } from "@/components/attendance-month-navigation";
import { MetricTile } from "@/components/metric-tile";
import { SmartDataTable, type SmartColumn } from "@/components/smart-data-table";
import type { AttendanceTeamRow, TablePreference } from "@/lib/api-types";
import { formatHours } from "@/lib/format";

type Labels = Record<string, string>;

/** `HH:MM` in the reader's own zone, which is the one the times were counted in. */
function clock(value: string | null, locale: string): string {
  return value ? new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(new Date(value)) : "";
}

/** Abbreviated weekday name from an ISO date string. */
function weekday(isoDate: string, locale: string): string {
  const date = new Date(isoDate + "T12:00:00");
  return new Intl.DateTimeFormat(locale, { weekday: "short" }).format(date);
}

/**
 * Everybody's hours, and what they were billed to.
 *
 * The tiles come first because three numbers are what somebody actually wants from this screen:
 * how much was worked, how much reached a customer, and the gap between them. The table under
 * them is where that gets taken apart, and the export is where it leaves the building.
 */
export function AttendanceTeam({
  rows,
  range,
  reconciled,
  labels: t,
  locale
}: {
  rows: AttendanceTeamRow[];
  range: { from: string; to: string; month: string };
  /** False when the caller may read the record but not what it costs. */
  reconciled: boolean;
  labels: Labels;
  locale: string;
}) {
  const recorded = rows.reduce((total, row) => total + row.totalMinutes, 0);
  const logged = rows.reduce((total, row) => total + (row.loggedMinutes ?? 0), 0);
  const corrections = rows.reduce((total, row) => total + row.declaredEntries, 0);
  const params = useSearchParams();
  const sort = params.get("teamSort") ?? "recorded_desc";
  const status = params.get("teamStatus");
  const page = Math.max(1, Number(params.get("teamPage")) || 1);
  const pageSize = (Number(params.get("teamSize")) || 10) as TablePreference["pageSize"];
  let tableRows = rows.map((row) => ({ ...row, id: row.membershipId }));
  if (status === "corrected") tableRows = tableRows.filter((row) => row.declaredEntries > 0);
  if (status === "unbilled") tableRows = tableRows.filter((row) => (row.unbilledMinutes ?? 0) !== 0);
  tableRows.sort((a, b) => {
    if (sort === "name_asc") return a.memberName.localeCompare(b.memberName, locale);
    if (sort === "name_desc") return b.memberName.localeCompare(a.memberName, locale);
    return sort === "recorded_asc" ? a.totalMinutes - b.totalMinutes : b.totalMinutes - a.totalMinutes;
  });
  const tableTotal = tableRows.length;
  tableRows = tableRows.slice((page - 1) * pageSize, page * pageSize);
  type TeamTableRow = (typeof tableRows)[number];
  const columns: SmartColumn<TeamTableRow>[] = [
    {
      id: "person",
      label: t.person!,
      locked: true,
      width: 220,
      sort: { asc: "name_asc", desc: "name_desc" },
      render: (row) => row.memberName
    },
    {
      id: "recorded",
      label: t.recorded!,
      width: 150,
      sort: { asc: "recorded_asc", desc: "recorded_desc" },
      render: (row) => formatHours(row.totalMinutes)
    },
    ...(reconciled
      ? [
          {
            id: "logged",
            label: t.logged!,
            width: 150,
            render: (row: TeamTableRow) => formatHours(row.loggedMinutes ?? 0)
          }
        ]
      : []),
    ...(reconciled
      ? [
          {
            id: "unbilled",
            label: t.unbilled!,
            width: 160,
            filter: {
              parameter: "teamStatus",
              options: [
                { value: "unbilled", label: t.withDifference! },
                { value: "corrected", label: t.withCorrections! }
              ]
            },
            render: (row: TeamTableRow) => {
              const value = row.unbilledMinutes ?? 0;
              return (
                <span className={value < 0 ? "metric-value negative" : undefined}>
                  {value < 0 ? "-" : ""}
                  {formatHours(Math.abs(value))}
                </span>
              );
            }
          }
        ]
      : []),
    { id: "corrections", label: t.declaredEntries!, width: 140, render: (row) => row.declaredEntries || "—" }
  ];
  const tablePreference: TablePreference = {
    tableId: "attendance.team",
    columnOrder: [],
    hiddenColumns: [],
    columnWidths: {},
    pageSize: 10
  };
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

  async function download() {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet(t.exportName);

    // Column definitions with widths
    sheet.columns = [
      { header: t.person!, key: "person", width: 20 },
      { header: t.day!, key: "day", width: 14 },
      { header: t.exportWeekday!, key: "weekday", width: 8 },
      { header: t.entry!, key: "entry", width: 10 },
      { header: t.exit!, key: "exit", width: 10 },
      { header: t.exportDuration!, key: "duration", width: 12 },
      { header: t.declaredEntries!, key: "corrections", width: 14 }
    ];

    // Style header row
    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
    headerRow.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF6B38D4" }
    };
    headerRow.alignment = { horizontal: "center" };
    headerRow.border = {
      bottom: { style: "thin", color: { argb: "FF000000" } }
    };

    let rowIndex = 2;

    for (const row of rows) {
      for (const session of row.sessions) {
        const hours = session.workedMinutes != null ? session.workedMinutes / 60 : null;
        sheet.addRow({
          person: row.memberName,
          day: session.day,
          weekday: weekday(session.day, locale),
          entry: clock(session.startedAt, locale),
          exit: clock(session.endedAt, locale),
          duration: hours,
          corrections: row.declaredEntries
        });

        // Format the duration cell as number with 2 decimals
        const dataRow = sheet.getRow(rowIndex);
        dataRow.getCell("duration").numFmt = "0.00";
        dataRow.alignment = { horizontal: "center" };
        dataRow.getCell("weekday").alignment = { horizontal: "center" };
        dataRow.getCell("corrections").alignment = { horizontal: "center" };

        // Alternate row colors
        if (rowIndex % 2 === 0) {
          dataRow.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "FFF5F2EE" }
          };
        }

        rowIndex++;
      }

      // Summary row per person
      if (row.sessions.length > 0) {
        const totalHours = row.totalMinutes / 60;
        const summaryRow = sheet.addRow({
          person: row.memberName,
          day: "",
          weekday: "",
          entry: "",
          exit: t.exportTotal!,
          duration: totalHours,
          corrections: ""
        });

        summaryRow.font = { bold: true };
        summaryRow.getCell("duration").numFmt = "0.00";
        summaryRow.alignment = { horizontal: "center" };
        summaryRow.border = {
          top: { style: "thin", color: { argb: "FF000000" } }
        };

        rowIndex++;
      }
    }

    // Auto-filter
    sheet.autoFilter = {
      from: "A1",
      to: "G1"
    };

    // Generate buffer and download
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${t.exportName}-${range.from}-${range.to}.xlsx`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <section className="attendance-team-summary" aria-label={t.teamTitle}>
        <div className="metric-row">
          <MetricTile label={t.teamTotal!} icon={Clock} value={formatHours(recorded)} />
          {reconciled && <MetricTile label={t.teamLogged!} icon={Receipt} value={formatHours(logged)} />}
          {reconciled && (
            <MetricTile
              label={t.teamUnbilled!}
              help={t.unbilledHelp}
              icon={TrendingUp}
              value={`${recorded - logged < 0 ? "-" : ""}${formatHours(Math.abs(recorded - logged))}`}
              tone={recorded - logged < 0 ? "negative" : undefined}
            />
          )}
          <MetricTile
            label={t.people!}
            icon={Users}
            value={rows.length}
            footnote={corrections > 0 ? `${corrections} ${t.declaredEntries!.toLowerCase()}` : undefined}
          />
        </div>
        <AttendanceMonthNavigation
          month={range.month}
          locale={locale}
          href={(monthValue) => `/${locale}/attendance/team?month=${monthValue}`}
          previousLabel={t.monthPrevious!}
          nextLabel={t.monthNext!}
        />
      </section>

      <section className="project-panel" aria-label={t.teamTitle}>
        <header className="panel-head">
          <h3>{t.teamTitle}</h3>
          <button
            className="secondary-button"
            onClick={() => void download()}
            disabled={rows.length === 0}
            title={t.exportHelp}
          >
            <Download size={16} aria-hidden="true" />
            {t.exportCsv}
          </button>
        </header>

        {!reconciled && <p className="dialog-note">{t.noReconciliation}</p>}

        <SmartDataTable
          tableId="attendance.team"
          rows={tableRows}
          columns={columns}
          preference={tablePreference}
          total={tableTotal}
          page={page}
          pageSize={pageSize}
          pageParam="teamPage"
          pageSizeParam="teamSize"
          sortParam="teamSort"
          sort={sort}
          sortOptions={[
            { value: "recorded_desc", label: t.mostHours! },
            { value: "recorded_asc", label: t.leastHours! },
            { value: "name_asc", label: t.nameAsc! },
            { value: "name_desc", label: t.nameDesc! }
          ]}
          empty={t.empty!}
          labels={tableLabels}
        />
      </section>
    </>
  );
}

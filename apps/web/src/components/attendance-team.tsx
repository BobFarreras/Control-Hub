"use client";

import { Clock, Download, Receipt, TrendingUp, Users } from "lucide-react";
import ExcelJS from "exceljs";
import { MetricTile } from "@/components/metric-tile";
import type { AttendanceTeamRow } from "@/lib/api-types";
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
  range: { from: string; to: string };
  /** False when the caller may read the record but not what it costs. */
  reconciled: boolean;
  labels: Labels;
  locale: string;
}) {
  const recorded = rows.reduce((total, row) => total + row.totalMinutes, 0);
  const logged = rows.reduce((total, row) => total + (row.loggedMinutes ?? 0), 0);
  const corrections = rows.reduce((total, row) => total + row.declaredEntries, 0);

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
      <section className="metric-row" aria-label={t.teamTitle}>
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
          // On the tile, not buried in a column: whether a period was touched after the fact is
          // the first thing somebody checking a record wants to know.
          footnote={corrections > 0 ? `${corrections} ${t.declaredEntries!.toLowerCase()}` : undefined}
        />
      </section>

      <section className="project-panel" aria-label={t.teamTitle}>
        <header className="panel-head">
          <h3>{t.teamTitle}</h3>
          <button className="secondary-button" onClick={download} disabled={rows.length === 0} title={t.exportHelp}>
            <Download size={16} aria-hidden="true" />
            {t.exportCsv}
          </button>
        </header>

        {!reconciled && <p className="dialog-note">{t.noReconciliation}</p>}

        <div className="crm-table-wrap inside-panel">
          <table className="crm-table">
            <thead>
              <tr>
                <th>{t.person}</th>
                <th>{t.recorded}</th>
                {reconciled && <th>{t.logged}</th>}
                {reconciled && <th>{t.unbilled}</th>}
                <th>{t.declaredEntries}</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={reconciled ? 5 : 3}>{t.empty}</td>
                </tr>
              )}
              {rows.map((row) => {
                const unbilled = row.unbilledMinutes ?? 0;
                return (
                  <tr key={row.membershipId}>
                    <td>{row.memberName}</td>
                    <td>{formatHours(row.totalMinutes)}</td>
                    {reconciled && <td>{formatHours(row.loggedMinutes ?? 0)}</td>}
                    {reconciled && (
                      /*
                        Never merged with the hours worked, and never hidden when negative: more
                        logged than clocked is the one signal that says a record is wrong.
                      */
                      <td className={unbilled < 0 ? "metric-value negative" : undefined}>
                        {unbilled < 0 ? "-" : ""}
                        {formatHours(Math.abs(unbilled))}
                      </td>
                    )}
                    <td>{row.declaredEntries > 0 ? row.declaredEntries : ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

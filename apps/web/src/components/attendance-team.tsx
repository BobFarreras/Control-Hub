"use client";

import { Clock, Download, Receipt, TrendingUp, Users } from "lucide-react";
import { MetricTile } from "@/components/metric-tile";
import type { AttendanceTeamRow } from "@/lib/api-types";
import { formatHours } from "@/lib/format";

type Labels = Record<string, string>;

/** Doubled quotes and wrapped: the whole of CSV escaping, and the whole of what a name needs. */
function csvCell(value: string | number): string {
  return `"${String(value).replaceAll('"', '""')}"`;
}

/** `HH:MM` in the reader's own zone, which is the one the times were counted in. */
function clock(value: string | null, locale: string): string {
  return value ? new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(new Date(value)) : "";
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

  /**
   * One row per person and day, with the time in and the time out, which is what the
   * specification asks the export to be. A column of monthly totals is not a record anybody can
   * check: it is the conclusion with the evidence left out.
   *
   * Built from what is already on screen rather than from a second endpoint, so what lands in the
   * spreadsheet is exactly what the person who sent it was looking at.
   */
  function download() {
    const header = [t.person!, t.day!, t.entry!, t.exit!, t.minutes!, t.declaredEntries!];
    const lines = [header.map(csvCell).join(",")];

    for (const row of rows) {
      for (const session of row.sessions) {
        lines.push(
          [
            csvCell(row.memberName),
            csvCell(session.day),
            csvCell(clock(session.startedAt, locale)),
            csvCell(clock(session.endedAt, locale)),
            // Minutes as a number, not as "7 h 30 min": this column is going to be added up by a
            // spreadsheet, and a figure it has to parse out of prose is one it will parse wrong.
            session.workedMinutes ?? "",
            row.declaredEntries
          ].join(",")
        );
      }
      // Somebody with nothing recorded still gets a line, so an absence reads as an absence
      // rather than as a person the export forgot.
      if (row.sessions.length === 0) lines.push([csvCell(row.memberName), "", "", "", 0, 0].join(","));
    }

    // A byte order mark, written as an escape rather than as an invisible character: Excel needs
    // it to open accented names as accented names, and a reader has to see that it is there.
    const blob = new Blob([`\uFEFF${lines.join("\r\n")}\r\n`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${t.exportName}-${range.from}-${range.to}.csv`;
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

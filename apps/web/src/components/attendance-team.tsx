"use client";

import { Download } from "lucide-react";
import { MetricHelp } from "@/components/metric-help";
import type { AttendanceTeamRow } from "@/lib/api-types";
import { formatHours } from "@/lib/format";

type Labels = Record<string, string>;

/** Doubled quotes and wrapped, which is the whole of CSV escaping and the whole of what we need. */
function csvCell(value: string | number): string {
  return `"${String(value).replaceAll('"', '""')}"`;
}

/**
 * Everybody's hours, and what they were billed to.
 *
 * The export is built from the rows already on screen rather than from a second endpoint, so what
 * lands in the accountancy's spreadsheet is exactly what the person who sent it was looking at.
 * A separate export query is how the two quietly stop agreeing.
 *
 * Minutes go out as minutes, not as "7 h 30 min": the file is going into a spreadsheet, and a
 * column somebody has to parse back out of prose is a column they will parse wrong.
 */
export function AttendanceTeam({
  rows,
  range,
  reconciled,
  labels: t
}: {
  rows: AttendanceTeamRow[];
  range: { from: string; to: string };
  /** False when the caller may read the record but not what it costs. */
  reconciled: boolean;
  labels: Labels;
}) {
  function download() {
    const header = [t.person!, t.recorded!, ...(reconciled ? [t.logged!, t.unbilled!] : [])];
    const lines = [
      header.map(csvCell).join(","),
      ...rows.map((row) =>
        [
          csvCell(row.memberName),
          row.totalMinutes,
          ...(reconciled ? [row.loggedMinutes ?? 0, row.unbilledMinutes ?? 0] : [])
        ].join(",")
      )
    ];
    // A byte order mark, written as an escape rather than as an invisible character: Excel needs
    // it to open accented names as accented names instead of mojibake, and a reader of this file
    // needs to be able to see that it is there.
    const blob = new Blob([`\uFEFF${lines.join("\r\n")}\r\n`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${t.exportName}-${range.from}-${range.to}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="project-panel" aria-label={t.teamTitle}>
      <header className="panel-head">
        <h3>{t.teamTitle}</h3>
        <button className="secondary-button" onClick={download} disabled={rows.length === 0}>
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
              {reconciled && (
                <th>
                  <MetricHelp label={t.unbilled!} description={t.unbilledHelp!} />
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={reconciled ? 4 : 2}>{t.empty}</td>
              </tr>
            )}
            {rows.map((row) => (
              <tr key={row.membershipId}>
                <td>{row.memberName}</td>
                <td>{formatHours(row.totalMinutes)}</td>
                {reconciled && <td>{formatHours(row.loggedMinutes ?? 0)}</td>}
                {reconciled && (
                  /*
                    Never merged with the hours worked, and never hidden when negative: more logged
                    than clocked is the one signal that says one of the two records is wrong.
                  */
                  <td className={(row.unbilledMinutes ?? 0) < 0 ? "metric-value negative" : undefined}>
                    {(row.unbilledMinutes ?? 0) < 0 ? "-" : ""}
                    {formatHours(Math.abs(row.unbilledMinutes ?? 0))}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

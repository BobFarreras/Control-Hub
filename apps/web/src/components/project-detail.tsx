"use client";

import { AlertTriangle, Clock, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { formatHours } from "@/components/projects-workspace";
import type { Profitability, ProjectDetail as ProjectDetailData, TimeEntry } from "@/lib/api-types";
import { formValue, optionalFormValue } from "@/lib/form";
import { actionHandler, eventHandler } from "@/lib/handlers";

type Labels = Record<string, string>;

const statuses = ["draft", "active", "on_hold", "delivered", "closed", "canceled"] as const;

/** The states that take no new hours. Kept in step with `acceptsTimeEntries` in the domain. */
const closedStatuses = ["closed", "canceled"];

const today = () => new Date().toISOString().slice(0, 10);

/** Minor units as money, with the currency the amount is actually in and never a mixed total. */
function formatMoney(minor: number, currency: string, locale: string): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(minor / 100);
}

export function ProjectDetail({
  detail,
  entries,
  profitability,
  labels: t,
  locale
}: {
  detail: ProjectDetailData;
  entries: TimeEntry[];
  profitability: Profitability | null;
  labels: Labels;
  locale: string;
}) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const fail = () => setError(t.formError ?? "OPERATION_FAILED");

  const { project, events } = detail;
  const acceptsHours = !closedStatuses.includes(project.status);

  async function send(path: string, body: unknown, method: "PATCH" | "POST" | "DELETE") {
    setBusy(true);
    setError("");
    const response = await fetch(path, {
      method,
      ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
    });
    setBusy(false);
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { code?: string } | null;
      const known: Record<string, string | undefined> = {
        INVALID_DURATION: t.invalidDuration,
        FUTURE_DATE: t.futureDate,
        PROJECT_CLOSED: t.projectClosed
      };
      setError(known[payload?.code ?? ""] ?? t.formError ?? "");
      return false;
    }
    router.refresh();
    return true;
  }

  async function log(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const saved = await send(
      "/api/v1/time-entries",
      {
        projectId: project.id,
        duration: formValue(data, "duration"),
        spentOn: formValue(data, "spentOn"),
        billable: data.get("billable") === "on",
        ...(optionalFormValue(data, "note") ? { note: optionalFormValue(data, "note") } : {})
      },
      "POST"
    );
    if (saved) form.reset();
  }

  return (
    <>
      {error && (
        <p className="crm-error">
          <AlertTriangle size={17} />
          {error}
        </p>
      )}

      <section className="ticket-summary">
        <div>
          <span className="ticket-reference">{project.code}</span>
          <h2>{project.name}</h2>
          <p className="muted">{project.customerName}</p>
          {project.description && <p>{project.description}</p>}
        </div>
        <div className="ticket-controls">
          <label>
            {t.changeStatus}
            <select
              value={project.status}
              disabled={busy}
              onChange={actionHandler(
                (event: React.ChangeEvent<HTMLSelectElement>) =>
                  send(`/api/v1/projects/${project.id}/status`, { status: event.target.value }, "PATCH"),
                fail
              )}
            >
              <option value={project.status}>{t[project.status]}</option>
              {statuses
                .filter((status) => status !== project.status)
                .map((status) => (
                  <option value={status} key={status}>
                    {t[status]}
                  </option>
                ))}
            </select>
          </label>
          <p className="sla-remaining">
            <Clock size={15} aria-hidden="true" />
            {t.logged}: {formatHours(project.loggedMinutes)}
          </p>
        </div>
      </section>

      <div className="project-sections">
        {/* Absent, not hidden: without financials:read the numbers never left the server. */}
        {profitability && (
          <section aria-label={t.profitability}>
            <h3>{t.profitability}</h3>
            <p className="project-figures">
              <span>
                {t.hours}: {formatHours(profitability.minutes)}
              </span>
              <span>
                {t.billableHours}: {formatHours(profitability.billableMinutes)}
              </span>
            </p>
            {profitability.lines.length === 0 ? (
              <p className="crm-empty">{t.noProfitability}</p>
            ) : (
              <div className="crm-table-wrap">
                <table className="crm-table project-money">
                  <thead>
                    <tr>
                      <th>{t.currency}</th>
                      <th>{t.revenue}</th>
                      <th>{t.cost}</th>
                      <th>{t.margin}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {profitability.lines.map((line) => (
                      <tr key={line.currency}>
                        <th scope="row">{line.currency}</th>
                        <td>{formatMoney(line.revenueMinor, line.currency, locale)}</td>
                        <td>{formatMoney(line.costMinor, line.currency, locale)}</td>
                        <td className={line.marginMinor < 0 ? "negative" : undefined}>
                          {formatMoney(line.marginMinor, line.currency, locale)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {(profitability.entriesWithoutCostRate > 0 || profitability.entriesWithoutBillingRate > 0) && (
              <p className="crm-error">
                <AlertTriangle size={17} aria-hidden="true" />
                <span>
                  {profitability.entriesWithoutCostRate > 0 &&
                    `${profitability.entriesWithoutCostRate} ${t.missingCostRate}. `}
                  {profitability.entriesWithoutBillingRate > 0 &&
                    `${profitability.entriesWithoutBillingRate} ${t.missingBillingRate}. `}
                  {t.missingRateHelp}
                </span>
              </p>
            )}
          </section>
        )}

        <section aria-label={t.logTime}>
          <h3>{t.logTime}</h3>
          <form className="commerce-form" onSubmit={eventHandler(log, fail)}>
            <label>
              {t.duration}
              <input
                name="duration"
                required
                maxLength={20}
                placeholder="1h 30m"
                aria-describedby="duration-help"
                disabled={busy || !acceptsHours}
              />
              <small id="duration-help">{t.durationHelp}</small>
            </label>
            <label>
              {t.spentOn}
              {/* Today by default and never later: the entry is a record of work already done. */}
              <input
                name="spentOn"
                type="date"
                required
                defaultValue={today()}
                max={today()}
                disabled={busy || !acceptsHours}
              />
            </label>
            <label className="checkbox-label">
              <input name="billable" type="checkbox" defaultChecked disabled={busy || !acceptsHours} />
              {t.billable}
            </label>
            <label className="full-width">
              {t.note}
              <input name="note" maxLength={500} disabled={busy || !acceptsHours} />
            </label>
            <button className="primary-button" disabled={busy || !acceptsHours}>
              {t.save}
            </button>
            {!acceptsHours && <p className="form-error">{t.projectClosed}</p>}
          </form>
        </section>

        <section aria-label={t.entries}>
          <h3>{t.entries}</h3>
          <div className="crm-table-wrap">
            <table className="crm-table">
              <thead>
                <tr>
                  <th>{t.spentOn}</th>
                  <th>{t.member}</th>
                  <th>{t.duration}</th>
                  <th>{t.billable}</th>
                  <th>{t.note}</th>
                  <th>{t.delete}</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id}>
                    <td>
                      <time dateTime={entry.spentOn}>{entry.spentOn}</time>
                    </td>
                    <td>{entry.memberName}</td>
                    <td>{formatHours(entry.minutes)}</td>
                    <td>{entry.billable ? t.billable : "—"}</td>
                    <td>{entry.note}</td>
                    <td>
                      <button
                        className="icon-button"
                        disabled={busy}
                        // Named by what it removes: "delete" alone, read out of a table, gives
                        // no way to tell which row is about to disappear.
                        aria-label={`${t.deleteEntry}: ${entry.spentOn}, ${formatHours(entry.minutes)}`}
                        onClick={actionHandler(
                          () => send(`/api/v1/time-entries/${entry.id}`, undefined, "DELETE"),
                          fail
                        )}
                      >
                        <Trash2 size={15} aria-hidden="true" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {entries.length === 0 && <p className="crm-empty">{t.noEntries}</p>}
          </div>
        </section>

        <section aria-label={t.history}>
          <h3>{t.history}</h3>
          <ol className="ticket-thread project-history">
            {events.map((event) => (
              <li className="ticket-message" key={event.id}>
                <header>
                  <strong>{event.type === "created" ? t.created : t.statusChanged}</strong>
                  <span>
                    {event.fromValue ? `${t[event.fromValue] ?? event.fromValue} → ` : ""}
                    {event.toValue ? (t[event.toValue] ?? event.toValue) : ""}
                  </span>
                  <time dateTime={event.createdAt}>{new Date(event.createdAt).toLocaleString(locale)}</time>
                </header>
                {event.reason && <p>{event.reason}</p>}
                {event.actorName && <p className="muted">{event.actorName}</p>}
              </li>
            ))}
          </ol>
        </section>
      </div>
    </>
  );
}

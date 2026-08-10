"use client";

import {
  AlertTriangle,
  CalendarClock,
  Clock,
  Coins,
  History,
  Receipt,
  Timer,
  TrendingUp,
  Trash2,
  Wallet
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";
import { SelectField, TextField, ToggleField } from "@/components/form-field";
import { HelpTip } from "@/components/help";
import { MetricTile } from "@/components/metric-tile";
import { projectStatusTone, StatusPill } from "@/components/status-pill";
import type { Profitability, ProjectDetail as ProjectDetailData, ServiceType, TimeEntry } from "@/lib/api-types";
import { formValue, optionalFormValue } from "@/lib/form";
import { formatHours, formatMoney } from "@/lib/format";
import { actionHandler, eventHandler } from "@/lib/handlers";

type Labels = Record<string, string>;

const statuses = ["draft", "active", "on_hold", "delivered", "closed", "canceled"] as const;

/** The states that take no new hours. Kept in step with `acceptsTimeEntries` in the domain. */
const closedStatuses = ["closed", "canceled"];

const today = () => new Date().toISOString().slice(0, 10);

/** The currency line to lead with. One is the normal case; more than one is a report, not a tile. */
const leadLine = (report: Profitability) => report.lines[0];

/**
 * How long is left on the due date, which is what somebody reads a due date for.
 *
 * Counted in whole days from midnight so that "tomorrow" does not become "in 0 days" late in the
 * afternoon, and an overdue project says so in words rather than as a negative number.
 */
function dueFootnote(dueAt: string | null, t: Labels): ReactNode {
  if (!dueAt) return undefined;
  const midnight = (value: Date) => Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate());
  const days = Math.round((midnight(new Date(dueAt)) - midnight(new Date())) / 86_400_000);
  if (days < 0) return <span className="metric-todo">{`${Math.abs(days)} ${t.daysOverdue}`}</span>;
  if (days === 0) return t.dueToday;
  return `${days} ${t.daysLeft}`;
}

export function ProjectDetail({
  detail,
  entries,
  profitability,
  serviceTypes,
  labels: t,
  locale
}: {
  detail: ProjectDetailData;
  entries: TimeEntry[];
  profitability: Profitability | null;
  serviceTypes: ServiceType[];
  labels: Labels;
  locale: string;
}) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const fail = () => setError(t.formError ?? "OPERATION_FAILED");

  const { project, events } = detail;
  const acceptsHours = !closedStatuses.includes(project.status);
  const lead = profitability ? leadLine(profitability) : undefined;
  const missingRates = profitability
    ? profitability.entriesWithoutCostRate + profitability.entriesWithoutBillingRate
    : 0;

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
    if (saved) {
      form.reset();
      // Back to the duration: logging two stretches in a row is the common case, and reaching for
      // the mouse between them is what makes a daily habit stop being daily.
      form.querySelector<HTMLInputElement>("input[name=duration]")?.focus();
    }
  }

  return (
    <div className="project-detail">
      {error && (
        <p className="notice notice-danger" role="alert">
          <AlertTriangle size={17} aria-hidden="true" />
          {error}
        </p>
      )}

      {/*
        The identity strip: what this is, the facts somebody asks for next, and the control that
        changes its state. The facts column exists because the strip was two thirds empty space,
        and an operational screen that leaves a third of its widest row blank is wasting the most
        valuable part of the page.
      */}
      {/* Named by its own heading rather than by a label of its own: two regions called the same
          thing are as confusing to a screen reader as they were to the test that picked the wrong
          one. The figures below keep the name "Resum"; this one is the project itself. */}
      <section className="project-identity" aria-labelledby="project-identity-heading">
        <div className="project-identity-name">
          <span className="project-code">{project.code}</span>
          <h2 id="project-identity-heading">{project.name}</h2>
          <p className="project-customer">{project.customerName}</p>
          {project.description && <p className="project-description">{project.description}</p>}
        </div>
        <dl className="project-facts">
          <div>
            <dt>{t.owner}</dt>
            <dd>{project.ownerName ?? <span className="muted">{t.unassigned}</span>}</dd>
          </div>
          <div>
            <dt>{t.started}</dt>
            <dd>
              {project.startedAt ? (
                <time dateTime={project.startedAt}>{new Date(project.startedAt).toLocaleDateString(locale)}</time>
              ) : (
                <span className="muted">{t.notStarted}</span>
              )}
            </dd>
          </div>
          <div>
            <dt>{t.serviceType}</dt>
            <dd>
              <SelectField
                label={t.serviceType!}
                labelHidden
                value={project.serviceTypeId ?? ""}
                disabled={busy || serviceTypes.length === 0}
                onChange={actionHandler(
                  (event: React.ChangeEvent<HTMLSelectElement>) =>
                    send(
                      `/api/v1/projects/${project.id}/service-type`,
                      { serviceTypeId: event.target.value || null },
                      "PATCH"
                    ),
                  fail
                )}
                // Deactivated kinds are out of the list, except the one this project already has:
                // hiding it would leave the select showing a value it does not offer.
                options={[
                  { value: "", label: t.serviceTypeNone ?? "—" },
                  ...serviceTypes
                    .filter((type) => type.active || type.id === project.serviceTypeId)
                    .map((type) => ({ value: type.id, label: type.name }))
                ]}
              />
            </dd>
          </div>
          <div>
            <dt>{t.entries}</dt>
            <dd>{entries.length}</dd>
          </div>
          <div>
            <dt>{t.created}</dt>
            <dd>
              <time dateTime={project.createdAt}>{new Date(project.createdAt).toLocaleDateString(locale)}</time>
            </dd>
          </div>
        </dl>
        <div className="project-identity-controls">
          <StatusPill
            tone={projectStatusTone[project.status] ?? "neutral"}
            label={t[project.status] ?? project.status}
          />
          <SelectField
            label={t.statusOf!}
            value={project.status}
            disabled={busy}
            onChange={actionHandler(
              (event: React.ChangeEvent<HTMLSelectElement>) =>
                send(`/api/v1/projects/${project.id}/status`, { status: event.target.value }, "PATCH"),
              fail
            )}
            options={statuses.map((status) => ({ value: status, label: t[status] ?? status }))}
          />
        </div>
      </section>

      <section className="metric-row" aria-label={t.overview}>
        <MetricTile
          label={t.totalHours!}
          help={t.loggedHelp}
          icon={Clock}
          value={formatHours(project.loggedMinutes)}
          {...(profitability ? { footnote: `${t.billablePart}: ${formatHours(profitability.billableMinutes)}` } : {})}
        />
        <MetricTile
          label={t.due!}
          icon={CalendarClock}
          value={
            project.dueAt ? (
              <time dateTime={project.dueAt}>{new Date(project.dueAt).toLocaleDateString(locale)}</time>
            ) : (
              <span className="metric-absent">{t.noDueDate}</span>
            )
          }
          // Days remaining, not the start date: the start is already a fact in the strip above,
          // and what somebody reads a due date for is how long is left.
          footnote={dueFootnote(project.dueAt, t)}
        />
        {/*
          Absent, not hidden: without `financials:read` these figures never left the server.
          And with no rate published there is nothing to price, so the tiles are left out rather
          than shown as three dashes: the notice underneath already says why, and three empty
          tiles read as a broken screen instead of an unconfigured one.
        */}
        {profitability && lead && (
          <>
            <MetricTile
              label={t.revenue!}
              help={t.revenueHelp}
              icon={Receipt}
              value={formatMoney(lead.revenueMinor, lead.currency, locale)}
            />
            <MetricTile
              label={t.cost!}
              help={t.costHelp}
              icon={Wallet}
              value={formatMoney(lead.costMinor, lead.currency, locale)}
            />
            <MetricTile
              label={t.margin!}
              help={t.marginHelp}
              icon={TrendingUp}
              value={formatMoney(lead.marginMinor, lead.currency, locale)}
              tone={lead.marginMinor < 0 ? "negative" : "positive"}
              footnote={
                // A partially priced margin has to say so on the number itself. Read without this
                // it looks complete, and it is the one figure somebody will quote to a customer.
                missingRates > 0 ? (
                  <span className="metric-todo">
                    <AlertTriangle size={13} aria-hidden="true" />
                    {missingRates} {t.entriesUnpriced}
                  </span>
                ) : profitability.lines.length > 1 ? (
                  t.perCurrency
                ) : undefined
              }
            />
          </>
        )}
        {/*
          No rate published, so the tile says what is missing instead of a figure, and says it
          where the figure would have been. It used to be a page-wide banner wedged between two
          sections, which read as a failure and belonged to nothing: this is a setup step, and it
          belongs next to the number it is holding up.
        */}
        {profitability && !lead && (
          <MetricTile
            label={t.margin!}
            // The full explanation lives in the help bubble, reachable by hover and by focus: why
            // there is no figure, and why an absent rate is not priced as zero.
            help={`${t.marginHelp} ${t.missingRateHelp}`}
            icon={TrendingUp}
            value={<span className="metric-absent">{t.noRatesYet}</span>}
            footnote={
              missingRates > 0 ? (
                <span className="metric-todo">
                  <AlertTriangle size={13} aria-hidden="true" />
                  {t.ratesNeeded}
                </span>
              ) : undefined
            }
          />
        )}
      </section>

      {profitability && profitability.lines.length > 1 && (
        <section className="project-panel" aria-label={t.perCurrency}>
          <h3>{t.perCurrency}</h3>
          <div className="crm-table-wrap inside-panel">
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
        </section>
      )}

      {/* The form people use several times a day, so it is one row and keeps focus after saving. */}
      <section className="project-panel" aria-label={t.quickLog}>
        <div className="panel-row">
          <h3>
            <Timer size={17} aria-hidden="true" />
            {t.quickLog}
            <HelpTip label={t.quickLog!} description={t.logHelp!} />
          </h3>
          <form className="quick-log" onSubmit={eventHandler(log, fail)}>
            <TextField
              label={t.duration!}
              name="duration"
              required
              maxLength={20}
              placeholder={t.durationPlaceholder}
              hint={t.durationHelp}
              data-mono="true"
              autoComplete="off"
              disabled={busy || !acceptsHours}
            />
            <TextField
              label={t.spentOn!}
              name="spentOn"
              type="date"
              required
              defaultValue={today()}
              max={today()}
              data-mono="true"
              disabled={busy || !acceptsHours}
            />
            <TextField
              label={t.note!}
              name="note"
              maxLength={500}
              placeholder={t.notePlaceholder}
              autoComplete="off"
              disabled={busy || !acceptsHours}
            />
            <ToggleField label={t.billable!} name="billable" defaultChecked disabled={busy || !acceptsHours} />
            <button className="primary-button" disabled={busy || !acceptsHours}>
              {t.save}
            </button>
          </form>
        </div>
        {!acceptsHours && (
          <p className="notice notice-warning" role="status">
            <AlertTriangle size={17} aria-hidden="true" />
            {t.projectClosed}
          </p>
        )}
      </section>

      <section className="project-panel" aria-label={t.entries}>
        <header className="project-panel-heading">
          <h3>
            <Coins size={17} aria-hidden="true" />
            {t.lastEntries}
          </h3>
          {entries.length > 0 && (
            <p>
              {t.total}: <strong>{formatHours(entries.reduce((sum, entry) => sum + entry.minutes, 0))}</strong>
            </p>
          )}
        </header>
        {entries.length === 0 ? (
          <p className="crm-empty">{t.noEntries}</p>
        ) : (
          <ul className="entry-list">
            {entries.map((entry) => (
              <li key={entry.id}>
                <time dateTime={entry.spentOn}>{entry.spentOn}</time>
                <strong className="entry-duration">{formatHours(entry.minutes)}</strong>
                <span className="entry-member">{entry.memberName}</span>
                <span className="entry-note">{entry.note}</span>
                {entry.billable ? (
                  <span className="entry-billable">{t.billable}</span>
                ) : (
                  <span className="entry-billable muted">—</span>
                )}
                <button
                  className="icon-button"
                  disabled={busy}
                  // Named by what it removes: "delete" alone, read out of a list, gives no way to
                  // tell which entry is about to disappear.
                  aria-label={`${t.deleteEntry}: ${entry.spentOn}, ${formatHours(entry.minutes)}`}
                  onClick={actionHandler(() => send(`/api/v1/time-entries/${entry.id}`, undefined, "DELETE"), fail)}
                >
                  <Trash2 size={15} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="project-panel" aria-label={t.history}>
        <header className="project-panel-heading">
          <h3>
            <History size={17} aria-hidden="true" />
            {t.history}
          </h3>
        </header>
        <ol className="timeline">
          {events.map((event) => (
            <li key={event.id}>
              <div className="timeline-mark" aria-hidden="true" />
              <div className="timeline-body">
                <p className="timeline-title">
                  {event.type === "created" ? t.created : t.statusChanged}
                  {event.toValue && (
                    <StatusPill
                      tone={projectStatusTone[event.toValue] ?? "neutral"}
                      label={t[event.toValue] ?? event.toValue}
                    />
                  )}
                </p>
                {event.reason && <p className="timeline-reason">{event.reason}</p>}
                <p className="timeline-meta">
                  <time dateTime={event.createdAt}>{new Date(event.createdAt).toLocaleString(locale)}</time>
                  {event.actorName && <span>{event.actorName}</span>}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

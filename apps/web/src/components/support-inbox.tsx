"use client";

import { AlertTriangle, Clock, Info, Pause, Plus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { SmartDataTable, type SmartColumn } from "@/components/smart-data-table";
import type { CustomerOption, InboxSlaDetail, InboxTicket, TablePreference } from "@/lib/api-types";
import { formValue, optionalFormValue } from "@/lib/form";
import { eventHandler } from "@/lib/handlers";

type Labels = Record<string, string>;

/**
 * Working minutes as something a person reads at a glance.
 *
 * The inbox answers "how long have I got", not "at what instant does this expire", so the
 * remaining time leads and the absolute moment goes in the title for whoever is planning.
 */
function formatRemaining(minutes: number): string {
  const whole = Math.max(0, Math.round(minutes));
  const hours = Math.floor(whole / 60);
  if (hours === 0) return `${whole} min`;
  const rest = whole % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

/**
 * Formats a date as a relative time string (e.g. "2 h", "30 min").
 * Falls back to the absolute date if the browser does not support Intl.RelativeTimeFormat.
 */
function formatRelative(iso: string, locale: string): string {
  const date = new Date(iso);
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffMin = Math.round(diffMs / 60_000);

  if (Math.abs(diffMin) < 1) return "ara";

  try {
    const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
    if (Math.abs(diffMin) < 60) return rtf.format(-diffMin, "minute");
    const diffH = Math.round(diffMin / 60);
    if (Math.abs(diffH) < 24) return rtf.format(-diffH, "hour");
    const diffD = Math.round(diffH / 24);
    return rtf.format(-diffD, "day");
  } catch {
    return date.toLocaleDateString(locale);
  }
}

/**
 * The active SLA detail for a ticket row: first response until answered, resolution afterwards.
 */
function activeInboxSla(ticket: InboxTicket): InboxSlaDetail {
  return ticket.firstResponseAt ? ticket.inboxSla.resolution : ticket.inboxSla.firstResponse;
}

// ---------------------------------------------------------------------------
// SLA status badge
// ---------------------------------------------------------------------------

const slaStatusClasses: Record<string, string> = {
  on_time: "sla-on-time",
  near: "sla-near",
  breached: "sla-breached",
  paused: "sla-paused",
  not_configured: "sla-unknown"
};

function SlaStatusBadge({ sla, labels: t, onClick }: { sla: InboxSlaDetail; labels: Labels; onClick: () => void }) {
  const className = slaStatusClasses[sla.status] ?? "sla-unknown";
  const statusKey = `slaStatus_${sla.status}` as string;
  const label = t[statusKey] ?? sla.status;
  const icon =
    sla.status === "breached" ? (
      <AlertTriangle size={14} aria-hidden="true" />
    ) : sla.status === "paused" ? (
      <Pause size={14} aria-hidden="true" />
    ) : sla.status === "not_configured" ? null : (
      <Clock size={14} aria-hidden="true" />
    );

  return (
    <button
      type="button"
      className={`sla-badge ${className}`}
      onClick={(event) => {
        event.stopPropagation();
        event.preventDefault();
        onClick();
      }}
      title={t.slaDetailTitle}
    >
      {icon}
      {label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// SLA detail dialog
// ---------------------------------------------------------------------------

function SlaDetailDialog({ ticket, labels: t, onClose }: { ticket: InboxTicket; labels: Labels; onClose: () => void }) {
  const { inboxSla } = ticket;
  const fr = inboxSla.firstResponse;
  const rs = inboxSla.resolution;

  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="crm-dialog sla-detail-dialog" role="dialog" aria-modal="true">
        <header>
          <h2>{t.slaDetailTitle}</h2>
          <button className="icon-button" onClick={onClose} aria-label={t.cancel}>
            <X size={18} />
          </button>
        </header>
        <div className="sla-detail-body">
          <SlaTargetSection
            target={fr}
            label={t.targetFirstResponse!}
            stageLabel={t.firstResponsePending!}
            labels={t}
          />
          <SlaTargetSection target={rs} label={t.targetResolution!} stageLabel={t.resolutionPending!} labels={t} />
        </div>
      </section>
    </div>
  );
}

function SlaTargetSection({
  target,
  label,
  stageLabel,
  labels: t
}: {
  target: InboxSlaDetail;
  label: string;
  stageLabel: string;
  labels: Labels;
}) {
  const statusKey = `slaStatus_${target.status}` as string;
  const statusLabel = t[statusKey] ?? target.status;

  return (
    <div className="sla-detail-section">
      <h3>{label}</h3>
      <dl>
        <dt>{t.status}</dt>
        <dd>{stageLabel}</dd>

        <dt>{t.columnSlaStatus}</dt>
        <dd>{statusLabel}</dd>

        <dt>{t.slaDetailTarget}</dt>
        <dd>{formatRemaining(target.targetMinutes)}</dd>

        <dt>{t.slaDetailConsumed}</dt>
        <dd>{formatRemaining(target.consumedMinutes)}</dd>

        <dt>{t.slaDetailRemaining}</dt>
        <dd>{target.status === "breached" ? "\u2014" : formatRemaining(target.remainingMinutes)}</dd>

        {target.status === "not_configured" && (
          <>
            <dt>{t.slaDetailNoSchedule}</dt>
            <dd>\u2014</dd>
          </>
        )}

        {target.status === "paused" && (
          <>
            <dt>{t.slaDetailPaused}</dt>
            <dd>\u2014</dd>
          </>
        )}

        {target.estimatedDeadline && (
          <>
            <dt>{t.slaDetailDeadline}</dt>
            <dd>{new Date(target.estimatedDeadline).toLocaleString()}</dd>
          </>
        )}
      </dl>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function SupportInbox({
  tickets,
  preference,
  customers,
  labels: t,
  locale,
  loadError,
  sort
}: {
  tickets: { items: InboxTicket[]; total: number; page: number; pageSize: TablePreference["pageSize"] };
  preference: TablePreference;
  customers: CustomerOption[];
  labels: Labels;
  locale: string;
  loadError: boolean;
  sort: string;
}) {
  const router = useRouter();
  const [dialog, setDialog] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [slaDetailTicket, setSlaDetailTicket] = useState<InboxTicket | null>(null);
  const fail = () => setError(t.formError ?? "OPERATION_FAILED");

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const data = new FormData(event.currentTarget);
    const response = await fetch("/api/v1/support/tickets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        customerId: formValue(data, "customerId"),
        subject: formValue(data, "subject"),
        description: formValue(data, "description"),
        priority: formValue(data, "priority"),
        ...(optionalFormValue(data, "category") ? { category: optionalFormValue(data, "category") } : {})
      })
    });
    setBusy(false);
    if (!response.ok) {
      // A tenant with no targets published cannot open a ticket at all, and the generic
      // failure would send somebody hunting through the form for a field that is fine.
      const payload = (await response.json().catch(() => null)) as { code?: string } | null;
      return setError(payload?.code === "SLA_TARGETS_NOT_CONFIGURED" ? (t.noTargets ?? "") : (t.formError ?? ""));
    }
    setDialog(false);
    router.refresh();
  }

  const columns: SmartColumn<InboxTicket>[] = [
    {
      id: "reference",
      label: t.reference!,
      render: (ticket) => <span className="ticket-reference">#{ticket.ticketNumber}</span>
    },
    {
      id: "subject",
      label: t.subject!,
      render: (ticket) => (
        <a className="ticket-subject" href={`/${locale}/support/${ticket.id}`}>
          {ticket.subject}
        </a>
      )
    },
    { id: "customer", label: t.customer!, render: (ticket) => ticket.customerName },
    {
      id: "status",
      label: t.status!,
      render: (ticket) => <span className={`state state-${ticket.status}`}>{t[ticket.status]}</span>
    },
    {
      id: "priority",
      label: t.priority!,
      render: (ticket) => <span className={`priority priority-${ticket.priority}`}>{t[ticket.priority]}</span>
    },
    {
      id: "assignee",
      label: t.assignee!,
      render: (ticket) => ticket.assigneeName ?? <span className="muted">{t.unassigned}</span>
    },
    {
      id: "createdAt",
      label: t.columnCreated!,
      render: (ticket) => (
        <time dateTime={ticket.openedAt} title={new Date(ticket.openedAt).toLocaleString(locale)}>
          {formatRelative(ticket.openedAt, locale)}
        </time>
      )
    },
    {
      id: "appliedTarget",
      label: t.columnAppliedTarget!,
      render: (ticket) => <span>{ticket.firstResponseAt ? t.targetResolution : t.targetFirstResponse}</span>
    },
    {
      id: "slaStatus",
      label: t.columnSlaStatus!,
      render: (ticket) => (
        <SlaStatusBadge sla={activeInboxSla(ticket)} labels={t} onClick={() => setSlaDetailTicket(ticket)} />
      )
    },
    {
      id: "updatedAt",
      label: t.columnLastUpdate!,
      render: (ticket) => (
        <time dateTime={ticket.updatedAt} title={new Date(ticket.updatedAt).toLocaleString(locale)}>
          {formatRelative(ticket.updatedAt, locale)}
        </time>
      )
    }
  ];

  return (
    <>
      {loadError && (
        <p className="crm-error">
          <AlertTriangle size={17} />
          {t.loadError}
        </p>
      )}
      {error && !dialog && (
        <p className="crm-error">
          <AlertTriangle size={17} />
          {error}
        </p>
      )}
      <SmartDataTable
        tableId="support.tickets"
        rows={tickets.items}
        columns={columns}
        preference={preference}
        total={tickets.total}
        page={tickets.page}
        pageSize={tickets.pageSize}
        pageParam="page"
        pageSizeParam="pageSize"
        sortParam="sort"
        sort={sort}
        sortOptions={[
          { value: "opened_desc", label: t.sortNewest! },
          { value: "priority_desc", label: t.sortPriority! },
          { value: "updated_desc", label: t.sortUpdated! },
          { value: "opened_asc", label: t.sortOldest! }
        ]}
        empty={t.empty!}
        labels={t}
        rowHref={(ticket) => `/${locale}/support/${ticket.id}`}
        primaryControls={
          <button
            className="primary-command"
            onClick={() => {
              setError("");
              setDialog(true);
            }}
          >
            <Plus size={17} />
            {t.newTicket}
          </button>
        }
      />
      {dialog && (
        <div
          className="dialog-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setDialog(false);
          }}
        >
          <section className="crm-dialog" role="dialog" aria-modal="true">
            <header>
              <h2>{t.newTicket}</h2>
              <button className="icon-button" onClick={() => setDialog(false)} aria-label={t.cancel}>
                <X size={18} />
              </button>
            </header>
            <form className="commerce-form" onSubmit={eventHandler(create, fail)}>
              <label>
                {t.customer}
                <select name="customerId" required disabled={busy}>
                  {customers.map((customer) => (
                    <option value={customer.id} key={customer.id}>
                      {customer.displayName}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {t.subject}
                <input name="subject" required minLength={3} maxLength={200} disabled={busy} />
              </label>
              <label>
                {t.priority}
                {/* Normal by default: a form that opens on Urgent teaches people to ignore it. */}
                <select name="priority" defaultValue="normal" disabled={busy}>
                  <option value="low">{t.low}</option>
                  <option value="normal">{t.normal}</option>
                  <option value="high">{t.high}</option>
                  <option value="urgent">{t.urgent}</option>
                </select>
              </label>
              <label>
                {t.category}
                <input name="category" maxLength={60} disabled={busy} />
              </label>
              <label className="full-width">
                {t.ticketDescription}
                <textarea name="description" required rows={4} maxLength={20000} disabled={busy} />
              </label>
              {error && <p className="form-error">{error}</p>}
              <button className="primary-button" disabled={busy || customers.length === 0}>
                {t.create}
              </button>
            </form>
          </section>
        </div>
      )}
      {slaDetailTicket && (
        <SlaDetailDialog ticket={slaDetailTicket} labels={t} onClose={() => setSlaDetailTicket(null)} />
      )}
    </>
  );
}

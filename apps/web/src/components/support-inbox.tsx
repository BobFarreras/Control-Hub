"use client";

import { AlertTriangle, Clock, Plus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { SmartDataTable, type SmartColumn } from "@/components/smart-data-table";
import type { CustomerOption, InboxTicket, TablePreference } from "@/lib/api-types";
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
 * The target a row should be judged by: until somebody answers, that is the first response;
 * afterwards it is the resolution. Showing both would double every row for no gain.
 *
 * Nothing here expires. What runs down is the commitment published for that priority, which is
 * why the column is not called a due date: a ticket stays open and workable past it, it is the
 * promise that has been missed.
 */
function activeTarget(ticket: InboxTicket) {
  return ticket.firstResponseAt ? ticket.sla.resolution : ticket.sla.firstResponse;
}

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
  const due = (ticket: InboxTicket) => {
    const target = activeTarget(ticket);
    const stage = ticket.firstResponseAt ? t.resolutionPending : t.firstResponsePending;

    if (!target.measurable) {
      // An unconfigured schedule is not "on time"; saying so would be a quiet lie.
      return <span className="sla-unknown">{t.notMeasured}</span>;
    }
    const remaining = target.targetMinutes - target.consumedMinutes;
    if (target.breached) {
      return (
        // Not colour alone: the icon and the word carry the same meaning for anyone who
        // cannot separate red from green.
        <span className="sla-breached" title={stage}>
          <AlertTriangle size={15} aria-hidden="true" />
          {t.breached}
        </span>
      );
    }
    return (
      <span className="sla-remaining" title={stage}>
        <Clock size={15} aria-hidden="true" />
        {t.remaining} {formatRemaining(remaining)}
      </span>
    );
  };

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
    { id: "due", label: t.due!, help: t.dueHelp!, render: due }
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
    </>
  );
}

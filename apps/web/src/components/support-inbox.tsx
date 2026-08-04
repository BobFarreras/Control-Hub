"use client";

import { AlertTriangle, Clock } from "lucide-react";
import { SmartDataTable, type SmartColumn } from "@/components/smart-data-table";
import type { InboxTicket, TablePreference } from "@/lib/api-types";

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
  labels: t,
  locale,
  loadError,
  sort
}: {
  tickets: { items: InboxTicket[]; total: number; page: number; pageSize: TablePreference["pageSize"] };
  preference: TablePreference;
  labels: Labels;
  locale: string;
  loadError: boolean;
  sort: string;
}) {
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
      />
    </>
  );
}

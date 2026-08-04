"use client";

import { AlertTriangle, Clock, Lock, Send, UserCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import type { TicketDetail as TicketDetailData } from "@/lib/api-types";
import { formValue } from "@/lib/form";
import { actionHandler, eventHandler } from "@/lib/handlers";

type Labels = Record<string, string>;

const workableStatuses = ["open", "waiting_customer", "waiting_third_party", "resolved", "closed"] as const;

function formatMinutes(minutes: number): string {
  const whole = Math.max(0, Math.round(minutes));
  const hours = Math.floor(whole / 60);
  if (hours === 0) return `${whole} min`;
  const rest = whole % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

export function TicketDetail({
  detail,
  labels: t,
  locale
}: {
  detail: TicketDetailData;
  labels: Labels;
  locale: string;
}) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const fail = () => setError(t.formError ?? "OPERATION_FAILED");

  const { ticket, messages, sla, assignableMembers } = detail;
  const target = ticket.firstResponseAt ? sla.resolution : sla.firstResponse;
  const stage = ticket.firstResponseAt ? t.resolutionPending : t.firstResponsePending;

  async function send(path: string, body: unknown, method: "PATCH" | "POST") {
    setBusy(true);
    setError("");
    const response = await fetch(path, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
    setBusy(false);
    if (!response.ok) return fail();
    router.refresh();
  }

  async function reply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    await send(
      `/api/v1/support/tickets/${ticket.id}/messages`,
      { body: formValue(data, "body"), visibility: formValue(data, "visibility") },
      "POST"
    );
    form.reset();
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
          <span className="ticket-reference">#{ticket.ticketNumber}</span>
          <h2>{ticket.subject}</h2>
          <p className="muted">{ticket.customerName}</p>
        </div>
        <div className="ticket-controls">
          <label>
            {t.status}
            <select
              value={ticket.status}
              disabled={busy}
              onChange={actionHandler(
                (event: React.ChangeEvent<HTMLSelectElement>) =>
                  send(`/api/v1/support/tickets/${ticket.id}/status`, { status: event.target.value }, "PATCH"),
                fail
              )}
            >
              <option value={ticket.status}>{t[ticket.status]}</option>
              {workableStatuses
                .filter((status) => status !== ticket.status)
                .map((status) => (
                  <option value={status} key={status}>
                    {t[status]}
                  </option>
                ))}
            </select>
          </label>
          <label>
            <UserCheck size={15} aria-hidden="true" />
            {t.assignee}
            <select
              value={ticket.assigneeMembershipId ?? ""}
              disabled={busy}
              onChange={actionHandler(
                (event: React.ChangeEvent<HTMLSelectElement>) =>
                  send(
                    `/api/v1/support/tickets/${ticket.id}/assignment`,
                    { assigneeMembershipId: event.target.value || null },
                    "PATCH"
                  ),
                fail
              )}
            >
              <option value="">{t.unassigned}</option>
              {assignableMembers.map((member) => (
                <option value={member.membershipId} key={member.membershipId}>
                  {member.name}
                </option>
              ))}
            </select>
          </label>
          <p className={target.breached ? "sla-breached" : "sla-remaining"} title={stage}>
            {target.breached ? <AlertTriangle size={15} aria-hidden="true" /> : <Clock size={15} aria-hidden="true" />}
            {!target.measurable
              ? t.notMeasured
              : target.breached
                ? t.breached
                : `${t.remaining} ${formatMinutes(target.targetMinutes - target.consumedMinutes)}`}
          </p>
        </div>
      </section>

      <section className="ticket-thread">
        <article className="ticket-message">
          <header>
            <strong>{t.ticketDescription}</strong>
            <time dateTime={ticket.openedAt}>{new Date(ticket.openedAt).toLocaleString(locale)}</time>
          </header>
          <p>{ticket.description}</p>
        </article>

        {messages.map((message) => (
          <article
            className={message.visibility === "internal" ? "ticket-message internal" : "ticket-message"}
            key={message.id}
            // The distinction cannot be visual only: an internal note read aloud or seen in
            // high contrast must still announce that the customer cannot see it.
            aria-label={message.visibility === "internal" ? t.internalNote : t.customerReply}
          >
            <header>
              <strong>{message.authorName ?? t.fromCustomer}</strong>
              <span className={message.visibility === "internal" ? "visibility internal" : "visibility customer"}>
                {message.visibility === "internal" && <Lock size={13} aria-hidden="true" />}
                {message.visibility === "internal" ? t.internalNote : t.customerReply}
              </span>
              <time dateTime={message.createdAt}>{new Date(message.createdAt).toLocaleString(locale)}</time>
            </header>
            <p>{message.body}</p>
          </article>
        ))}
      </section>

      <form className="ticket-reply" onSubmit={eventHandler(reply, fail)}>
        <label>
          {t.reply}
          <textarea name="body" required maxLength={20000} rows={4} disabled={busy} />
        </label>
        <div className="ticket-reply-actions">
          <label>
            {t.replyVisibility}
            {/* Internal is the default: making the customer-visible option deliberate means a
                note never reaches a client because somebody did not change a dropdown. */}
            <select name="visibility" defaultValue="internal" disabled={busy}>
              <option value="internal">{t.internalNote}</option>
              <option value="customer">{t.customerReply}</option>
            </select>
          </label>
          <button className="primary-button" disabled={busy}>
            <Send size={16} />
            {t.send}
          </button>
        </div>
      </form>
    </>
  );
}

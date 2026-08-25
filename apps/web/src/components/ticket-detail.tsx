"use client";

import { AlertTriangle, CalendarClock, Clock, FolderOpen, Lock, Send, Tag, UserCheck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { SelectControl } from "@/components/form-field";
import type { TicketDetail as TicketDetailData } from "@/lib/api-types";
import { actionHandler, eventHandler } from "@/lib/handlers";

type Labels = Record<string, string>;

const workableStatuses = ["open", "waiting_customer", "waiting_third_party", "resolved", "closed"] as const;

const priorityTone: Record<string, string> = {
  urgent: "priority-urgent",
  high: "priority-high",
  normal: "priority-normal",
  low: "priority-low"
};

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
  locale,
  outboundMail
}: {
  detail: TicketDetailData;
  labels: Labels;
  locale: string;
  outboundMail: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [replyBody, setReplyBody] = useState("");
  const [visibility, setVisibility] = useState("internal");
  const [mailInstanceId, setMailInstanceId] = useState(outboundMail[0]?.id ?? "");
  const [confirmation, setConfirmation] = useState("");
  const fail = () => setError(t.formError ?? "OPERATION_FAILED");

  const { ticket, messages, sla, assignableMembers, deliveries } = detail;
  const deliveryByMessage = new Map(deliveries.map((delivery) => [delivery.ticketMessageId, delivery]));
  const fr = sla.firstResponse;
  const rs = sla.resolution;

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
    if (visibility === "customer" && mailInstanceId) {
      setBusy(true);
      setError("");
      const response = await fetch(`/api/v1/integrations/${mailInstanceId}/actions/send_mail/confirmation`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ticketId: ticket.id, body: replyBody })
      });
      setBusy(false);
      if (!response.ok) return fail();
      const payload = (await response.json()) as { confirmation: string };
      setConfirmation(payload.confirmation);
      return;
    }
    await send(`/api/v1/support/tickets/${ticket.id}/messages`, { body: replyBody, visibility }, "POST");
    setReplyBody("");
  }

  async function confirmMail() {
    setBusy(true);
    setError("");
    const response = await fetch(`/api/v1/integrations/${mailInstanceId}/actions/send_mail`, {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify({ ticketId: ticket.id, body: replyBody, confirmation })
    });
    setBusy(false);
    if (!response.ok) return fail();
    setConfirmation("");
    setReplyBody("");
    router.refresh();
  }

  return (
    <div className="ticket-detail">
      {error && (
        <p className="crm-error" role="alert">
          <AlertTriangle size={17} aria-hidden="true" />
          {error}
        </p>
      )}

      {/* ── Identity strip ──────────────────────────────────────────────── */}
      <section className="ticket-identity">
        <div className="ticket-identity-main">
          <h2>{ticket.subject}</h2>
          <div className="ticket-identity-meta">
            <span className="ticket-identity-field">
              <span className="ticket-identity-label">{t.customer}:</span> {ticket.customerName}
            </span>
            {ticket.projectName && (
              <span className="ticket-identity-field">
                <Link className="ticket-project-link" href={`/projects/${ticket.projectId}`}>
                  <FolderOpen size={13} aria-hidden="true" />
                  {ticket.projectName}
                </Link>
              </span>
            )}
          </div>
          {ticket.description && <p className="ticket-identity-description">{ticket.description}</p>}
        </div>
      </section>

      {/* ── Two-column body ────────────────────────────────────────────── */}
      <div className="ticket-body">
        {/* ── Metadata sidebar ─────────────────────────────────────────── */}
        <aside className="ticket-meta" aria-label={t.status}>
          {/* Reference */}
          <div className="ticket-meta-field">
            <dt>{t.reference}</dt>
            <dd>
              <span className="ticket-reference">#{ticket.ticketNumber}</span>
            </dd>
          </div>

          {/* Status */}
          <div className="ticket-meta-field">
            <dt>{t.status}</dt>
            <dd>
              <SelectControl
                aria-label={t.status}
                value={ticket.status}
                disabled={busy}
                onChange={actionHandler(
                  (event: React.ChangeEvent<HTMLSelectElement>) =>
                    send(`/api/v1/support/tickets/${ticket.id}/status`, { status: event.target.value }, "PATCH"),
                  fail
                )}
                options={[
                  { value: ticket.status, label: t[ticket.status] ?? ticket.status },
                  ...workableStatuses
                    .filter((status) => status !== ticket.status)
                    .map((status) => ({ value: status, label: t[status] ?? status }))
                ]}
              />
            </dd>
          </div>

          {/* Priority */}
          <div className="ticket-meta-field">
            <dt>{t.priority}</dt>
            <dd>
              <span className={`ticket-priority-badge ${priorityTone[ticket.priority] ?? ""}`}>
                {t[ticket.priority]}
              </span>
            </dd>
          </div>

          {/* Category */}
          <div className="ticket-meta-field">
            <dt>
              <Tag size={13} aria-hidden="true" />
              {t.category}
            </dt>
            <dd>
              <input
                className="ticket-meta-input"
                type="text"
                defaultValue={ticket.category}
                maxLength={60}
                disabled={busy}
                onBlur={actionHandler(async (event: React.FocusEvent<HTMLInputElement>) => {
                  const value = event.target.value.trim();
                  if (value && value !== ticket.category) {
                    await send(`/api/v1/support/tickets/${ticket.id}/category`, { category: value }, "PATCH");
                  }
                }, fail)}
              />
            </dd>
          </div>

          {/* Assignee */}
          <div className="ticket-meta-field">
            <dt>
              <UserCheck size={13} aria-hidden="true" />
              {t.assignee}
            </dt>
            <dd>
              <SelectControl
                aria-label={t.assignee}
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
                options={[
                  { value: "", label: t.unassigned ?? "UNASSIGNED" },
                  ...assignableMembers.map((member) => ({ value: member.membershipId, label: member.name }))
                ]}
              />
            </dd>
          </div>

          {/* SLA — first response */}
          <div className="ticket-meta-field">
            <dt>
              <Clock size={13} aria-hidden="true" />
              {t.firstResponsePending}
            </dt>
            <dd>
              <span
                className={fr.breached ? "ticket-sla-breached" : fr.measurable ? "ticket-sla-ok" : "ticket-sla-unknown"}
              >
                {fr.breached ? <AlertTriangle size={13} aria-hidden="true" /> : <Clock size={13} aria-hidden="true" />}
                {!fr.measurable
                  ? t.notMeasured
                  : fr.breached
                    ? t.breached
                    : `${t.remaining} ${formatMinutes(fr.targetMinutes - fr.consumedMinutes)}`}
              </span>
            </dd>
          </div>

          {/* SLA — resolution */}
          <div className="ticket-meta-field">
            <dt>
              <Clock size={13} aria-hidden="true" />
              {t.resolutionPending}
            </dt>
            <dd>
              <span
                className={rs.breached ? "ticket-sla-breached" : rs.measurable ? "ticket-sla-ok" : "ticket-sla-unknown"}
              >
                {rs.breached ? <AlertTriangle size={13} aria-hidden="true" /> : <Clock size={13} aria-hidden="true" />}
                {!rs.measurable
                  ? t.notMeasured
                  : rs.breached
                    ? t.breached
                    : `${t.remaining} ${formatMinutes(rs.targetMinutes - rs.consumedMinutes)}`}
              </span>
            </dd>
          </div>

          {/* Dates */}
          <div className="ticket-meta-field">
            <dt>
              <CalendarClock size={13} aria-hidden="true" />
              {t.openedAt}
            </dt>
            <dd>
              <time dateTime={ticket.openedAt}>{new Date(ticket.openedAt).toLocaleDateString(locale)}</time>
            </dd>
          </div>
          <div className="ticket-meta-field">
            <dt>{t.lastUpdate}</dt>
            <dd>
              <time dateTime={ticket.updatedAt}>{new Date(ticket.updatedAt).toLocaleString(locale)}</time>
            </dd>
          </div>
        </aside>

        {/* ── Conversation ──────────────────────────────────────────────── */}
        <div className="ticket-conversation">
          <section className="ticket-thread" aria-label={t.ticketDescription}>
            {/* Original description */}
            <article className="ticket-message ticket-message-description">
              <header>
                <strong>{t.ticketDescription}</strong>
                <time dateTime={ticket.openedAt}>{new Date(ticket.openedAt).toLocaleString(locale)}</time>
              </header>
              <p>{ticket.description}</p>
            </article>

            {/* Messages */}
            {messages.map((message) => (
              <article
                className={message.visibility === "internal" ? "ticket-message internal" : "ticket-message"}
                key={message.id}
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
                {deliveryByMessage.get(message.id) && (
                  <small className={`mail-delivery mail-delivery-${deliveryByMessage.get(message.id)!.status}`}>
                    {t[`delivery_${deliveryByMessage.get(message.id)!.status}`] ??
                      deliveryByMessage.get(message.id)!.status}
                  </small>
                )}
              </article>
            ))}
          </section>

          {/* Reply form */}
          <form className="ticket-reply" onSubmit={eventHandler(reply, fail)}>
            <label className="ticket-reply-label">
              {t.reply}
              <textarea
                name="body"
                required
                maxLength={20000}
                rows={4}
                disabled={busy || Boolean(confirmation)}
                value={replyBody}
                onChange={(event) => setReplyBody(event.target.value)}
              />
            </label>
            <div className="ticket-reply-actions">
              <label>
                {t.replyVisibility}
                <SelectControl
                  name="visibility"
                  value={visibility}
                  disabled={busy}
                  onChange={(event) => {
                    setVisibility(event.target.value);
                    setConfirmation("");
                  }}
                  options={[
                    { value: "internal", label: t.internalNote ?? "INTERNAL_NOTE" },
                    { value: "customer", label: t.customerReply ?? "CUSTOMER_REPLY" }
                  ]}
                />
              </label>
              {visibility === "customer" && outboundMail.length > 0 && (
                <label>
                  {t.mailIntegration}
                  <SelectControl
                    value={mailInstanceId}
                    disabled={busy || Boolean(confirmation)}
                    onChange={(event) => setMailInstanceId(event.target.value)}
                    options={outboundMail.map((instance) => ({ value: instance.id, label: instance.name }))}
                  />
                </label>
              )}
              <button className="primary-button" disabled={busy || (visibility === "customer" && !mailInstanceId)}>
                <Send size={16} />
                {visibility === "customer" && mailInstanceId ? t.prepareMail : t.send}
              </button>
            </div>
            {visibility === "customer" && outboundMail.length === 0 && (
              <p className="field-hint">{t.noMailIntegration}</p>
            )}
            {confirmation && (
              <div className="dialog-backdrop">
                <div
                  className="crm-dialog ticket-mail-dialog"
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="mail-confirm-title"
                >
                  <header>
                    <h2 id="mail-confirm-title">{t.confirmMailTitle}</h2>
                  </header>
                  <div className="ticket-mail-dialog-body">
                    <p>{t.confirmMailDescription}</p>
                    <div className="ticket-mail-preview">{replyBody}</div>
                  </div>
                  <div className="ticket-mail-dialog-actions">
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={busy}
                      onClick={() => setConfirmation("")}
                    >
                      {t.cancel}
                    </button>
                    <button
                      type="button"
                      className="primary-button"
                      disabled={busy}
                      onClick={actionHandler(confirmMail, fail)}
                    >
                      <Send size={16} /> {t.confirmAndSend}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </form>
        </div>
      </div>
    </div>
  );
}

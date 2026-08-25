"use client";

import { Archive, CheckSquare, Inbox, Mail, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { SelectControl } from "@/components/form-field";
import type { CustomerOption, InboundMessage, MailboxTicketOption } from "@/lib/api-types";

type Labels = Record<string, string>;
type Choice = { customerId: string; mode: "new" | "existing"; ticketId: string; priority: string };

export function SupportMailbox({
  messages,
  customers,
  tickets,
  labels,
  locale
}: {
  messages: InboundMessage[];
  customers: CustomerOption[];
  tickets: MailboxTicketOption[];
  labels: Labels;
  locale: string;
}) {
  const router = useRouter();
  const [activeId, setActiveId] = useState(messages[0]?.id ?? null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [busy, setBusy] = useState(false);
  const [confirmBulk, setConfirmBulk] = useState(false);
  const [confirmSingle, setConfirmSingle] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = messages.find((message) => message.id === activeId) ?? messages[0] ?? null;
  const selectable = messages.filter((message) => message.status === "pending");
  const choice = active
    ? (choices[active.id] ?? {
        customerId: active.suggestedCustomerId ?? "",
        mode: "new",
        ticketId: "",
        priority: "normal"
      })
    : null;
  const availableTickets = useMemo(
    () => tickets.filter((ticket) => ticket.customerId === choice?.customerId),
    [tickets, choice?.customerId]
  );
  const update = (next: Partial<Choice>) =>
    active && choice && setChoices((current) => ({ ...current, [active.id]: { ...choice, ...next } }));

  async function request(path: string, body?: unknown) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(
        path,
        body === undefined
          ? { method: "POST" }
          : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }
      );
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { code?: string } | null;
        throw new Error(payload?.code ?? "MAILBOX_ACTION_FAILED");
      }
      setSelected(new Set());
      setConfirmBulk(false);
      setConfirmSingle(false);
      router.refresh();
    } catch (caught) {
      const code = caught instanceof Error ? caught.message : "MAILBOX_ACTION_FAILED";
      setError(labels[code] ?? labels.formError ?? "OPERATION_FAILED");
    } finally {
      setBusy(false);
    }
  }

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (messages.length === 0)
    return (
      <div className="mailbox-empty">
        <Inbox size={34} aria-hidden="true" />
        <p>{labels.empty}</p>
      </div>
    );

  return (
    <section className="mailbox-shell">
      <div className="mailbox-toolbar">
        {selectable.length > 0 && (
          <button
            className="mailbox-icon-button"
            aria-label={labels.selectAll}
            title={labels.selectAll}
            onClick={() =>
              setSelected(
                selected.size === selectable.length ? new Set() : new Set(selectable.map((message) => message.id))
              )
            }
          >
            <CheckSquare size={18} />
          </button>
        )}
        <strong>
          {selected.size > 0 ? `${selected.size} ${labels.selected}` : `${messages.length} ${labels.messages}`}
        </strong>
        {selected.size > 0 &&
          (confirmBulk ? (
            <div className="mailbox-confirm">
              <span>{labels.confirmBulkDiscard}</span>
              <button
                className="button danger"
                disabled={busy}
                onClick={() => void request("/api/v1/support/mailbox/discard", { messageIds: [...selected] })}
              >
                {labels.confirm}
              </button>
              <button className="button ghost" onClick={() => setConfirmBulk(false)}>
                {labels.cancel}
              </button>
            </div>
          ) : (
            <button
              className="mailbox-icon-button danger"
              aria-label={labels.discardSelected}
              title={labels.discardSelected}
              onClick={() => setConfirmBulk(true)}
            >
              <Trash2 size={18} />
            </button>
          ))}
        {selected.size === 0 && active?.status === "pending" && choice && (
          <div className="mailbox-classifier">
            {active.suggestedCustomerName && (
              <span className="mailbox-suggestion">
                {labels.suggested}: <strong>{active.suggestedCustomerName}</strong>
              </span>
            )}
            <SelectControl
              aria-label={labels.customer ?? "CUSTOMER"}
              placeholder={labels.chooseCustomer}
              value={choice.customerId}
              onChange={(event) => update({ customerId: event.target.value, ticketId: "" })}
              options={customers.map((customer) => ({ value: customer.id, label: customer.displayName }))}
            />
            <SelectControl
              aria-label={labels.destination ?? "DESTINATION"}
              value={choice.mode}
              onChange={(event) => update({ mode: event.target.value as Choice["mode"] })}
              options={[
                { value: "new", label: labels.newTicket ?? "NEW_TICKET" },
                { value: "existing", label: labels.existingTicket ?? "EXISTING_TICKET" }
              ]}
            />
            {choice.mode === "existing" ? (
              <SelectControl
                aria-label={labels.ticket ?? "TICKET"}
                placeholder={labels.chooseTicket}
                value={choice.ticketId}
                onChange={(event) => update({ ticketId: event.target.value })}
                options={availableTickets.map((ticket) => ({
                  value: ticket.id,
                  label: `#${ticket.ticketNumber} · ${ticket.subject}`
                }))}
              />
            ) : (
              <SelectControl
                aria-label={labels.priority ?? "PRIORITY"}
                value={choice.priority}
                onChange={(event) => update({ priority: event.target.value })}
                options={["low", "normal", "high", "urgent"].map((value) => ({
                  value,
                  label: labels[value] ?? value
                }))}
              />
            )}
            <button
              className="button primary"
              disabled={busy || !choice.customerId || (choice.mode === "existing" && !choice.ticketId)}
              onClick={() =>
                void request(`/api/v1/support/mailbox/${active.id}/classify`, {
                  customerId: choice.customerId,
                  ...(choice.mode === "existing" ? { ticketId: choice.ticketId } : { priority: choice.priority })
                })
              }
            >
              {labels.classify}
            </button>
            {confirmSingle ? (
              <>
                <button
                  className="button danger"
                  disabled={busy}
                  onClick={() => void request(`/api/v1/support/mailbox/${active.id}/discard`)}
                >
                  {labels.confirmDiscard}
                </button>
                <button className="button ghost" onClick={() => setConfirmSingle(false)}>
                  {labels.cancel}
                </button>
              </>
            ) : (
              <button className="button ghost" onClick={() => setConfirmSingle(true)}>
                <Trash2 size={16} />
                {labels.discard}
              </button>
            )}
          </div>
        )}
      </div>
      {error && (
        <p className="form-error mailbox-global-error" role="alert">
          {error}
        </p>
      )}
      <div className="mailbox-layout">
        <div className="mailbox-message-list" role="list" aria-label={labels.messages}>
          {messages.map((message) => (
            <div
              className={`mailbox-list-row ${active?.id === message.id ? "active" : ""}`}
              role="listitem"
              key={message.id}
            >
              {message.status === "pending" ? (
                <input
                  type="checkbox"
                  checked={selected.has(message.id)}
                  aria-label={`${labels.select} ${message.subject ?? message.senderAddress}`}
                  onChange={() => toggle(message.id)}
                />
              ) : (
                <span aria-hidden="true" />
              )}
              <button
                onClick={() => {
                  setActiveId(message.id);
                  setConfirmSingle(false);
                }}
              >
                <span className="mailbox-row-top">
                  <strong>{message.senderName ?? message.senderAddress}</strong>
                  <time>
                    {new Intl.DateTimeFormat(locale, { day: "2-digit", month: "short" }).format(
                      new Date(message.receivedAt)
                    )}
                  </time>
                </span>
                <span className="mailbox-row-subject">{message.subject ?? labels.noSubject}</span>
                <span className="mailbox-row-preview">{message.preview ?? labels.noPreview}</span>
              </button>
            </div>
          ))}
        </div>
        {active && choice && (
          <article className="mailbox-reader">
            <header className="mailbox-reader-header">
              <div className="mailbox-avatar">
                <Mail size={20} />
              </div>
              <div>
                <h2>{active.subject ?? labels.noSubject}</h2>
                <p>
                  <strong>{active.senderName ?? active.senderAddress}</strong> &lt;{active.senderAddress}&gt;
                </p>
                <small>
                  {active.instanceName} ·{" "}
                  {new Intl.DateTimeFormat(locale, { dateStyle: "long", timeStyle: "short" }).format(
                    new Date(active.receivedAt)
                  )}
                </small>
              </div>
            </header>
            <div className="mailbox-reader-body">{active.preview ?? labels.noPreview}</div>
            {active.status === "classified" && active.ticketId && (
              <div className="mailbox-linked">
                <Archive size={17} />
                <Link href={`/${locale}/support/${active.ticketId}`}>
                  #{active.ticketNumber} · {active.customerName}
                </Link>
              </div>
            )}
          </article>
        )}
      </div>
    </section>
  );
}

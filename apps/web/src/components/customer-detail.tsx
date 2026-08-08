"use client";

import { Building2, CalendarClock, Check, Contact, History, ListTodo, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { CustomerDetail as Customer } from "@/lib/api-types";
import { customerOverview } from "@/lib/customer-overview";
import { textEntries } from "@/lib/form";
import { actionHandler } from "@/lib/handlers";

type Labels = Record<string, string>;

function EmptyState({ title, description }: { title: string | undefined; description: string | undefined }) {
  return (
    <div className="detail-empty">
      <strong>{title ?? ""}</strong>
      <p>{description ?? ""}</p>
    </div>
  );
}

export function CustomerDetail({ customer, labels, locale }: { customer: Customer; labels: Labels; locale: string }) {
  const router = useRouter();
  const [error, setError] = useState("");
  /** Last resort for a handler that rejected outright, so a failure is never silent. */
  const fail = () => setError("CRM_ERROR");
  const [pending, startTransition] = useTransition();
  const refresh = () => startTransition(() => router.refresh());
  async function submit(path: string, formData: FormData, extra: Record<string, unknown> = {}) {
    setError("");
    const body: Record<string, unknown> = { ...Object.fromEntries(textEntries(formData)), ...extra };
    if (typeof body.dueAt === "string") body.dueAt = new Date(body.dueAt).toISOString();
    const response = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      const payload = (await response.json()) as { code?: string };
      setError(payload.code ?? "CRM_ERROR");
      return;
    }
    refresh();
  }
  async function submitContact(formData: FormData) {
    await submit(`/api/v1/crm/customers/${customer.id}/contacts`, formData, {
      isPrimary: formData.get("isPrimary") === "true"
    });
  }
  async function complete(taskId: string) {
    const response = await fetch(`/api/v1/crm/tasks/${taskId}/complete`, { method: "POST" });
    if (response.ok) refresh();
    else setError("CRM_ERROR");
  }
  async function recoverSourceContact() {
    setError("");
    const response = await fetch(`/api/v1/crm/customers/${customer.id}/contacts/from-source-lead`, {
      method: "POST"
    });
    if (response.ok) refresh();
    else {
      const payload = (await response.json()) as { code?: string };
      setError(payload.code ?? "CRM_ERROR");
    }
  }
  const date = (value: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
  const overview = customerOverview(customer);
  const activityLabel = (type: string) => labels[type] ?? type.replaceAll(".", " · ");
  return (
    <div className="customer-detail" aria-busy={pending}>
      {error && (
        <p className="crm-error" role="alert">
          {labels[error] ?? error}
        </p>
      )}
      <section className="customer-overview-panel" aria-label={labels.customerOverview}>
        <div className="customer-company-card">
          <span className="overview-icon">
            <Building2 size={20} />
          </span>
          <div>
            <p className="eyebrow">{labels.companyData}</p>
            <h2>{customer.legalName ?? customer.displayName}</h2>
            <dl className="customer-facts">
              <div>
                <dt>{labels.billingEmail}</dt>
                <dd>{customer.billingEmail ?? labels.notProvided}</dd>
              </div>
              <div>
                <dt>{labels.phone}</dt>
                <dd>{customer.phone ?? labels.notProvided}</dd>
              </div>
              <div>
                <dt>{labels.website}</dt>
                <dd>{customer.website ?? labels.notProvided}</dd>
              </div>
              <div>
                <dt>{labels.customerSince}</dt>
                <dd>{date(customer.createdAt)}</dd>
              </div>
            </dl>
          </div>
        </div>
        <div className="customer-overview-metrics">
          <article>
            <Contact size={18} />
            <span>{labels.primaryContact}</span>
            <strong>{overview.primaryContact?.name ?? labels.notProvided}</strong>
          </article>
          <article>
            <ListTodo size={18} />
            <span>{labels.openTasks}</span>
            <strong>{overview.openTaskCount}</strong>
          </article>
          <article>
            <CalendarClock size={18} />
            <span>{labels.nextTask}</span>
            <strong>{overview.nextTask?.title ?? labels.noPendingTasks}</strong>
          </article>
          <article>
            <History size={18} />
            <span>{labels.lastActivity}</span>
            <strong>{overview.lastActivity ? activityLabel(overview.lastActivity.type) : labels.noActivity}</strong>
          </article>
        </div>
      </section>
      <section className="detail-column">
        <article className="detail-panel">
          <h2>{labels.contacts}</h2>
          <form className="inline-create contact-create" action={submitContact}>
            <input name="name" placeholder={labels.name} required minLength={2} />
            <input name="role" placeholder={labels.role} />
            <input name="email" type="email" placeholder={labels.email} />
            <input name="phone" type="tel" placeholder={labels.phone} />
            <label className="inline-check">
              <input name="isPrimary" type="checkbox" value="true" /> {labels.primary}
            </label>
            <button className="icon-button" title={labels.addContact}>
              <Plus size={18} />
            </button>
          </form>
          {customer.contacts.length === 0 && (
            <>
              <EmptyState title={labels.noContacts} description={labels.noContactsHint} />
              {customer.createdFromLeadId && (
                <button
                  type="button"
                  className="secondary-button recover-contact-button"
                  onClick={actionHandler(recoverSourceContact, fail)}
                >
                  <Plus size={16} />
                  {labels.recoverContactFromLead}
                </button>
              )}
            </>
          )}
          {customer.contacts.map((contact) => (
            <div className="detail-row" key={contact.id}>
              <div>
                <strong>{contact.name}</strong>
                <small>{contact.role ?? contact.email ?? contact.phone ?? "--"}</small>
              </div>
              {contact.isPrimary && <span className="state state-won">{labels.primary}</span>}
            </div>
          ))}
        </article>
        <article className="detail-panel">
          <h2>{labels.notes}</h2>
          <form className="inline-create" action={(data) => submit(`/api/v1/crm/customers/${customer.id}/notes`, data)}>
            <textarea name="body" placeholder={labels.addNote} required maxLength={10000} />
            <button className="icon-button" title={labels.addNote}>
              <Plus size={18} />
            </button>
          </form>
          {customer.notes.length === 0 && <EmptyState title={labels.noNotes} description={labels.noNotesHint} />}
          {customer.notes.map((note) => (
            <div className="detail-row stacked" key={note.id}>
              <p>{note.body}</p>
              <time>{date(note.createdAt)}</time>
            </div>
          ))}
        </article>
      </section>
      <section className="detail-column">
        <article className="detail-panel">
          <h2>{labels.tasks}</h2>
          <form className="inline-create" action={(data) => submit(`/api/v1/crm/customers/${customer.id}/tasks`, data)}>
            <input name="title" placeholder={labels.addTask} required maxLength={240} />
            <input name="dueAt" type="datetime-local" aria-label={labels.dueAt} />
            <button className="icon-button" title={labels.addTask}>
              <Plus size={18} />
            </button>
          </form>
          {customer.tasks.length === 0 && <EmptyState title={labels.noTasks} description={labels.noTasksHint} />}
          {customer.tasks.map((task) => (
            <div className="detail-row" key={task.id}>
              <div>
                <strong>{task.title}</strong>
                <small>{task.dueAt ? date(task.dueAt) : "--"}</small>
              </div>
              {task.completedAt ? (
                <span className="state state-won">{labels.complete}</span>
              ) : (
                <button
                  className="icon-button"
                  title={labels.complete}
                  onClick={actionHandler(() => complete(task.id), fail)}
                >
                  <Check size={17} />
                </button>
              )}
            </div>
          ))}
        </article>
        <article className="detail-panel">
          <h2>{labels.timeline}</h2>
          {customer.activity.length === 0 && (
            <EmptyState title={labels.noActivity} description={labels.noActivityHint} />
          )}
          {customer.activity.map((event) => (
            <div className="timeline-row" key={event.id}>
              <i />
              <div>
                <strong>{activityLabel(event.type)}</strong>
                <time>{date(event.occurredAt)}</time>
              </div>
            </div>
          ))}
        </article>
      </section>
    </div>
  );
}

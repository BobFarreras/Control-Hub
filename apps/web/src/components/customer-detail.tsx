"use client";

import { Check, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { textEntries } from "@/lib/form";
import { actionHandler } from "@/lib/handlers";

type Customer = {
  id: string;
  contacts: {
    id: string;
    name: string;
    role: string | null;
    email: string | null;
    phone: string | null;
    isPrimary: boolean;
  }[];
  notes: { id: string; body: string; createdAt: string }[];
  tasks: { id: string; title: string; dueAt: string | null; completedAt: string | null }[];
  activity: { id: string; type: string; occurredAt: string }[];
};
type Labels = Record<string, string>;

export function CustomerDetail({ customer, labels, locale }: { customer: Customer; labels: Labels; locale: string }) {
  const router = useRouter();
  const [error, setError] = useState("");
  /** Last resort for a handler that rejected outright, so a failure is never silent. */
  const fail = () => setError("CRM_ERROR");
  const [pending, startTransition] = useTransition();
  const refresh = () => startTransition(() => router.refresh());
  async function submit(path: string, formData: FormData) {
    setError("");
    const body: Record<string, string> = Object.fromEntries(textEntries(formData));
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
  async function complete(taskId: string) {
    const response = await fetch(`/api/v1/crm/tasks/${taskId}/complete`, { method: "POST" });
    if (response.ok) refresh();
    else setError("CRM_ERROR");
  }
  const date = (value: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
  return (
    <div className="customer-detail" aria-busy={pending}>
      {error && (
        <p className="crm-error" role="alert">
          {error}
        </p>
      )}
      <section className="detail-column">
        <article className="detail-panel">
          <h2>{labels.contacts}</h2>
          <form
            className="inline-create"
            action={(data) => submit(`/api/v1/crm/customers/${customer.id}/contacts`, data)}
          >
            <input name="name" placeholder={labels.name} required minLength={2} />
            <input name="role" placeholder={labels.role} />
            <input name="email" type="email" placeholder={labels.email} />
            <button className="icon-button" title={labels.addContact}>
              <Plus size={18} />
            </button>
          </form>
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
          {customer.activity.map((event) => (
            <div className="timeline-row" key={event.id}>
              <i />
              <div>
                <strong>{event.type}</strong>
                <time>{date(event.occurredAt)}</time>
              </div>
            </div>
          ))}
        </article>
      </section>
    </div>
  );
}

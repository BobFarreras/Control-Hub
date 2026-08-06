"use client";

import { AlertTriangle, Plus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { SmartDataTable, type SmartColumn } from "@/components/smart-data-table";
import type { CustomerOption, ProjectRow, TablePreference } from "@/lib/api-types";
import { formValue, optionalFormValue } from "@/lib/form";
import { eventHandler } from "@/lib/handlers";

type Labels = Record<string, string>;

const statuses = ["draft", "active", "on_hold", "delivered", "closed", "canceled"] as const;

/**
 * Minutes as something a person reads.
 *
 * Announced with the units spelled out rather than as `1:30`, which a screen reader says as a
 * time of day.
 */
export function formatHours(minutes: number): string {
  const whole = Math.max(0, Math.round(minutes));
  const hours = Math.floor(whole / 60);
  if (hours === 0) return `${whole} min`;
  const rest = whole % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

export function ProjectsWorkspace({
  projects,
  preference,
  customers,
  labels: t,
  locale,
  loadError,
  sort
}: {
  projects: { items: ProjectRow[]; total: number; page: number; pageSize: TablePreference["pageSize"] };
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
    const startedAt = optionalFormValue(data, "startedAt");
    const dueAt = optionalFormValue(data, "dueAt");
    const response = await fetch("/api/v1/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        customerId: formValue(data, "customerId"),
        code: formValue(data, "code"),
        name: formValue(data, "name"),
        ...(optionalFormValue(data, "description") ? { description: optionalFormValue(data, "description") } : {}),
        // A date input gives a day; the API takes an instant, and midnight UTC is the only
        // reading of "this day" that does not shift when somebody else opens the project.
        ...(startedAt ? { startedAt: `${startedAt}T00:00:00.000Z` } : {}),
        ...(dueAt ? { dueAt: `${dueAt}T00:00:00.000Z` } : {})
      })
    });
    setBusy(false);
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { code?: string } | null;
      return setError(payload?.code === "DUPLICATE_CODE" ? (t.duplicateCode ?? "") : (t.formError ?? ""));
    }
    setDialog(false);
    router.refresh();
  }

  const columns: SmartColumn<ProjectRow>[] = [
    { id: "code", label: t.code!, render: (project) => <span className="ticket-reference">{project.code}</span> },
    {
      id: "name",
      label: t.name!,
      render: (project) => (
        <a className="ticket-subject" href={`/${locale}/projects/${project.id}`}>
          {project.name}
        </a>
      )
    },
    { id: "customer", label: t.customer!, render: (project) => project.customerName },
    {
      id: "status",
      label: t.status!,
      render: (project) => <span className={`state state-${project.status}`}>{t[project.status]}</span>,
      filter: {
        parameter: "status",
        options: statuses.map((status) => ({ value: status, label: t[status] ?? status }))
      }
    },
    {
      id: "owner",
      label: t.owner!,
      render: (project) => project.ownerName ?? <span className="muted">{t.unassigned}</span>
    },
    {
      id: "due",
      label: t.due!,
      render: (project) =>
        project.dueAt ? (
          <time dateTime={project.dueAt}>{new Date(project.dueAt).toLocaleDateString(locale)}</time>
        ) : (
          <span className="muted">{t.noDueDate}</span>
        )
    },
    {
      id: "logged",
      label: t.logged!,
      help: t.loggedHelp!,
      render: (project) => formatHours(project.loggedMinutes)
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
        tableId="projects.list"
        rows={projects.items}
        columns={columns}
        preference={preference}
        total={projects.total}
        page={projects.page}
        pageSize={projects.pageSize}
        pageParam="page"
        pageSizeParam="pageSize"
        sortParam="sort"
        sort={sort}
        sortOptions={[
          { value: "created_desc", label: t.sortNewest! },
          { value: "due_asc", label: t.sortDue! },
          { value: "name_asc", label: t.sortName! },
          { value: "created_asc", label: t.sortOldest! }
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
            {t.newProject}
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
              <h2>{t.newProject}</h2>
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
                {t.projectCode}
                <input
                  name="code"
                  required
                  minLength={3}
                  maxLength={64}
                  pattern="[a-z0-9][a-z0-9\-]{1,62}[a-z0-9]"
                  aria-describedby="project-code-help"
                  disabled={busy}
                />
                <small id="project-code-help">{t.codeHelp}</small>
              </label>
              <label>
                {t.projectName}
                <input name="name" required minLength={3} maxLength={200} disabled={busy} />
              </label>
              <label>
                {t.startedAt}
                <input name="startedAt" type="date" disabled={busy} />
              </label>
              <label>
                {t.dueAt}
                <input name="dueAt" type="date" disabled={busy} />
              </label>
              <label className="full-width">
                {t.projectDescription}
                <textarea name="description" rows={3} maxLength={2000} disabled={busy} />
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

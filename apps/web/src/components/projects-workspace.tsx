"use client";

import { AlertTriangle, Coins, Plus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { SelectField, TextField } from "@/components/form-field";
import { SmartDataTable, type SmartColumn } from "@/components/smart-data-table";
import { projectStatusTone, StatusPill } from "@/components/status-pill";
import type { CustomerOption, ProjectRow, ServiceType, TablePreference } from "@/lib/api-types";
import { formValue, optionalFormValue } from "@/lib/form";
import { formatHours } from "@/lib/format";
import { eventHandler } from "@/lib/handlers";

type Labels = Record<string, string>;

const statuses = ["draft", "active", "on_hold", "delivered", "closed", "canceled"] as const;

export function ProjectsWorkspace({
  projects,
  preference,
  customers,
  serviceTypes,
  labels: t,
  locale,
  loadError,
  sort
}: {
  projects: { items: ProjectRow[]; total: number; page: number; pageSize: TablePreference["pageSize"] };
  preference: TablePreference;
  customers: CustomerOption[];
  serviceTypes: ServiceType[];
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
        // Optional, and left out rather than sent empty: a project without a kind of work simply
        // does not resolve a price per kind, which is a state the schema allows.
        ...(optionalFormValue(data, "serviceTypeId")
          ? { serviceTypeId: optionalFormValue(data, "serviceTypeId") }
          : {}),
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
      id: "serviceType",
      label: t.serviceType!,
      render: (project) => project.serviceTypeName ?? <span className="crm-muted">—</span>
    },
    {
      id: "status",
      label: t.status!,
      render: (project) => (
        <StatusPill tone={projectStatusTone[project.status] ?? "neutral"} label={t[project.status] ?? project.status} />
      ),
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
        rowHref={(project) => `/${locale}/projects/${project.id}`}
        primaryControls={
          <>
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
            {/* The margin on a project page is blank until a rate exists, so the way to fix that
                is reachable from the listing rather than only from a URL somebody has to know. */}
            <a className="secondary-button" href={`/${locale}/projects/rates`}>
              <Coins size={17} aria-hidden="true" />
              {t.rates}
            </a>
          </>
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
            <form className="dialog-form" onSubmit={eventHandler(create, fail)}>
              <SelectField
                label={t.customer!}
                name="customerId"
                required
                disabled={busy}
                options={customers.map((customer) => ({ value: customer.id, label: customer.displayName }))}
              />
              <TextField
                label={t.projectCode!}
                name="code"
                required
                minLength={3}
                maxLength={64}
                pattern="[a-z0-9][a-z0-9\-]{1,62}[a-z0-9]"
                hint={t.codeHelp}
                data-mono="true"
                autoComplete="off"
                disabled={busy}
              />
              <TextField label={t.projectName!} name="name" required minLength={3} maxLength={200} disabled={busy} />
              <SelectField
                label={t.serviceType!}
                name="serviceTypeId"
                disabled={busy || serviceTypes.every((type) => !type.active)}
                hint={t.serviceTypeHint}
                options={[
                  { value: "", label: t.serviceTypeNone ?? "—" },
                  ...serviceTypes.filter((type) => type.active).map((type) => ({ value: type.id, label: type.name }))
                ]}
              />
              <TextField label={t.startedAt!} name="startedAt" type="date" data-mono="true" disabled={busy} />
              <TextField label={t.dueAt!} name="dueAt" type="date" data-mono="true" disabled={busy} />
              <div className="field wide">
                <label className="field-label" htmlFor="project-description">
                  {t.projectDescription}
                </label>
                <textarea id="project-description" name="description" rows={3} maxLength={2000} disabled={busy} />
              </div>
              {error && (
                <p className="form-error wide" role="alert">
                  {error}
                </p>
              )}
              <footer>
                <button type="button" className="secondary-button" onClick={() => setDialog(false)} disabled={busy}>
                  {t.cancel}
                </button>
                <button className="primary-button" disabled={busy || customers.length === 0}>
                  {t.create}
                </button>
              </footer>
            </form>
          </section>
        </div>
      )}
    </>
  );
}

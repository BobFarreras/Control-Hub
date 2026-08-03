"use client";

import {
  ArrowRight,
  Ban,
  CircleDot,
  Download,
  FileCheck2,
  FileUp,
  Medal,
  PhoneCall,
  Plus,
  UserCheck,
  X
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { InstantSearch } from "@/components/instant-search";
import { SmartDataTable, type SmartColumn } from "@/components/smart-data-table";
import type { CrmSummary, CustomerRow, ImportResult, LeadRow, Page, TablePreference } from "@/lib/api-types";
import { textEntries } from "@/lib/form";
import { actionHandler } from "@/lib/handlers";

type Labels = Record<string, string>;
const pipeline = [
  ["new", CircleDot],
  ["contacted", PhoneCall],
  ["qualified", UserCheck],
  ["proposal", FileCheck2],
  ["won", Medal]
] as const;

export function CrmWorkspace({
  leads,
  customers,
  leadPreference,
  customerPreference,
  leadSort,
  customerSort,
  summary,
  labels,
  locale,
  loadError
}: {
  leads: Page<LeadRow>;
  customers: Page<CustomerRow>;
  leadPreference: TablePreference;
  customerPreference: TablePreference;
  leadSort: string;
  customerSort: string;
  summary: CrmSummary;
  labels: Labels;
  locale: string;
  loadError: boolean;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<"leads" | "customers">("leads");
  const [dialog, setDialog] = useState<"lead" | "import" | null>(null);
  const [error, setError] = useState("");
  /** Last resort for a handler that rejected outright, so a failure is never silent. */
  const fail = () => setError("CRM_ERROR");
  const [csv, setCsv] = useState("");
  const [importResults, setImportResults] = useState<ImportResult[]>([]);
  const [pending, startTransition] = useTransition();
  const refresh = () => startTransition(() => router.refresh());
  async function request(path: string, init: RequestInit) {
    const response = await fetch(path, init);
    if (!response.ok) {
      const payload = (await response.json()) as { code?: string };
      throw new Error(payload.code === "MFA_REQUIRED" ? labels.mfaRequired : (payload.code ?? "CRM_ERROR"));
    }
    return response;
  }
  async function createLead(formData: FormData) {
    try {
      setError("");
      const body = Object.fromEntries(textEntries(formData));
      await request("/api/v1/crm/leads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      });
      setDialog(null);
      refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "CRM_ERROR");
    }
  }
  async function mutate(path: string, body?: object) {
    try {
      setError("");
      const init: RequestInit = { method: body ? "PATCH" : "POST" };
      if (body) {
        init.headers = { "content-type": "application/json" };
        init.body = JSON.stringify(body);
      }
      await request(path, init);
      refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "CRM_ERROR");
    }
  }
  async function importCsv(commit: boolean) {
    try {
      setError("");
      const response = await request("/api/v1/crm/leads/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ csv, commit })
      });
      const payload = (await response.json()) as { results: ImportResult[] };
      setImportResults(payload.results);
      if (commit && payload.results.some((result) => result.status === "imported")) refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "CRM_ERROR");
    }
  }
  const formatDate = (value: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(value));
  const l = (key: string) => labels[key] ?? key;
  const leadColumns: SmartColumn<LeadRow>[] = [
    {
      id: "name",
      label: l("name"),
      locked: true,
      width: 210,
      sort: { asc: "name_asc", desc: "name_desc" },
      render: (lead) => (
        <>
          <strong>{lead.name}</strong>
          <small>{lead.email ?? lead.phone ?? "--"}</small>
        </>
      )
    },
    {
      id: "company",
      label: l("company"),
      width: 180,
      sort: { asc: "company_asc", desc: "company_desc" },
      render: (lead) => lead.companyName ?? "--"
    },
    {
      id: "status",
      label: l("status"),
      width: 230,
      filter: {
        parameter: "leadStatus",
        options: ["new", "contacted", "qualified", "proposal", "won", "lost"].map((value) => ({
          value,
          label: l(value)
        }))
      },
      render: (lead) => (
        <div className="lead-pipeline" aria-label={l("status")}>
          {pipeline.map(([status, Icon]) => (
            <button
              className={`${lead.status === status ? "selected" : ""} pipeline-${status}`}
              disabled={lead.status === "won" || lead.status === "lost" || lead.status === status || pending}
              title={l(status)}
              aria-label={l(status)}
              aria-pressed={lead.status === status}
              onClick={actionHandler(
                () =>
                  status === "won"
                    ? mutate(`/api/v1/crm/leads/${lead.id}/convert`)
                    : mutate(`/api/v1/crm/leads/${lead.id}/status`, { status }),
                fail
              )}
              key={status}
            >
              <Icon size={17} />
            </button>
          ))}
        </div>
      )
    },
    {
      id: "priority",
      label: l("priority"),
      width: 120,
      sort: { asc: "priority_asc", desc: "priority_desc" },
      filter: {
        parameter: "leadPriority",
        options: ["low", "normal", "high", "urgent"].map((value) => ({ value, label: l(value) }))
      },
      render: (lead) => labels[lead.priority] ?? lead.priority
    },
    {
      id: "created",
      label: l("created"),
      width: 140,
      sort: { asc: "created_asc", desc: "created_desc" },
      render: (lead) => formatDate(lead.createdAt)
    },
    {
      id: "actions",
      label: l("actions"),
      locked: true,
      width: 60,
      render: (lead) => (
        <div className="row-actions">
          {lead.status !== "won" && lead.status !== "lost" && (
            <button
              title={l("lost")}
              aria-label={l("lost")}
              onClick={actionHandler(() => mutate(`/api/v1/crm/leads/${lead.id}/status`, { status: "lost" }), fail)}
            >
              <Ban size={16} />
            </button>
          )}
        </div>
      )
    }
  ];
  const customerColumns: SmartColumn<CustomerRow>[] = [
    {
      id: "name",
      label: l("name"),
      locked: true,
      width: 240,
      sort: { asc: "name_asc", desc: "name_desc" },
      render: (customer) => (
        <Link className="customer-link" href={`/${locale}/crm/customers/${customer.id}`}>
          <strong>{customer.displayName}</strong>
          <ArrowRight size={15} />
        </Link>
      )
    },
    { id: "email", label: l("email"), width: 240, render: (customer) => customer.billingEmail ?? "--" },
    { id: "phone", label: l("phone"), width: 160, render: (customer) => customer.phone ?? "--" },
    {
      id: "status",
      label: l("status"),
      width: 110,
      render: (customer) => <span className="state state-active">{customer.status}</span>
    },
    {
      id: "created",
      label: l("created"),
      width: 140,
      sort: { asc: "created_asc", desc: "created_desc" },
      render: (customer) => formatDate(customer.createdAt)
    }
  ];
  const tableLabels = {
    sort: l("sort"),
    filter: l("filter"),
    all: l("all"),
    columns: l("columns"),
    visibility: l("visibility"),
    moveUp: l("moveUp"),
    moveDown: l("moveDown"),
    narrower: l("narrower"),
    wider: l("wider"),
    results: l("results"),
    rows: l("rowsPerPage"),
    previous: l("previous"),
    nextPage: l("nextPage")
  };
  const primaryControls = (
    <>
      <div className="segmented" role="tablist">
        <button aria-selected={tab === "leads"} onClick={() => setTab("leads")}>
          {labels.leads}
          <span>{leads.total}</span>
        </button>
        <button aria-selected={tab === "customers"} onClick={() => setTab("customers")}>
          {labels.customers}
          <span>{customers.total}</span>
        </button>
      </div>
      <InstantSearch placeholder={labels.search ?? ""} resetParams={["leadPage", "customerPage"]} />
    </>
  );

  return (
    <>
      <section className="crm-summary" aria-label={labels.pipeline}>
        <article>
          <span>{labels.activeCustomers}</span>
          <strong>{summary.activeCustomers}</strong>
        </article>
        <article>
          <span>{labels.openTasks}</span>
          <strong>{summary.openTasks}</strong>
        </article>
        <article>
          <span>{labels.overdueTasks}</span>
          <strong>{summary.overdueTasks}</strong>
        </article>
        <article className="pipeline-summary">
          <span>{labels.pipeline}</span>
          <div>
            {pipeline.map(([status, Icon]) => (
              <span className={`pipeline-stage pipeline-${status}`} title={l(status)} key={status}>
                <Icon size={16} />
                <b>{summary.leadsByStatus[status] ?? 0}</b>
                <small>{l(status)}</small>
              </span>
            ))}
          </div>
        </article>
        <div className="crm-commands">
          <a className="secondary-button" href="/api/v1/crm/leads/export">
            <Download size={16} />
            {labels.exportCsv}
          </a>
          <button className="secondary-button" onClick={() => setDialog("import")}>
            <FileUp size={16} />
            {labels.importCsv}
          </button>
          <button className="primary-command" onClick={() => setDialog("lead")}>
            <Plus size={17} />
            {labels.addLead}
          </button>
        </div>
      </section>
      {(loadError || error) && (
        <p className="crm-error" role="alert">
          {error || labels.loadError}
          {error === labels.mfaRequired && <Link href={`/${locale}/security`}>{labels.configureMfa}</Link>}
        </p>
      )}
      <div aria-busy={pending}>
        {tab === "leads" ? (
          <SmartDataTable
            tableId="crm.leads"
            rows={leads.items}
            columns={leadColumns}
            preference={leadPreference}
            total={leads.total}
            page={leads.page}
            pageSize={leads.pageSize}
            pageParam="leadPage"
            pageSizeParam="leadPageSize"
            sortParam="leadSort"
            sort={leadSort}
            sortOptions={[
              { value: "updated_desc", label: l("updatedDesc") },
              { value: "name_asc", label: l("nameAsc") }
            ]}
            empty={l("emptyLeads")}
            labels={tableLabels}
            primaryControls={primaryControls}
          />
        ) : (
          <SmartDataTable
            tableId="crm.customers"
            rows={customers.items}
            columns={customerColumns}
            preference={customerPreference}
            total={customers.total}
            page={customers.page}
            pageSize={customers.pageSize}
            pageParam="customerPage"
            pageSizeParam="customerPageSize"
            sortParam="customerSort"
            sort={customerSort}
            sortOptions={[
              { value: "updated_desc", label: l("updatedDesc") },
              { value: "name_asc", label: l("nameAsc") }
            ]}
            empty={l("emptyCustomers")}
            labels={tableLabels}
            primaryControls={primaryControls}
          />
        )}
      </div>
      {dialog === "lead" && (
        <Dialog title={labels.addLead} close={() => setDialog(null)}>
          <form action={createLead} className="crm-form">
            <Field label={labels.name}>
              <input name="name" required minLength={2} maxLength={160} autoFocus />
            </Field>
            <Field label={labels.company}>
              <input name="companyName" maxLength={160} />
            </Field>
            <Field label={labels.email}>
              <input name="email" type="email" maxLength={254} />
            </Field>
            <Field label={labels.phone}>
              <input name="phone" type="tel" maxLength={40} />
            </Field>
            <Field label={labels.source}>
              <input name="source" defaultValue="manual" required />
            </Field>
            <Field label={labels.priority}>
              <select name="priority" defaultValue="normal">
                <option value="low">{labels.low}</option>
                <option value="normal">{labels.normal}</option>
                <option value="high">{labels.high}</option>
                <option value="urgent">{labels.urgent}</option>
              </select>
            </Field>
            <footer>
              <button type="button" className="secondary-button" onClick={() => setDialog(null)}>
                {labels.cancel}
              </button>
              <button className="primary-command" type="submit">
                {labels.save}
              </button>
            </footer>
          </form>
        </Dialog>
      )}
      {dialog === "import" && (
        <Dialog title={labels.importCsv} close={() => setDialog(null)}>
          <div className="import-panel">
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void file.text().then(setCsv);
              }}
            />
            <div className="import-actions">
              <button
                className="secondary-button"
                disabled={!csv}
                onClick={actionHandler(() => importCsv(false), fail)}
              >
                {labels.preview}
              </button>
              <button
                className="primary-command"
                disabled={!csv || importResults.some((result) => result.status === "error")}
                onClick={actionHandler(() => importCsv(true), fail)}
              >
                {labels.import}
              </button>
            </div>
            {importResults.length > 0 && (
              <ul className="import-results">
                {importResults.map((result) => (
                  <li key={result.row}>
                    #{result.row}{" "}
                    <span className={`state state-${result.status === "error" ? "lost" : "won"}`}>
                      {result.code ?? result.status}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Dialog>
      )}
    </>
  );
}

function Field({ label, children }: { label: string | undefined; children: React.ReactNode }) {
  return (
    <label>
      {label ?? ""}
      {children}
    </label>
  );
}
function Dialog({
  title,
  close,
  children
}: {
  title: string | undefined;
  close: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="dialog-backdrop" role="presentation">
      <section className="crm-dialog" role="dialog" aria-modal="true" aria-labelledby="crm-dialog-title">
        <header>
          <h2 id="crm-dialog-title">{title ?? ""}</h2>
          <button className="icon-button" onClick={close} aria-label={title ?? ""}>
            <X size={18} />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}

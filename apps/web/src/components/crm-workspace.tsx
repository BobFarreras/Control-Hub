"use client";

import { ArrowRight, Download, FileUp, Plus, Search, UserRoundCheck, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

type Lead = { id: string; name: string; companyName: string | null; email: string | null; phone: string | null; source: string; status: string; priority: string; createdAt: string };
type Customer = { id: string; displayName: string; billingEmail: string | null; phone: string | null; status: string; createdAt: string };
type Summary = { leadsByStatus: Record<string, number>; activeCustomers: number; openTasks: number; overdueTasks: number };
type ImportResult = { row: number; status: string; code?: string };
type Labels = Record<string, string>;
const nextStatus: Record<string, string | undefined> = { new: "contacted", contacted: "qualified", qualified: "proposal" };

export function CrmWorkspace({ leads, customers, summary, labels, locale, loadError }: { leads: Lead[]; customers: Customer[]; summary: Summary; labels: Labels; locale: string; loadError: boolean }) {
  const router = useRouter(); const [tab, setTab] = useState<"leads" | "customers">("leads"); const [dialog, setDialog] = useState<"lead" | "import" | null>(null);
  const [error, setError] = useState(""); const [csv, setCsv] = useState(""); const [importResults, setImportResults] = useState<ImportResult[]>([]); const [pending, startTransition] = useTransition();
  const refresh = () => startTransition(() => router.refresh());
  async function request(path: string, init: RequestInit) { const response = await fetch(path, init); if (!response.ok) { const payload = await response.json() as { code?: string }; throw new Error(payload.code ?? "CRM_ERROR"); } return response; }
  async function createLead(formData: FormData) { try { setError(""); const body = Object.fromEntries([...formData.entries()].filter(([, value]) => String(value).trim())); await request("/api/v1/crm/leads", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); setDialog(null); refresh(); } catch (caught) { setError(caught instanceof Error ? caught.message : "CRM_ERROR"); } }
  async function mutate(path: string, body?: object) { try { setError(""); const init: RequestInit = { method: body ? "PATCH" : "POST" }; if (body) { init.headers = { "content-type": "application/json" }; init.body = JSON.stringify(body); } await request(path, init); refresh(); } catch (caught) { setError(caught instanceof Error ? caught.message : "CRM_ERROR"); } }
  async function importCsv(commit: boolean) { try { setError(""); const response = await request("/api/v1/crm/leads/import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ csv, commit }) }); const payload = await response.json() as { results: ImportResult[] }; setImportResults(payload.results); if (commit && payload.results.some((result) => result.status === "imported")) refresh(); } catch (caught) { setError(caught instanceof Error ? caught.message : "CRM_ERROR"); } }
  const formatDate = (value: string) => new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(value));

  return <>
    <section className="crm-summary" aria-label={labels.pipeline}>
      <article><span>{labels.activeCustomers}</span><strong>{summary.activeCustomers}</strong></article>
      <article><span>{labels.openTasks}</span><strong>{summary.openTasks}</strong></article>
      <article><span>{labels.overdueTasks}</span><strong>{summary.overdueTasks}</strong></article>
      <article className="pipeline-summary"><span>{labels.pipeline}</span><div>{["new", "contacted", "qualified", "proposal", "won"].map((status) => <i key={status} title={labels[status]} style={{ flexGrow: Math.max(summary.leadsByStatus[status] ?? 0, 1) }} />)}</div></article>
    </section>
    <div className="crm-toolbar">
      <div className="segmented" role="tablist"><button aria-selected={tab === "leads"} onClick={() => setTab("leads")}>{labels.leads}<span>{leads.length}</span></button><button aria-selected={tab === "customers"} onClick={() => setTab("customers")}>{labels.customers}<span>{customers.length}</span></button></div>
      <form className="crm-search" method="get"><Search size={17} /><input name="search" placeholder={labels.search} /><button type="submit" aria-label={labels.search}><ArrowRight size={17} /></button></form>
      <div className="crm-commands"><a className="secondary-button" href="/api/v1/crm/leads/export"><Download size={16} />{labels.exportCsv}</a><button className="secondary-button" onClick={() => setDialog("import")}><FileUp size={16} />{labels.importCsv}</button><button className="primary-command" onClick={() => setDialog("lead")}><Plus size={17} />{labels.addLead}</button></div>
    </div>
    {(loadError || error) && <p className="crm-error" role="alert">{error || labels.loadError}</p>}
    <div className="crm-table-wrap" aria-busy={pending}>
      {tab === "leads" ? <table className="crm-table"><thead><tr><th>{labels.name}</th><th>{labels.company}</th><th>{labels.status}</th><th>{labels.priority}</th><th>{labels.created}</th><th><span className="sr-only">{labels.actions}</span></th></tr></thead><tbody>{leads.map((lead) => <tr key={lead.id}><td><strong>{lead.name}</strong><small>{lead.email ?? lead.phone ?? "--"}</small></td><td>{lead.companyName ?? "--"}</td><td><span className={`state state-${lead.status}`}>{labels[lead.status] ?? lead.status}</span></td><td>{labels[lead.priority] ?? lead.priority}</td><td>{formatDate(lead.createdAt)}</td><td className="row-actions">{nextStatus[lead.status] && <button title={labels.next} onClick={() => mutate(`/api/v1/crm/leads/${lead.id}/status`, { status: nextStatus[lead.status] })}><ArrowRight size={16} /></button>}{lead.status === "proposal" && <button title={labels.convert} onClick={() => mutate(`/api/v1/crm/leads/${lead.id}/convert`)}><UserRoundCheck size={16} /></button>}</td></tr>)}</tbody></table> : <table className="crm-table"><thead><tr><th>{labels.name}</th><th>{labels.email}</th><th>{labels.phone}</th><th>{labels.status}</th><th>{labels.created}</th></tr></thead><tbody>{customers.map((customer) => <tr key={customer.id}><td><Link className="customer-link" href={`/${locale}/crm/customers/${customer.id}`}><strong>{customer.displayName}</strong><ArrowRight size={15} /></Link></td><td>{customer.billingEmail ?? "--"}</td><td>{customer.phone ?? "--"}</td><td><span className="state state-active">{customer.status}</span></td><td>{formatDate(customer.createdAt)}</td></tr>)}</tbody></table>}
      {tab === "leads" && leads.length === 0 && <p className="crm-empty">{labels.emptyLeads}</p>}{tab === "customers" && customers.length === 0 && <p className="crm-empty">{labels.emptyCustomers}</p>}
    </div>
    {dialog === "lead" && <Dialog title={labels.addLead} close={() => setDialog(null)}><form action={createLead} className="crm-form"><Field label={labels.name}><input name="name" required minLength={2} maxLength={160} autoFocus /></Field><Field label={labels.company}><input name="companyName" maxLength={160} /></Field><Field label={labels.email}><input name="email" type="email" maxLength={254} /></Field><Field label={labels.phone}><input name="phone" type="tel" maxLength={40} /></Field><Field label={labels.source}><input name="source" defaultValue="manual" required /></Field><Field label={labels.priority}><select name="priority" defaultValue="normal"><option value="low">{labels.low}</option><option value="normal">{labels.normal}</option><option value="high">{labels.high}</option><option value="urgent">{labels.urgent}</option></select></Field><footer><button type="button" className="secondary-button" onClick={() => setDialog(null)}>{labels.cancel}</button><button className="primary-command" type="submit">{labels.save}</button></footer></form></Dialog>}
    {dialog === "import" && <Dialog title={labels.importCsv} close={() => setDialog(null)}><div className="import-panel"><input type="file" accept=".csv,text/csv" onChange={(event) => { const file = event.target.files?.[0]; if (file) void file.text().then(setCsv); }} /><div className="import-actions"><button className="secondary-button" disabled={!csv} onClick={() => importCsv(false)}>{labels.preview}</button><button className="primary-command" disabled={!csv || importResults.some((result) => result.status === "error")} onClick={() => importCsv(true)}>{labels.import}</button></div>{importResults.length > 0 && <ul className="import-results">{importResults.map((result) => <li key={result.row}>#{result.row} <span className={`state state-${result.status === "error" ? "lost" : "won"}`}>{result.code ?? result.status}</span></li>)}</ul>}</div></Dialog>}
  </>;
}

function Field({ label, children }: { label: string | undefined; children: React.ReactNode }) { return <label>{label ?? ""}{children}</label>; }
function Dialog({ title, close, children }: { title: string | undefined; close: () => void; children: React.ReactNode }) { return <div className="dialog-backdrop" role="presentation"><section className="crm-dialog" role="dialog" aria-modal="true" aria-labelledby="crm-dialog-title"><header><h2 id="crm-dialog-title">{title ?? ""}</h2><button className="icon-button" onClick={close} aria-label={title ?? ""}><X size={18} /></button></header>{children}</section></div>; }

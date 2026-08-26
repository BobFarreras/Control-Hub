"use client";

import { getCredentialCatalogDictionary, getDictionary, isLocale } from "@control-hub/i18n";
import { Archive, ExternalLink, KeyRound, Plus, RefreshCw, ServerCog, ShieldCheck, X } from "lucide-react";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { AppSidebar } from "@/components/app-sidebar";
import { SelectControl } from "@/components/form-field";
import { PageTopbar } from "@/components/page-topbar";
import type { CredentialCatalogEntry, CustomerRow, Page, PasswordManagerInstallation } from "@/lib/api-types";
import { openCredentialDestination, safeCredentialDestination } from "@/lib/credential-catalog";

type Me = { context: { membershipId: string; permissions: string[]; roles: string[] } };
type Dialog = "entry" | "installation" | null;
const pageSize = 12;

async function payloadOf(response: Response): Promise<Record<string, unknown>> {
  return (await response.json().catch(() => ({}))) as Record<string, unknown>;
}

export default function PasswordsPage() {
  const localeParam = String(useParams().locale);
  const locale = isLocale(localeParam) ? localeParam : "ca";
  const common = getDictionary(locale);
  const t = getCredentialCatalogDictionary(locale);
  const [entries, setEntries] = useState<CredentialCatalogEntry[]>([]);
  const [installations, setInstallations] = useState<PasswordManagerInstallation[]>([]);
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [me, setMe] = useState<Me["context"] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const dialogRef = useRef<HTMLElement>(null);

  const load = async () => {
    const [entryResponse, installationResponse, meResponse, customerResponse] = await Promise.all([
      fetch("/api/v1/credential-catalog"),
      fetch("/api/v1/password-manager/installations"),
      fetch("/api/v1/me"),
      fetch("/api/v1/crm/customers?page=1&pageSize=100")
    ]);
    if (!entryResponse.ok || !installationResponse.ok || !meResponse.ok) return setError(t.loadError);
    const entryPayload = (await entryResponse.json()) as { entries: CredentialCatalogEntry[] };
    const installationPayload = (await installationResponse.json()) as { installations: PasswordManagerInstallation[] };
    setEntries(entryPayload.entries);
    setInstallations(installationPayload.installations);
    setMe(((await meResponse.json()) as Me).context);
    if (customerResponse.ok) setCustomers(((await customerResponse.json()) as Page<CustomerRow>).items);
    setSelectedId((current) => current ?? entryPayload.entries[0]?.id ?? null);
  };

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!dialog) return;
    dialogRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDialog(null);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [dialog]);

  const customerNames = useMemo(
    () => new Map(customers.map((customer) => [customer.id, customer.displayName])),
    [customers]
  );
  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase(locale);
    return entries.filter(
      (entry) =>
        (status === "all" || entry.status === status) &&
        (!query ||
          `${entry.applicationName} ${entry.accountLabel ?? ""} ${customerNames.get(entry.clientId ?? "") ?? ""}`
            .toLocaleLowerCase(locale)
            .includes(query))
    );
  }, [customerNames, entries, locale, search, status]);
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const visible = filtered.slice((Math.min(page, pages) - 1) * pageSize, Math.min(page, pages) * pageSize);
  const selected = entries.find((entry) => entry.id === selectedId) ?? null;
  const canManage = me?.permissions.includes("credentials:manage") ?? false;
  const canConfigure = me?.roles.includes("owner") && me.permissions.includes("vault:manage");

  const messageFor = (code: unknown) =>
    code === "SESSION_NOT_FRESH"
      ? t.freshRequired
      : code === "FORBIDDEN" || code === "PERMISSION_DENIED"
        ? t.forbidden
        : t.operationError;
  async function mutate(url: string, body: Record<string, unknown>) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      });
      const payload = await payloadOf(response);
      if (!response.ok) return setError(messageFor(payload.code));
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function patchStatus(entry: CredentialCatalogEntry, nextStatus: "active" | "revoked") {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/v1/credential-catalog/${entry.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: nextStatus, version: entry.version })
      });
      const payload = await payloadOf(response);
      if (!response.ok) return setError(messageFor(payload.code));
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function openSelected() {
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/v1/credential-catalog/${selected.id}/open-intents`, { method: "POST" });
      const payload = await payloadOf(response);
      if (!response.ok || typeof payload.destination !== "string") return setError(messageFor(payload.code));
      const installation = installations.find((item) => item.id === selected.installationId);
      const destination = installation ? safeCredentialDestination(payload.destination, installation.baseUrl) : null;
      if (!destination) return setError(t.operationError);
      openCredentialDestination(destination);
    } finally {
      setBusy(false);
    }
  }

  async function createEntry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = event.currentTarget;
    const data = new FormData(form);
    try {
      const response = await fetch("/api/v1/credential-catalog", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          installationId: data.get("installationId"),
          clientId: data.get("clientId") || null,
          applicationName: data.get("applicationName"),
          category: data.get("category"),
          environment: data.get("environment"),
          accountLabel: data.get("accountLabel") || null,
          ownerMembershipId: me?.membershipId,
          reviewDueAt: data.get("reviewDueAt") || null,
          opaqueReference: data.get("opaqueReference")
        })
      });
      const payload = await payloadOf(response);
      if (!response.ok) return setError(messageFor(payload.code));
      setDialog(null);
      form.reset();
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function createInstallation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = event.currentTarget;
    const data = new FormData(form);
    try {
      const response = await fetch("/api/v1/password-manager/installations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          displayName: data.get("displayName"),
          baseUrl: data.get("baseUrl"),
          deploymentMode: data.get("deploymentMode")
        })
      });
      const payload = await payloadOf(response);
      if (!response.ok) return setError(messageFor(payload.code));
      setDialog(null);
      form.reset();
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app-shell">
      <AppSidebar locale={locale} labels={common.navigation} />
      <div className="workspace">
        <PageTopbar
          eyebrow={t.eyebrow}
          title={t.title}
          description={t.description}
          themeLabel={common.header.theme}
          back={{ label: common.header.back, fallbackHref: `/${locale}/security` }}
          actions={
            <div className="credential-top-actions">
              {canConfigure && (
                <button className="secondary-button" onClick={() => setDialog("installation")}>
                  <ServerCog size={17} />
                  {t.configure}
                </button>
              )}
              {canManage && (
                <button
                  className="primary-button"
                  disabled={installations.length === 0}
                  onClick={() => setDialog("entry")}
                >
                  <Plus size={17} />
                  {t.add}
                </button>
              )}
            </div>
          }
        />
        <main className="credential-catalog-page">
          {error && (
            <div className="credential-notice" role="alert">
              <ShieldCheck size={18} />
              {error}
            </div>
          )}
          <section className="credential-toolbar" aria-label={t.title}>
            <input
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              placeholder={t.search}
              aria-label={t.search}
            />
            <SelectControl
              aria-label={t.status}
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
                setPage(1);
              }}
              options={[
                { value: "all", label: t.allStatuses },
                ...(["active", "review_due", "revoked", "archived"] as const).map((value) => ({
                  value,
                  label: t[value]
                }))
              ]}
            />
            <span>{filtered.length}</span>
          </section>
          <section className="credential-master-detail">
            <div className="credential-list" role="listbox" aria-label={t.title}>
              {visible.map((entry) => (
                <button
                  key={entry.id}
                  role="option"
                  aria-selected={entry.id === selectedId}
                  className={entry.id === selectedId ? "credential-row selected" : "credential-row"}
                  onClick={() => setSelectedId(entry.id)}
                >
                  <span className="credential-row-icon">
                    <KeyRound size={18} />
                  </span>
                  <span>
                    <strong>{entry.applicationName}</strong>
                    <small>{entry.accountLabel ?? customerNames.get(entry.clientId ?? "") ?? t.noClient}</small>
                  </span>
                  <span className={`status-pill credential-${entry.status}`}>{t[entry.status]}</span>
                </button>
              ))}
              {visible.length === 0 && <p className="credential-empty">{t.empty}</p>}
              <footer className="credential-pagination">
                <button
                  className="icon-button"
                  disabled={page <= 1}
                  aria-label={t.previous}
                  onClick={() => setPage((value) => value - 1)}
                >
                  ‹
                </button>
                <span>
                  {t.page} {Math.min(page, pages)} / {pages}
                </span>
                <button
                  className="icon-button"
                  disabled={page >= pages}
                  aria-label={t.next}
                  onClick={() => setPage((value) => value + 1)}
                >
                  ›
                </button>
              </footer>
            </div>
            <article className="credential-detail">
              {!selected ? (
                <p className="credential-empty">{t.selectEntry}</p>
              ) : (
                <>
                  <header>
                    <div>
                      <span>{customerNames.get(selected.clientId ?? "") ?? t.noClient}</span>
                      <h2>{selected.applicationName}</h2>
                      <p>{selected.accountLabel}</p>
                    </div>
                    <span className={`status-pill credential-${selected.status}`}>{t[selected.status]}</span>
                  </header>
                  <dl>
                    {[
                      [t.category, t[selected.category]],
                      [t.environment, t[selected.environment]],
                      [
                        t.installation,
                        installations.find((item) => item.id === selected.installationId)?.displayName ?? "—"
                      ],
                      [t.owner, selected.ownerMembershipId],
                      [t.review, selected.reviewDueAt ? new Date(selected.reviewDueAt).toLocaleDateString(locale) : "—"]
                    ].map(([label, value]) => (
                      <div key={label}>
                        <dt>{label}</dt>
                        <dd>{value}</dd>
                      </div>
                    ))}
                  </dl>
                  <div className="credential-security-note">
                    <ShieldCheck size={18} />
                    <p>{t.securityNote}</p>
                  </div>
                  <footer>
                    <button
                      className="primary-button"
                      disabled={busy || selected.status === "revoked" || selected.status === "archived"}
                      onClick={() => void openSelected()}
                    >
                      {busy ? <RefreshCw className="spin" size={17} /> : <ExternalLink size={17} />}{" "}
                      {busy ? t.opening : t.open}
                    </button>
                    {canManage && (
                      <button
                        className="secondary-button"
                        disabled={busy}
                        onClick={() =>
                          void mutate(`/api/v1/credential-catalog/${selected.id}/reviews`, {
                            version: selected.version
                          })
                        }
                      >
                        <RefreshCw size={17} />
                        {t.confirmReview}
                      </button>
                    )}
                    {canManage && selected.status !== "archived" && (
                      <button
                        className="secondary-button"
                        disabled={busy}
                        onClick={() =>
                          void mutate(`/api/v1/credential-catalog/${selected.id}/archive`, {
                            version: selected.version
                          })
                        }
                      >
                        <Archive size={17} />
                        {t.archive}
                      </button>
                    )}
                    {canManage && selected.status === "active" && (
                      <button
                        className="secondary-button"
                        disabled={busy}
                        onClick={() => void patchStatus(selected, "revoked")}
                      >
                        {t.revoke}
                      </button>
                    )}
                    {canManage && selected.status === "archived" && (
                      <button
                        className="secondary-button"
                        disabled={busy}
                        onClick={() => void patchStatus(selected, "active")}
                      >
                        {t.restore}
                      </button>
                    )}
                  </footer>
                </>
              )}
            </article>
          </section>
        </main>
      </div>
      {dialog && (
        <div
          className="dialog-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setDialog(null);
          }}
        >
          <section
            ref={dialogRef}
            className="credential-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="credential-dialog-title"
            tabIndex={-1}
          >
            <header>
              <h2 id="credential-dialog-title">{dialog === "entry" ? t.add : t.configure}</h2>
              <button className="icon-button" aria-label={t.close} onClick={() => setDialog(null)}>
                <X size={18} />
              </button>
            </header>
            {dialog === "entry" ? (
              <form onSubmit={(event) => void createEntry(event)}>
                <label>
                  {t.application}
                  <input name="applicationName" required maxLength={160} />
                </label>
                <label>
                  {t.account}
                  <input name="accountLabel" maxLength={320} />
                </label>
                <label>
                  {t.installation}
                  <SelectControl
                    name="installationId"
                    required
                    defaultValue={installations[0]?.id}
                    options={installations.map((item) => ({
                      value: item.id,
                      label: `${item.displayName} · ${new URL(item.baseUrl).host}`
                    }))}
                  />
                </label>
                <label>
                  {t.client}
                  <SelectControl
                    name="clientId"
                    defaultValue=""
                    options={[
                      { value: "", label: t.noClient },
                      ...customers.map((item) => ({ value: item.id, label: item.displayName }))
                    ]}
                  />
                </label>
                <label>
                  {t.category}
                  <SelectControl
                    name="category"
                    defaultValue="other"
                    options={(
                      [
                        "hosting",
                        "email",
                        "domain",
                        "website_admin",
                        "billing",
                        "social",
                        "infrastructure",
                        "other"
                      ] as const
                    ).map((value) => ({ value, label: t[value] }))}
                  />
                </label>
                <label>
                  {t.environment}
                  <SelectControl
                    name="environment"
                    defaultValue="production"
                    options={(["production", "staging", "development", "other"] as const).map((value) => ({
                      value,
                      label: t[value]
                    }))}
                  />
                </label>
                <label>
                  {t.dueAt}
                  <input name="reviewDueAt" type="date" />
                </label>
                <label className="wide">
                  {t.itemLink}
                  <input name="opaqueReference" type="url" inputMode="url" required />
                  <small>{t.itemLinkHint}</small>
                </label>
                <footer>
                  <button type="button" className="secondary-button" onClick={() => setDialog(null)}>
                    {t.cancel}
                  </button>
                  <button className="primary-button" disabled={busy}>
                    {t.save}
                  </button>
                </footer>
              </form>
            ) : (
              <form onSubmit={(event) => void createInstallation(event)}>
                <label>
                  {t.displayName}
                  <input name="displayName" required maxLength={120} />
                </label>
                <label>
                  {t.baseUrl}
                  <input name="baseUrl" type="url" placeholder="https://vault.example.com" required />
                </label>
                <label>
                  {t.deployment}
                  <SelectControl
                    name="deploymentMode"
                    defaultValue="cloud"
                    options={(["cloud", "self_hosted_shared_vps", "self_hosted_dedicated_vps"] as const).map(
                      (value) => ({ value, label: t[value] })
                    )}
                  />
                </label>
                <footer>
                  <button type="button" className="secondary-button" onClick={() => setDialog(null)}>
                    {t.cancel}
                  </button>
                  <button className="primary-button" disabled={busy}>
                    {t.save}
                  </button>
                </footer>
              </form>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

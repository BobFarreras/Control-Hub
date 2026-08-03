"use client";

import { AlertTriangle, CalendarClock, ExternalLink, Plus, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, type FormEvent } from "react";
import { MetricHelp } from "@/components/metric-help";

type Subscription = {
  id: string;
  provider: string;
  serviceName: string;
  category: string;
  status: "active" | "trial" | "canceled";
  currency: string;
  amountMinor: number;
  interval: "monthly" | "quarterly" | "semiannual" | "annual";
  renewalAt: string | null;
  renewalAlertDays: number;
  autoRenew: boolean;
  websiteUrl: string | null;
};
type Labels = Record<string, string>;

export function CompanySubscriptionsWorkspace({
  subscriptions,
  labels: t,
  locale,
  loadError
}: {
  subscriptions: Subscription[];
  labels: Labels;
  locale: string;
  loadError: boolean;
}) {
  const router = useRouter();
  const [dialog, setDialog] = useState(false);
  const [error, setError] = useState("");
  const money = (minor: number, currency: string) =>
    new Intl.NumberFormat(locale, { style: "currency", currency }).format(minor / 100);
  const multiplier = { monthly: 12, quarterly: 4, semiannual: 2, annual: 1 } as const;
  const annual = useMemo(
    () =>
      subscriptions
        .filter((item) => item.status !== "canceled")
        .reduce<Record<string, number>>(
          (totals, item) => ({
            ...totals,
            [item.currency]: (totals[item.currency] ?? 0) + item.amountMinor * multiplier[item.interval]
          }),
          {}
        ),
    [subscriptions]
  );
  const upcoming = subscriptions.filter(
    (item) =>
      item.status !== "canceled" &&
      item.renewalAt &&
      new Date(item.renewalAt).getTime() <= Date.now() + item.renewalAlertDays * 86_400_000
  );
  async function responseError(response: Response) {
    const payload = (await response.json().catch(() => null)) as { code?: string } | null;
    setError(
      payload?.code === "MFA_REQUIRED" ? (t.mfaRequired ?? "MFA_REQUIRED") : (t.formError ?? "OPERATION_FAILED")
    );
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const form = event.currentTarget;
    const data = new FormData(form);
    const renewal = data.get("renewalAt");
    const response = await fetch("/api/v1/company-subscriptions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        provider: data.get("provider"),
        serviceName: data.get("serviceName"),
        category: data.get("category"),
        status: data.get("status"),
        currency: data.get("currency"),
        amountMinor: Math.round(Number(data.get("amount")) * 100),
        interval: data.get("interval"),
        renewalAt: renewal ? new Date(String(renewal)).toISOString() : undefined,
        renewalAlertDays: Number(data.get("alertDays")),
        autoRenew: data.get("autoRenew") === "on",
        websiteUrl: data.get("websiteUrl") || undefined,
        notes: data.get("notes") || undefined
      })
    });
    if (!response.ok) return responseError(response);
    setDialog(false);
    router.refresh();
  }
  async function updateStatus(id: string, status: Subscription["status"]) {
    const response = await fetch(`/api/v1/company-subscriptions/${id}/status`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status })
    });
    if (!response.ok) return responseError(response);
    router.refresh();
  }
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
          {error === t.mfaRequired && <Link href={`/${locale}/security`}>{t.configureMfa}</Link>}
        </p>
      )}
      <section className="expense-summary">
        <article>
          <MetricHelp label={t.annualCost!} description={t.annualCostHelp!} />
          {Object.entries(annual).length ? (
            Object.entries(annual).map(([currency, amount]) => (
              <strong key={currency}>{money(amount, currency)}</strong>
            ))
          ) : (
            <strong>--</strong>
          )}
        </article>
        <article>
          <MetricHelp label={t.upcoming!} description={t.upcomingHelp!} />
          <strong>{upcoming.length}</strong>
        </article>
        <button
          className="primary-command"
          onClick={() => {
            setError("");
            setDialog(true);
          }}
        >
          <Plus size={17} />
          {t.add}
        </button>
      </section>
      <section className="expense-table">
        {subscriptions.length === 0 ? (
          <p className="crm-empty">{t.empty}</p>
        ) : (
          subscriptions.map((item) => (
            <article className="expense-row" key={item.id}>
              <div>
                <strong>{item.serviceName}</strong>
                <small>
                  {item.provider} · {t[item.category]}
                </small>
              </div>
              <strong>
                {money(item.amountMinor, item.currency)} / {t[item.interval]}
              </strong>
              <time>{item.renewalAt ? new Date(item.renewalAt).toLocaleDateString(locale) : "--"}</time>
              <span>
                {t.autoRenew}: {item.autoRenew ? t.yes : t.no}
              </span>
              <select
                aria-label={t.status}
                value={item.status}
                onChange={(event) => updateStatus(item.id, event.target.value as Subscription["status"])}
              >
                <option value="active">{t.active}</option>
                <option value="trial">{t.trial}</option>
                <option value="canceled">{t.canceled}</option>
              </select>
              {item.websiteUrl && (
                <a
                  className="icon-button"
                  href={item.websiteUrl}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={t.website}
                  title={t.website}
                >
                  <ExternalLink size={16} />
                </a>
              )}
            </article>
          ))
        )}
      </section>
      {upcoming.length > 0 && (
        <aside className="expense-renewals">
          <CalendarClock size={19} />
          <h2>{t.upcoming}</h2>
          {upcoming.map((item) => (
            <p key={item.id}>
              <strong>{item.serviceName}</strong>
              <time>{new Date(item.renewalAt!).toLocaleDateString(locale)}</time>
            </p>
          ))}
        </aside>
      )}
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
              <h2>{t.add}</h2>
              <button className="icon-button" onClick={() => setDialog(false)} aria-label={t.cancel}>
                <X size={18} />
              </button>
            </header>
            <form className="commerce-form" onSubmit={submit}>
              <label>
                {t.provider}
                <input name="provider" required maxLength={160} />
              </label>
              <label>
                {t.service}
                <input name="serviceName" required maxLength={160} />
              </label>
              <label>
                {t.category}
                <select name="category">
                  {["saas", "api", "infrastructure", "domain", "license", "other"].map((value) => (
                    <option value={value} key={value}>
                      {t[value]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {t.status}
                <select name="status">
                  <option value="active">{t.active}</option>
                  <option value="trial">{t.trial}</option>
                </select>
              </label>
              <label>
                {t.amount}
                <input name="amount" type="number" min="0" step="0.01" required />
              </label>
              <label>
                {t.currency}
                <input name="currency" defaultValue="EUR" pattern="[A-Za-z]{3}" required />
              </label>
              <label>
                {t.interval}
                <select name="interval">
                  {["monthly", "quarterly", "semiannual", "annual"].map((value) => (
                    <option value={value} key={value}>
                      {t[value]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {t.renewal}
                <input name="renewalAt" type="datetime-local" />
              </label>
              <label>
                {t.alertDays}
                <input name="alertDays" type="number" min="0" max="365" defaultValue="14" required />
              </label>
              <label className="checkbox-label">
                <input name="autoRenew" type="checkbox" defaultChecked />
                {t.autoRenew}
              </label>
              <label className="wide">
                {t.website}
                <input name="websiteUrl" type="url" placeholder="https://" />
              </label>
              <label className="wide">
                {t.notes}
                <textarea name="notes" maxLength={4000} />
              </label>
              {error && (
                <p className="form-error wide">
                  {error}
                  {error === t.mfaRequired && (
                    <>
                      {" "}
                      <Link href={`/${locale}/security`}>{t.configureMfa}</Link>
                    </>
                  )}
                </p>
              )}
              <footer>
                <button className="secondary-button" type="button" onClick={() => setDialog(false)}>
                  {t.cancel}
                </button>
                <button className="primary-command">{t.save}</button>
              </footer>
            </form>
          </section>
        </div>
      )}
    </>
  );
}

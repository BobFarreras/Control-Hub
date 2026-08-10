"use client";

import { AlertTriangle, Download, ExternalLink, KeyRound, Pause, Pencil, Play, Plus, RotateCcw, X } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { SmartDataTable, type SmartColumn } from "@/components/smart-data-table";
import { StatusPill, type StatusTone } from "@/components/status-pill";
import { useToast } from "@/components/toast";
import type { CompanySubscription, TablePreference } from "@/lib/api-types";
import { optionalFormValue } from "@/lib/form";
import { eventHandler } from "@/lib/handlers";

type Labels = Record<string, string>;
type LifecycleAction = "activate" | "pause" | "resume" | "cancel";

const statusTone: Record<CompanySubscription["status"], StatusTone> = {
  active: "active",
  trial: "neutral",
  paused: "warning",
  canceled: "danger"
};

export function CompanySubscriptionsWorkspace({
  subscriptions,
  preference,
  total,
  page,
  pageSize,
  sort,
  labels: t,
  locale,
  loadError,
  renderedAt
}: {
  subscriptions: CompanySubscription[];
  preference: TablePreference;
  total: number;
  page: number;
  pageSize: TablePreference["pageSize"];
  sort: string;
  labels: Labels;
  locale: string;
  loadError: boolean;
  renderedAt: number;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const [createOpen, setCreateOpen] = useState(false);
  const [canceling, setCanceling] = useState<CompanySubscription | null>(null);
  const [editing, setEditing] = useState<CompanySubscription | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const money = (minor: number, currency: string) =>
    new Intl.NumberFormat(locale, { style: "currency", currency }).format(minor / 100);

  async function responseError(response: Response) {
    const payload = (await response.json().catch(() => null)) as { code?: string } | null;
    toast(
      "error",
      payload?.code === "MFA_REQUIRED" ? (t.mfaRequired ?? "MFA_REQUIRED") : (t.formError ?? "OPERATION_FAILED")
    );
  }

  async function createSubscription(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const date = (name: string) => {
      const value = optionalFormValue(data, name);
      return value ? new Date(value).toISOString() : undefined;
    };
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
        renewalAt: date("renewalAt"),
        renewalAlertDays: Number(data.get("alertDays")),
        autoRenew: data.get("autoRenew") === "on",
        websiteUrl: optionalFormValue(data, "websiteUrl") ?? undefined,
        notes: optionalFormValue(data, "notes") ?? undefined,
        accountEmail: optionalFormValue(data, "accountEmail") ?? undefined,
        quantity: Number(data.get("quantity")),
        startedAt: date("startedAt"),
        trialEndsAt: date("trialEndsAt"),
        cancelBeforeAt: date("cancelBeforeAt"),
        costCenter: optionalFormValue(data, "costCenter") ?? undefined,
        paymentMethodLabel: optionalFormValue(data, "paymentMethodLabel") ?? undefined,
        secretManagerUrl: optionalFormValue(data, "secretManagerUrl") ?? undefined
      })
    });
    if (!response.ok) return responseError(response);
    setCreateOpen(false);
    toast("success", t.created ?? "SAVED");
    router.refresh();
  }

  async function transition(subscription: CompanySubscription, action: LifecycleAction, reason?: string) {
    setBusyId(subscription.id);
    const response = await fetch(`/api/v1/company-subscriptions/${subscription.id}/status`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, ...(reason ? { reason } : {}) })
    });
    setBusyId(null);
    if (!response.ok) return responseError(response);
    setCanceling(null);
    toast("success", t.saved ?? "SAVED");
    router.refresh();
  }

  async function updateSubscription(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    setBusyId(editing.id);
    const data = new FormData(event.currentTarget);
    const value = (name: string) => optionalFormValue(data, name);
    const response = await fetch(`/api/v1/company-subscriptions/${editing.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        expectedUpdatedAt: editing.updatedAt,
        provider: data.get("provider"),
        serviceName: data.get("serviceName"),
        category: data.get("category"),
        accountEmail: value("accountEmail"),
        quantity: Number(data.get("quantity")),
        renewalAlertDays: Number(data.get("alertDays")),
        autoRenew: data.get("autoRenew") === "on",
        websiteUrl: value("websiteUrl"),
        notes: value("notes"),
        costCenter: value("costCenter"),
        paymentMethodLabel: value("paymentMethodLabel"),
        secretManagerUrl: value("secretManagerUrl")
      })
    });
    setBusyId(null);
    if (!response.ok) return responseError(response);
    setEditing(null);
    toast("success", t.saved ?? "SAVED");
    router.refresh();
  }

  const columns: SmartColumn<CompanySubscription>[] = [
    {
      id: "service",
      label: t.service!,
      locked: true,
      width: 220,
      sort: { asc: "serviceAsc", desc: "serviceDesc" },
      render: (item) => (
        <div className="expense-service-cell">
          <strong>{item.serviceName}</strong>
          <small>{item.provider}</small>
        </div>
      )
    },
    {
      id: "category",
      label: t.category!,
      width: 120,
      filter: {
        parameter: "category",
        options: ["saas", "api", "infrastructure", "domain", "license", "other"].map((value) => ({
          value,
          label: t[value]!
        }))
      },
      render: (item) => t[item.category]
    },
    {
      id: "account",
      label: t.account!,
      width: 210,
      render: (item) => item.accountEmail ?? "—"
    },
    { id: "owner", label: t.owner!, width: 150, render: (item) => item.ownerName ?? t.unassigned },
    { id: "quantity", label: t.licenses!, width: 90, render: (item) => item.quantity },
    {
      id: "renewal",
      label: t.renewal!,
      width: 145,
      sort: { asc: "renewalAsc", desc: "renewalDesc" },
      filter: {
        parameter: "renewalState",
        options: [
          { value: "due_soon", label: t.dueSoon! },
          { value: "missing", label: t.missingRenewal! }
        ]
      },
      render: (item) => {
        const dueSoon =
          item.renewalAt !== null &&
          item.status !== "canceled" &&
          new Date(item.renewalAt).getTime() <= renderedAt + item.renewalAlertDays * 86_400_000;
        return (
          <time className={dueSoon ? "renewal-due" : undefined}>
            {item.renewalAt ? new Date(item.renewalAt).toLocaleDateString(locale) : "—"}
          </time>
        );
      }
    },
    {
      id: "cost",
      label: t.amount!,
      width: 150,
      sort: { asc: "renewalAsc", desc: "costDesc" },
      render: (item) =>
        item.financials ? (
          <span className="expense-money">
            {money(item.financials.amountMinor, item.financials.currency)} / {t[item.financials.interval]}
          </span>
        ) : (
          <span className="muted">{t.restricted}</span>
        )
    },
    {
      id: "status",
      label: t.status!,
      width: 130,
      filter: {
        parameter: "status",
        options: ["trial", "active", "paused", "canceled"].map((value) => ({ value, label: t[value]! }))
      },
      render: (item) => <StatusPill tone={statusTone[item.status]} label={t[item.status]!} />
    },
    {
      id: "actions",
      label: t.actions!,
      locked: true,
      width: 170,
      render: (item) => (
        <div className="table-action-group">
          {item.status !== "canceled" && (
            <button
              className="icon-button"
              disabled={busyId === item.id}
              onClick={() => setEditing(item)}
              title={t.edit}
            >
              <Pencil size={15} />
            </button>
          )}
          {item.status === "trial" && (
            <button
              className="icon-button"
              disabled={busyId === item.id}
              onClick={() => void transition(item, "activate")}
              title={t.activate}
            >
              <Play size={15} />
            </button>
          )}
          {item.status === "active" && (
            <button
              className="icon-button"
              disabled={busyId === item.id}
              onClick={() => void transition(item, "pause")}
              title={t.pause}
            >
              <Pause size={15} />
            </button>
          )}
          {item.status === "paused" && (
            <button
              className="icon-button"
              disabled={busyId === item.id}
              onClick={() => void transition(item, "resume")}
              title={t.resume}
            >
              <RotateCcw size={15} />
            </button>
          )}
          {item.status !== "canceled" && (
            <button
              className="icon-button danger"
              disabled={busyId === item.id}
              onClick={() => setCanceling(item)}
              title={t.cancel}
            >
              <X size={15} />
            </button>
          )}
          {item.websiteUrl && (
            <a className="icon-button" href={item.websiteUrl} target="_blank" rel="noreferrer" title={t.website}>
              <ExternalLink size={15} />
            </a>
          )}
          {item.secretManagerUrl && (
            <a
              className="icon-button"
              href={item.secretManagerUrl}
              target="_blank"
              rel="noreferrer"
              title={t.secretManager}
            >
              <KeyRound size={15} />
            </a>
          )}
        </div>
      )
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
      <SmartDataTable
        tableId="company-subscriptions"
        rows={subscriptions}
        columns={columns}
        preference={preference}
        total={total}
        page={page}
        pageSize={pageSize}
        pageParam="page"
        pageSizeParam="pageSize"
        sortParam="sort"
        sort={sort}
        sortOptions={[
          { value: "renewalAsc", label: t.renewalAsc! },
          { value: "renewalDesc", label: t.renewalDesc! },
          { value: "serviceAsc", label: t.serviceAsc! },
          { value: "serviceDesc", label: t.serviceDesc! },
          { value: "costDesc", label: t.costDesc! }
        ]}
        empty={t.empty!}
        labels={t}
        primaryControls={
          <>
            <button className="primary-command" onClick={() => setCreateOpen(true)}>
              <Plus size={17} />
              {t.add}
            </button>
            <a
              className="secondary-button"
              href={`/api/v1/company-subscriptions/export?${new URLSearchParams([
                ...[...searchParams.entries()].filter(([key]) => ["status", "category", "renewalState"].includes(key)),
                ["locale", locale]
              ]).toString()}`}
            >
              <Download size={16} />
              {t.exportExcel}
            </a>
          </>
        }
      />
      {createOpen && (
        <div
          className="dialog-backdrop"
          role="presentation"
          onMouseDown={(event) => event.target === event.currentTarget && setCreateOpen(false)}
        >
          <section className="crm-dialog expense-dialog" role="dialog" aria-modal="true">
            <header>
              <h2>{t.add}</h2>
              <button className="icon-button" onClick={() => setCreateOpen(false)} aria-label={t.cancel}>
                <X size={18} />
              </button>
            </header>
            <form
              className="commerce-form"
              onSubmit={eventHandler(createSubscription, () => toast("error", t.formError!))}
            >
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
                {t.account}
                <input name="accountEmail" maxLength={320} />
              </label>
              <label>
                {t.licenses}
                <input name="quantity" type="number" min="1" max="1000000" defaultValue="1" required />
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
                {t.startedAt}
                <input name="startedAt" type="datetime-local" />
              </label>
              <label>
                {t.trialEndsAt}
                <input name="trialEndsAt" type="datetime-local" />
              </label>
              <label>
                {t.renewal}
                <input name="renewalAt" type="datetime-local" />
              </label>
              <label>
                {t.cancelBeforeAt}
                <input name="cancelBeforeAt" type="datetime-local" />
              </label>
              <label>
                {t.alertDays}
                <input name="alertDays" type="number" min="0" max="365" defaultValue="14" required />
              </label>
              <label>
                {t.costCenter}
                <input name="costCenter" maxLength={120} />
              </label>
              <label>
                {t.paymentMethod}
                <input name="paymentMethodLabel" maxLength={120} />
              </label>
              <label>
                {t.website}
                <input name="websiteUrl" type="url" placeholder="https://" />
              </label>
              <label>
                {t.secretManager}
                <input name="secretManagerUrl" type="url" placeholder="https://" />
              </label>
              <label className="checkbox-label">
                <input name="autoRenew" type="checkbox" defaultChecked />
                {t.autoRenew}
              </label>
              <label className="wide">
                {t.notes}
                <textarea name="notes" maxLength={4000} />
              </label>
              <footer>
                <button className="secondary-button" type="button" onClick={() => setCreateOpen(false)}>
                  {t.cancel}
                </button>
                <button className="primary-command">{t.save}</button>
              </footer>
            </form>
          </section>
        </div>
      )}
      {canceling && (
        <div
          className="dialog-backdrop"
          role="presentation"
          onMouseDown={(event) => event.target === event.currentTarget && setCanceling(null)}
        >
          <section className="crm-dialog compact-dialog" role="dialog" aria-modal="true">
            <header>
              <h2>{t.cancelExpense}</h2>
              <button className="icon-button" onClick={() => setCanceling(null)} aria-label={t.cancel}>
                <X size={18} />
              </button>
            </header>
            <form
              onSubmit={eventHandler(
                async (event) => {
                  event.preventDefault();
                  const reason = optionalFormValue(new FormData(event.currentTarget), "reason") ?? "";
                  await transition(canceling, "cancel", reason);
                },
                () => toast("error", t.formError!)
              )}
            >
              <p>{canceling.serviceName}</p>
              <label>
                {t.cancelReason}
                <textarea name="reason" minLength={3} maxLength={500} required />
              </label>
              <footer>
                <button className="secondary-button" type="button" onClick={() => setCanceling(null)}>
                  {t.close}
                </button>
                <button className="danger-button" disabled={busyId === canceling.id}>
                  {t.confirmCancel}
                </button>
              </footer>
            </form>
          </section>
        </div>
      )}
      {editing && (
        <div
          className="dialog-backdrop"
          role="presentation"
          onMouseDown={(event) => event.target === event.currentTarget && setEditing(null)}
        >
          <section className="crm-dialog expense-dialog" role="dialog" aria-modal="true">
            <header>
              <h2>{t.editExpense}</h2>
              <button className="icon-button" onClick={() => setEditing(null)} aria-label={t.close}>
                <X size={18} />
              </button>
            </header>
            <form
              className="commerce-form"
              onSubmit={eventHandler(updateSubscription, () => toast("error", t.formError!))}
            >
              <label>
                {t.provider}
                <input name="provider" defaultValue={editing.provider} required maxLength={160} />
              </label>
              <label>
                {t.service}
                <input name="serviceName" defaultValue={editing.serviceName} required maxLength={160} />
              </label>
              <label>
                {t.category}
                <select name="category" defaultValue={editing.category}>
                  {["saas", "api", "infrastructure", "domain", "license", "other"].map((item) => (
                    <option value={item} key={item}>
                      {t[item]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {t.account}
                <input name="accountEmail" defaultValue={editing.accountEmail ?? ""} maxLength={320} />
              </label>
              <label>
                {t.licenses}
                <input name="quantity" type="number" min="1" max="1000000" defaultValue={editing.quantity} required />
              </label>
              <label>
                {t.alertDays}
                <input
                  name="alertDays"
                  type="number"
                  min="0"
                  max="365"
                  defaultValue={editing.renewalAlertDays}
                  required
                />
              </label>
              <label>
                {t.costCenter}
                <input name="costCenter" defaultValue={editing.costCenter ?? ""} maxLength={120} />
              </label>
              <label>
                {t.paymentMethod}
                <input name="paymentMethodLabel" defaultValue={editing.paymentMethodLabel ?? ""} maxLength={120} />
              </label>
              <label>
                {t.website}
                <input name="websiteUrl" type="url" defaultValue={editing.websiteUrl ?? ""} />
              </label>
              <label>
                {t.secretManager}
                <input name="secretManagerUrl" type="url" defaultValue={editing.secretManagerUrl ?? ""} />
              </label>
              <label className="checkbox-label">
                <input name="autoRenew" type="checkbox" defaultChecked={editing.autoRenew} />
                {t.autoRenew}
              </label>
              <label className="wide">
                {t.notes}
                <textarea name="notes" defaultValue={editing.notes ?? ""} maxLength={4000} />
              </label>
              <footer>
                <button className="secondary-button" type="button" onClick={() => setEditing(null)}>
                  {t.close}
                </button>
                <button className="primary-command" disabled={busyId === editing.id}>
                  {t.saveChanges}
                </button>
              </footer>
            </form>
          </section>
        </div>
      )}
    </>
  );
}

"use client";

import { AlertTriangle, Info, Receipt, Wallet } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { SelectField, TextField } from "@/components/form-field";
import type { BillingRate, CostRate, CustomerOption, Member, ProjectRow } from "@/lib/api-types";
import { formValue } from "@/lib/form";
import { formatMoney } from "@/lib/format";
import { eventHandler } from "@/lib/handlers";
import { parseAmountToMinor } from "@/lib/money";

type Labels = Record<string, string>;

/** The currencies the business actually invoices in. A free text field here invites `EURO`. */
const currencies = ["EUR", "USD", "GBP", "CHF"] as const;

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Which rows are still in force, per group.
 *
 * A published rate is never edited, so a group accumulates rows and only the most recent one that
 * has already started applies. Marking that row is the difference between a list somebody can read
 * and a pile of numbers they have to date-sort in their head.
 */
function currentIds<T extends { id: string; effectiveFrom: string }>(rows: T[], key: (row: T) => string): Set<string> {
  const best = new Map<string, T>();
  for (const row of rows) {
    if (row.effectiveFrom > today()) continue;
    const group = key(row);
    const held = best.get(group);
    if (!held || row.effectiveFrom > held.effectiveFrom) best.set(group, row);
  }
  return new Set([...best.values()].map((row) => row.id));
}

export function RatesWorkspace({
  cost,
  billing,
  members,
  customers,
  projects,
  loadError,
  labels: t,
  locale
}: {
  cost: CostRate[];
  billing: BillingRate[];
  members: Member[];
  customers: CustomerOption[];
  projects: ProjectRow[];
  loadError: boolean;
  labels: Labels;
  locale: string;
}) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [scope, setScope] = useState<"customer" | "project">("customer");
  const fail = () => setError(t.formError ?? "OPERATION_FAILED");

  const currentCost = currentIds(cost, (rate) => `${rate.membershipId}:${rate.currency}`);
  const currentBilling = currentIds(billing, (rate) => `${rate.scope}:${rate.scopeId}:${rate.currency}`);

  async function publish(path: string, body: unknown) {
    setBusy(true);
    setError("");
    const response = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
    setBusy(false);
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { code?: string } | null;
      setError(payload?.code === "DUPLICATE_RATE" ? (t.duplicate ?? "") : (t.formError ?? ""));
      return false;
    }
    router.refresh();
    return true;
  }

  /** Reads the amount and refuses the form before sending anything the API would reject anyway. */
  function readAmount(data: FormData): number | null {
    const parsed = parseAmountToMinor(formValue(data, "amount"));
    if ("minor" in parsed) return parsed.minor;
    const messages: Record<string, string | undefined> = {
      empty: t.emptyAmount,
      negative: t.negativeAmount,
      "too-precise": t.invalidAmount,
      "not-a-number": t.invalidAmount
    };
    setError(messages[parsed.error] ?? t.invalidAmount ?? "");
    return null;
  }

  async function publishCost(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const minor = readAmount(data);
    if (minor === null) return;
    const saved = await publish("/api/v1/rates/cost", {
      membershipId: formValue(data, "membershipId"),
      currency: formValue(data, "currency"),
      costMinorPerHour: minor,
      effectiveFrom: formValue(data, "effectiveFrom")
    });
    if (saved) form.reset();
  }

  async function publishBilling(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const minor = readAmount(data);
    if (minor === null) return;
    const saved = await publish("/api/v1/rates/billing", {
      scope,
      scopeId: formValue(data, "scopeId"),
      currency: formValue(data, "currency"),
      amountMinorPerHour: minor,
      effectiveFrom: formValue(data, "effectiveFrom")
    });
    if (saved) form.reset();
  }

  const currencyOptions = currencies.map((code) => ({ value: code, label: code }));

  return (
    <div className="project-detail">
      {loadError && (
        <p className="crm-error" role="alert">
          <AlertTriangle size={17} aria-hidden="true" />
          {t.loadError}
        </p>
      )}
      {error && (
        <p className="crm-error" role="alert">
          <AlertTriangle size={17} aria-hidden="true" />
          {error}
        </p>
      )}

      {/* Said once, at the top: it explains both tables and it is the whole reason they look like
          a log rather than a settings screen. */}
      <p className="notice notice-info">
        <Info size={17} aria-hidden="true" />
        <span>{t.appendOnlyNote}</span>
      </p>

      <section className="project-panel" aria-label={t.costTitle}>
        <header className="project-panel-heading">
          <h3>
            <Wallet size={17} aria-hidden="true" />
            {t.costTitle}
          </h3>
          <p>{t.costDescription}</p>
        </header>

        <form className="rate-form" onSubmit={eventHandler(publishCost, fail)}>
          <SelectField
            label={t.member!}
            name="membershipId"
            required
            disabled={busy || members.length === 0}
            options={members.map((member) => ({ value: member.id, label: member.name }))}
          />
          <TextField
            label={t.amount!}
            name="amount"
            required
            inputMode="decimal"
            maxLength={12}
            placeholder="45,50"
            hint={t.amountHint}
            data-mono="true"
            autoComplete="off"
            disabled={busy || members.length === 0}
          />
          <SelectField
            label={t.currency!}
            name="currency"
            defaultValue="EUR"
            disabled={busy || members.length === 0}
            options={currencyOptions}
          />
          <TextField
            label={t.effectiveFrom!}
            name="effectiveFrom"
            type="date"
            required
            defaultValue={today()}
            data-mono="true"
            disabled={busy || members.length === 0}
          />
          <button className="primary-button" disabled={busy || members.length === 0}>
            {t.publish}
          </button>
        </form>
        {members.length === 0 && <p className="crm-empty">{t.noMembers}</p>}

        <RateTable
          rows={cost.map((rate) => ({
            id: rate.id,
            who: rate.memberName ?? rate.membershipId,
            amount: formatMoney(rate.costMinorPerHour, rate.currency, locale),
            effectiveFrom: rate.effectiveFrom,
            current: currentCost.has(rate.id)
          }))}
          headings={[t.member!, t.amount!, t.effectiveFrom!]}
          empty={t.emptyCost!}
          labels={t}
        />
      </section>

      <section className="project-panel" aria-label={t.billingTitle}>
        <header className="project-panel-heading">
          <h3>
            <Receipt size={17} aria-hidden="true" />
            {t.billingTitle}
          </h3>
          <p>{t.billingDescription}</p>
        </header>

        <form className="rate-form" onSubmit={eventHandler(publishBilling, fail)}>
          <SelectField
            label={t.scope!}
            name="scope"
            value={scope}
            onChange={(event) => setScope(event.target.value as "customer" | "project")}
            disabled={busy}
            options={[
              { value: "customer", label: t.scopeCustomer ?? "customer" },
              { value: "project", label: t.scopeProject ?? "project" }
            ]}
          />
          {/* Keyed on the scope so React rebuilds the select instead of keeping a selected value
              that belongs to the other list. */}
          <SelectField
            key={scope}
            label={scope === "customer" ? t.scopeCustomer! : t.scopeProject!}
            name="scopeId"
            required
            disabled={busy}
            options={
              scope === "customer"
                ? customers.map((customer) => ({ value: customer.id, label: customer.displayName }))
                : projects.map((project) => ({ value: project.id, label: `${project.code} · ${project.name}` }))
            }
          />
          <TextField
            label={t.amount!}
            name="amount"
            required
            inputMode="decimal"
            maxLength={12}
            placeholder="90,00"
            hint={t.amountHint}
            data-mono="true"
            autoComplete="off"
            disabled={busy}
          />
          <SelectField
            label={t.currency!}
            name="currency"
            defaultValue="EUR"
            disabled={busy}
            options={currencyOptions}
          />
          <TextField
            label={t.effectiveFrom!}
            name="effectiveFrom"
            type="date"
            required
            defaultValue={today()}
            data-mono="true"
            disabled={busy}
          />
          <button className="primary-button" disabled={busy}>
            {t.publish}
          </button>
        </form>

        <RateTable
          rows={billing.map((rate) => ({
            id: rate.id,
            who: `${rate.scope === "project" ? t.scopeProject : t.scopeCustomer} · ${rate.scopeName ?? rate.scopeId}`,
            amount: formatMoney(rate.amountMinorPerHour, rate.currency, locale),
            effectiveFrom: rate.effectiveFrom,
            current: currentBilling.has(rate.id)
          }))}
          headings={[t.scope!, t.amount!, t.effectiveFrom!]}
          empty={t.emptyBilling!}
          labels={t}
        />
      </section>
    </div>
  );
}

type RateRow = { id: string; who: string; amount: string; effectiveFrom: string; current: boolean };

/**
 * The published rates, most recent first, with the one in force marked.
 *
 * The marker is a word, not a colour or a row weight: "in force" and "superseded" have to survive
 * a printout and a greyscale screen, and this is the table somebody checks before quoting a price.
 */
function RateTable({
  rows,
  headings,
  empty,
  labels: t
}: {
  rows: RateRow[];
  headings: string[];
  empty: string;
  labels: Labels;
}) {
  if (rows.length === 0) return <p className="crm-empty">{empty}</p>;
  return (
    <div className="crm-table-wrap inside-panel">
      <table className="crm-table project-money">
        <thead>
          <tr>
            {headings.map((heading) => (
              <th key={heading}>{heading}</th>
            ))}
            <th>{t.history}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <th scope="row">{row.who}</th>
              <td>
                {row.amount}
                <span className="rate-unit">{t.perHour}</span>
              </td>
              <td>
                <time dateTime={row.effectiveFrom}>{row.effectiveFrom}</time>
              </td>
              <td>
                <span className={row.current ? "rate-state current" : "rate-state"}>
                  {row.current ? t.current : t.superseded}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

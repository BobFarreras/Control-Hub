"use client";

import { AlertTriangle, Layers, Receipt, RotateCcw, Wallet, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { SelectField, TextField } from "@/components/form-field";
import { HelpTip } from "@/components/help";
import type {
  BillingRate,
  BillingScope,
  CostRate,
  CustomerOption,
  Member,
  ProjectRow,
  ServiceType
} from "@/lib/api-types";
import { formValue } from "@/lib/form";
import { formatMoney } from "@/lib/format";
import { actionHandler, eventHandler } from "@/lib/handlers";
import { parseAmountToMinor } from "@/lib/money";
import { toServiceCode } from "@/lib/slug";

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
function currentIds<T extends { id: string; effectiveFrom: string; annulledAt: string | null }>(
  rows: T[],
  key: (row: T) => string
): Set<string> {
  const best = new Map<string, T>();
  for (const row of rows) {
    if (row.annulledAt || row.effectiveFrom > today()) continue;
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
  serviceTypes,
  loadError,
  labels: t,
  locale
}: {
  cost: CostRate[];
  billing: BillingRate[];
  members: Member[];
  customers: CustomerOption[];
  projects: ProjectRow[];
  serviceTypes: ServiceType[];
  loadError: boolean;
  labels: Labels;
  locale: string;
}) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [scope, setScope] = useState<BillingScope>("customer");
  /**
   * The code of the service type being written.
   *
   * Held here rather than left to the input so it can follow the name, and reset to following it
   * whenever the field is emptied. Typing in it directly takes it over: a code somebody chose on
   * purpose should not be rewritten by the next keystroke in the name.
   */
  const [code, setCode] = useState("");
  const [codeTouched, setCodeTouched] = useState(false);
  /** The service type whose removal is being confirmed, if any. */
  const [removing, setRemoving] = useState<ServiceType | null>(null);
  const fail = () => setError(t.formError ?? "OPERATION_FAILED");

  const scopeNames: Record<BillingScope, string | undefined> = {
    customer: t.scopeCustomer,
    project: t.scopeProject,
    service_type: t.scopeServiceType
  };

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

  /** Withdraws a published rate. The row survives; what changes is that it stops resolving. */
  async function annul(kind: "cost" | "billing", rateId: string) {
    setBusy(true);
    setError("");
    const response = await fetch(`/api/v1/rates/${kind}/${rateId}/annul`, { method: "POST" });
    setBusy(false);
    if (!response.ok) {
      setError(t.annulError ?? "");
      return;
    }
    router.refresh();
  }

  /**
   * Removes a kind of work, or deactivates it when a published rate makes removal impossible.
   *
   * Both live here because from the screen they are one decision -- "get this out of my way" -- and
   * which of the two happens is a fact about the data, not something to ask about.
   */
  async function removeServiceType(serviceType: ServiceType) {
    setBusy(true);
    setError("");
    const response =
      serviceType.rateCount > 0
        ? await fetch(`/api/v1/service-types/${serviceType.id}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ active: false })
          })
        : await fetch(`/api/v1/service-types/${serviceType.id}`, { method: "DELETE" });
    setBusy(false);
    setRemoving(null);
    if (!response.ok) {
      setError(t.removeServiceError ?? "");
      return;
    }
    router.refresh();
  }

  async function reactivateServiceType(serviceType: ServiceType) {
    setBusy(true);
    setError("");
    const response = await fetch(`/api/v1/service-types/${serviceType.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ active: true })
    });
    setBusy(false);
    if (!response.ok) {
      setError(t.removeServiceError ?? "");
      return;
    }
    router.refresh();
  }

  async function addServiceType(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy(true);
    setError("");
    const response = await fetch("/api/v1/service-types", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: formValue(data, "code"), name: formValue(data, "name") })
    });
    setBusy(false);
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { code?: string } | null;
      const messages: Record<string, string | undefined> = {
        DUPLICATE_SERVICE_TYPE: t.duplicateService,
        INVALID_CODE: t.invalidServiceCode
      };
      setError(messages[payload?.code ?? ""] ?? t.serviceFormError ?? "");
      return;
    }
    form.reset();
    setCode("");
    setCodeTouched(false);
    router.refresh();
  }

  const currencyOptions = currencies.map((code) => ({ value: code, label: code }));

  /** What the chosen scope is picked from, and what the picker is called once it is chosen. */
  const scopeOptions: Record<BillingScope, { label: string; options: { value: string; label: string }[] }> = {
    customer: {
      label: t.scopeCustomer!,
      options: customers.map((customer) => ({ value: customer.id, label: customer.displayName }))
    },
    project: {
      label: t.scopeProject!,
      options: projects.map((project) => ({ value: project.id, label: `${project.code} · ${project.name}` }))
    },
    service_type: {
      label: t.scopeServiceType!,
      // Only the ones still on offer: a deactivated kind of work exists for the history of the
      // rates already filed under it, not to have new ones filed under it.
      options: serviceTypes.filter((type) => type.active).map((type) => ({ value: type.id, label: type.name }))
    }
  };

  return (
    <div className="project-detail">
      {loadError && (
        <p className="notice notice-danger" role="alert">
          <AlertTriangle size={17} aria-hidden="true" />
          {t.loadError}
        </p>
      )}
      {error && (
        <p className="notice notice-danger" role="alert">
          <AlertTriangle size={17} aria-hidden="true" />
          {error}
        </p>
      )}

      <section className="project-panel" aria-label={t.serviceTitle}>
        <div className="panel-row">
          <h3>
            <Layers size={17} aria-hidden="true" />
            {t.serviceTitle}
            <HelpTip label={t.serviceTitle!} description={t.serviceDescription!} />
          </h3>
          <form className="rate-form service-form" onSubmit={eventHandler(addServiceType, fail)}>
            <TextField
              label={t.serviceName!}
              name="name"
              required
              maxLength={120}
              placeholder="Pagina web"
              autoComplete="off"
              disabled={busy}
              onChange={(event) => {
                if (!codeTouched) setCode(toServiceCode(event.target.value));
              }}
            />
            <TextField
              label={t.serviceCode!}
              name="code"
              maxLength={48}
              placeholder="pagina-web"
              hint={t.serviceCodeHint}
              data-mono="true"
              autoComplete="off"
              disabled={busy}
              value={code}
              onChange={(event) => {
                const written = event.target.value;
                setCode(written);
                // Emptying it hands control back to the name, which is the only way out of having
                // taken it over by accident.
                setCodeTouched(written.length > 0);
              }}
              onBlur={(event) => setCode(toServiceCode(event.target.value))}
            />
            <button className="primary-button" disabled={busy}>
              {t.serviceAdd}
            </button>
          </form>
        </div>
        {serviceTypes.length === 0 ? (
          <p className="crm-empty">{t.emptyServices}</p>
        ) : (
          <ul className="chip-list">
            {serviceTypes.map((type) => (
              <li key={type.id} className={type.active ? "chip" : "chip inactive"}>
                {/* The name alone. The code is what a rate is filed under internally and nobody
                    reads it here, so showing both said one thing twice. */}
                <span className="chip-label">{type.name}</span>
                {type.projectCount > 0 && (
                  <span className="chip-count" aria-label={`${type.projectCount} ${t.linkedProjects}`}>
                    {type.projectCount}
                  </span>
                )}
                {type.active ? (
                  <button
                    type="button"
                    className="chip-remove"
                    disabled={busy}
                    aria-label={`${t.removeService} · ${type.name}`}
                    onClick={() => setRemoving(type)}
                  >
                    <X size={13} aria-hidden="true" />
                  </button>
                ) : (
                  <button
                    type="button"
                    className="chip-remove"
                    disabled={busy}
                    aria-label={`${t.reactivateService} · ${type.name}`}
                    onClick={actionHandler(() => reactivateServiceType(type), fail)}
                  >
                    <RotateCcw size={13} aria-hidden="true" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="project-panel" aria-label={t.costTitle}>
        <div className="panel-row">
          <h3>
            <Wallet size={17} aria-hidden="true" />
            {t.costTitle}
            <HelpTip label={t.costTitle!} description={t.costDescription!} />
          </h3>
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
        </div>
        {members.length === 0 && <p className="crm-empty">{t.noMembers}</p>}

        <RateTable
          rows={cost.map((rate) => ({
            id: rate.id,
            who: rate.memberName ?? rate.membershipId,
            amount: formatMoney(rate.costMinorPerHour, rate.currency, locale),
            effectiveFrom: rate.effectiveFrom,
            current: currentCost.has(rate.id),
            annulledBy: rate.annulledAt ? rate.annulledByName : null,
            annulled: Boolean(rate.annulledAt)
          }))}
          headings={[t.member!, t.amount!, t.effectiveFrom!]}
          empty={t.emptyCost!}
          onAnnul={actionHandler((id: string) => annul("cost", id), fail)}
          busy={busy}
          labels={t}
        />
      </section>

      <section className="project-panel" aria-label={t.billingTitle}>
        <div className="panel-row">
          <h3>
            <Receipt size={17} aria-hidden="true" />
            {t.billingTitle}
            <HelpTip label={t.billingTitle!} description={t.billingDescription!} />
          </h3>
          <form className="rate-form with-scope" onSubmit={eventHandler(publishBilling, fail)}>
            <SelectField
              label={t.scope!}
              name="scope"
              value={scope}
              onChange={(event) => setScope(event.target.value as BillingScope)}
              disabled={busy}
              options={[
                { value: "customer", label: t.scopeCustomer ?? "customer" },
                { value: "project", label: t.scopeProject ?? "project" },
                { value: "service_type", label: t.scopeServiceType ?? "service type" }
              ]}
            />
            {/* Keyed on the scope so React rebuilds the select instead of keeping a selected value
              that belongs to the other list. */}
            <SelectField
              key={scope}
              label={scopeOptions[scope].label}
              name="scopeId"
              required
              disabled={busy || scopeOptions[scope].options.length === 0}
              options={scopeOptions[scope].options}
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
        </div>

        <RateTable
          rows={billing.map((rate) => ({
            id: rate.id,
            who: `${scopeNames[rate.scope]} · ${rate.scopeName ?? rate.scopeId}`,
            amount: formatMoney(rate.amountMinorPerHour, rate.currency, locale),
            effectiveFrom: rate.effectiveFrom,
            current: currentBilling.has(rate.id),
            annulledBy: rate.annulledAt ? rate.annulledByName : null,
            annulled: Boolean(rate.annulledAt)
          }))}
          headings={[t.scope!, t.amount!, t.effectiveFrom!]}
          empty={t.emptyBilling!}
          onAnnul={actionHandler((id: string) => annul("billing", id), fail)}
          busy={busy}
          labels={t}
        />
      </section>

      {removing && (
        <RemovalDialog
          serviceType={removing}
          busy={busy}
          labels={t}
          onCancel={() => setRemoving(null)}
          onConfirm={actionHandler(() => removeServiceType(removing), fail)}
        />
      )}
    </div>
  );
}

/**
 * What removing a kind of work is about to do, in words, before it happens.
 *
 * Three different things can happen and the difference matters to whoever is clicking, so the dialog
 * says which one it is instead of asking "are you sure?" three times over:
 *
 * - nothing depends on it, so it goes;
 * - projects are of this kind, so they lose it and will need a rate of their own;
 * - a rate has been published under it, so it cannot go at all and gets deactivated instead.
 */
function RemovalDialog({
  serviceType,
  busy,
  labels: t,
  onCancel,
  onConfirm
}: {
  serviceType: ServiceType;
  busy: boolean;
  labels: Labels;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const hasRates = serviceType.rateCount > 0;
  const body = hasRates
    ? t.removeServiceHasRates
    : serviceType.projectCount > 0
      ? (t.removeServiceHasProjects ?? "").replace("{count}", String(serviceType.projectCount))
      : t.removeServiceUnused;

  return (
    <div className="dialog-backdrop" role="presentation" onClick={onCancel}>
      {/* Stops a click inside the dialog from reaching the backdrop that closes it. */}
      <section
        className="help-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="remove-service-heading"
        onClick={(event) => event.stopPropagation()}
      >
        <header>
          <h2 id="remove-service-heading">
            {hasRates ? t.deactivateServiceTitle : t.removeServiceTitle} · {serviceType.name}
          </h2>
        </header>
        <p>{body}</p>
        {hasRates && <p className="dialog-note">{t.removeServiceRatesNote}</p>}
        <footer className="dialog-actions">
          <button type="button" className="secondary-button" onClick={onCancel} disabled={busy}>
            {t.annulCancel}
          </button>
          <button type="button" className="danger-button" onClick={onConfirm} disabled={busy}>
            {hasRates ? t.deactivateService : t.removeService}
          </button>
        </footer>
      </section>
    </div>
  );
}

type RateRow = {
  id: string;
  who: string;
  amount: string;
  effectiveFrom: string;
  current: boolean;
  annulled: boolean;
  annulledBy: string | null;
};

/**
 * The published rates, with the one in force marked and a way to withdraw a wrong one.
 *
 * The marker is a word, not a colour or a row weight: "in force" and "superseded" have to survive
 * a printout and a greyscale screen, and this is the table somebody checks before quoting a price.
 *
 * Withdrawing asks twice, in place. It cannot be undone and it changes what past hours are worth,
 * which is more than a single click should be able to do; a dialog for it would be two clicks and a
 * lost place in the table.
 */
function RateTable({
  rows,
  headings,
  empty,
  onAnnul,
  busy,
  labels: t
}: {
  rows: RateRow[];
  headings: string[];
  empty: string;
  onAnnul: (id: string) => void;
  busy: boolean;
  labels: Labels;
}) {
  const [confirming, setConfirming] = useState("");
  if (rows.length === 0) return <p className="crm-empty">{empty}</p>;
  return (
    <div className="crm-table-wrap inside-panel">
      <table className="crm-table project-money">
        <thead>
          <tr>
            {headings.map((heading) => (
              <th key={heading}>{heading}</th>
            ))}
            <th>
              <span className="th-with-help">
                {t.history}
                <HelpTip label={t.annul!} description={t.annulHelp!} />
              </span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className={row.annulled ? "rate-row annulled" : "rate-row"}>
              <th scope="row">{row.who}</th>
              <td>
                {row.annulled ? <s>{row.amount}</s> : row.amount}
                <span className="rate-unit">{t.perHour}</span>
              </td>
              <td>
                <time dateTime={row.effectiveFrom}>{row.effectiveFrom}</time>
              </td>
              <td className="rate-actions">
                {row.annulled ? (
                  <span className="rate-state annulled">
                    {row.annulledBy ? `${t.annulled} · ${row.annulledBy}` : t.annulled}
                  </span>
                ) : (
                  <>
                    <span className={row.current ? "rate-state current" : "rate-state"}>
                      {row.current ? t.current : t.superseded}
                    </span>
                    {confirming === row.id ? (
                      <>
                        <button
                          type="button"
                          className="danger-link"
                          disabled={busy}
                          onClick={() => {
                            setConfirming("");
                            onAnnul(row.id);
                          }}
                        >
                          {t.annulConfirm}
                        </button>
                        <button type="button" className="quiet-link" onClick={() => setConfirming("")}>
                          {t.annulCancel}
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="quiet-link"
                        disabled={busy}
                        aria-label={`${t.annul} · ${row.who} · ${row.effectiveFrom}`}
                        onClick={() => setConfirming(row.id)}
                      >
                        {t.annul}
                      </button>
                    )}
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

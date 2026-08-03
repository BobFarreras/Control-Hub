"use client";

import {
  AlertTriangle,
  Archive,
  CalendarClock,
  CircleDollarSign,
  PackagePlus,
  Pause,
  Play,
  Plus,
  RefreshCw,
  X
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, type FormEvent } from "react";
import { MetricHelp } from "@/components/metric-help";

type Product = { id: string; code: string; name: string; status: string };
type Version = { id: string; productId: string; version: string; status: string };
type Plan = { id: string; productVersionId: string; code: string; name: string; status: string };
type Price = {
  id: string;
  planId: string;
  currency: string;
  amountMinor: number;
  costMinor: number;
  taxBasisPoints: number;
  interval: "free" | "monthly" | "quarterly" | "semiannual" | "annual";
  effectiveFrom: string;
};
type Subscription = {
  id: string;
  customerId: string;
  customerName: string;
  planId: string;
  planName: string;
  priceId: string;
  status: "active" | "paused" | "canceled";
  quantity: number;
  renewalAt: string | null;
};
type Metric = {
  currency: string;
  mrrMinor: number;
  arrMinor: number;
  annualCostMinor: number;
  annualMarginMinor: number;
  activeSubscriptions: number;
};
type Alert = {
  subscriptionId: string;
  customerName: string;
  planName: string;
  renewalAt: string;
  daysRemaining: number;
};
type Customer = { id: string; displayName: string };
type Labels = Record<string, string>;

export function CommerceWorkspace({
  catalog,
  subscriptions,
  metrics,
  alerts,
  customers,
  labels: t,
  locale,
  loadError,
  view
}: {
  catalog: { products: Product[]; versions: Version[]; plans: Plan[]; prices: Price[] };
  subscriptions: Subscription[];
  metrics: Metric[];
  alerts: Alert[];
  customers: Customer[];
  labels: Labels;
  locale: string;
  loadError: boolean;
  view: "catalog" | "subscriptions";
}) {
  const router = useRouter();
  const [dialog, setDialog] = useState<"product" | "version" | "plan" | "price" | "subscription" | null>(null);
  const [error, setError] = useState("");
  const currency = (minor: number, code: string) =>
    new Intl.NumberFormat(locale, { style: "currency", currency: code }).format(minor / 100);
  async function showResponseError(response: Response) {
    const payload = (await response.json().catch(() => null)) as { code?: string; error?: { code?: string } } | null;
    const code = payload?.code ?? payload?.error?.code;
    setError(
      code === "MFA_REQUIRED" ? (t.mfaRequired ?? t.formError ?? "MFA_REQUIRED") : (t.formError ?? "OPERATION_FAILED")
    );
  }
  const currentPrices = useMemo(() => {
    const now = Date.now();
    return catalog.plans.flatMap((plan) => {
      const item = catalog.prices.find(
        (price) => price.planId === plan.id && new Date(price.effectiveFrom).getTime() <= now
      );
      return item ? [{ ...item, planName: plan.name }] : [];
    });
  }, [catalog]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const form = event.currentTarget;
    const data = new FormData(form);
    let url = "";
    let body: Record<string, unknown> = {};
    if (dialog === "product") {
      url = "/api/v1/commerce/products";
      body = { code: data.get("code"), name: data.get("name"), description: data.get("description") || undefined };
    }
    if (dialog === "version") {
      url = `/api/v1/commerce/products/${data.get("productId")}/versions`;
      body = {
        version: data.get("version"),
        status: data.get("status"),
        releasedAt: data.get("releasedAt") ? new Date(String(data.get("releasedAt"))).toISOString() : undefined
      };
    }
    if (dialog === "plan") {
      url = `/api/v1/commerce/versions/${data.get("versionId")}/plans`;
      body = { code: data.get("code"), name: data.get("name"), description: data.get("description") || undefined };
    }
    if (dialog === "price") {
      url = `/api/v1/commerce/plans/${data.get("planId")}/prices`;
      body = {
        currency: data.get("currency"),
        amountMinor: Math.round(Number(data.get("amount")) * 100),
        costMinor: Math.round(Number(data.get("cost")) * 100),
        taxBasisPoints: Math.round(Number(data.get("tax")) * 100),
        interval: data.get("interval")
      };
    }
    if (dialog === "subscription") {
      const selected = currentPrices.find((price) => price.id === data.get("priceId"));
      if (!selected) return setError(t.formError ?? "OPERATION_FAILED");
      url = "/api/v1/commerce/subscriptions";
      body = {
        customerId: data.get("customerId"),
        planId: selected.planId,
        priceId: selected.id,
        quantity: Number(data.get("quantity")),
        renewalAt: data.get("renewalAt") ? new Date(String(data.get("renewalAt"))).toISOString() : undefined,
        renewalAlertDays: Number(data.get("alertDays"))
      };
    }
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
    if (!response.ok) return showResponseError(response);
    setDialog(null);
    router.refresh();
  }
  async function status(subscription: Subscription, next: "active" | "paused" | "canceled") {
    const response = await fetch(`/api/v1/commerce/subscriptions/${subscription.id}/status`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: next })
    });
    if (!response.ok) return showResponseError(response);
    router.refresh();
  }
  async function changePlan(event: FormEvent<HTMLFormElement>, subscription: Subscription) {
    event.preventDefault();
    const selected = currentPrices.find((price) => price.id === new FormData(event.currentTarget).get("priceId"));
    if (!selected) return;
    const response = await fetch(`/api/v1/commerce/subscriptions/${subscription.id}/plan`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ planId: selected.planId, priceId: selected.id, renewalAt: subscription.renewalAt })
    });
    if (!response.ok) return showResponseError(response);
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
      <section className="commerce-summary-strip">
        {metrics.map((item) => (
          <article key={item.currency}>
            <span className="currency-code">{item.currency}</span>
            <div>
              <MetricHelp label={t.mrr!} description={t.mrrHelp!} />
              <strong>{currency(item.mrrMinor, item.currency)}</strong>
            </div>
            <div>
              <MetricHelp label={t.arr!} description={t.arrHelp!} />
              <strong>{currency(item.arrMinor, item.currency)}</strong>
            </div>
            <div>
              <MetricHelp label={t.margin!} description={t.marginHelp!} />
              <strong>{currency(item.annualMarginMinor, item.currency)}</strong>
            </div>
          </article>
        ))}
        <div className="commerce-actions">
          {view === "catalog" ? (
            <>
              <button
                className="secondary-button"
                onClick={() => setDialog("version")}
                disabled={!catalog.products.length}
              >
                <Plus size={16} />
                {t.addVersion}
              </button>
              <button
                className="secondary-button"
                onClick={() => setDialog("plan")}
                disabled={!catalog.versions.length}
              >
                <Plus size={16} />
                {t.addPlan}
              </button>
              <button className="secondary-button" onClick={() => setDialog("price")} disabled={!catalog.plans.length}>
                <CircleDollarSign size={16} />
                {t.publishPrice}
              </button>
              <button className="primary-command" onClick={() => setDialog("product")}>
                <PackagePlus size={17} />
                {t.addProduct}
              </button>
            </>
          ) : (
            <button
              className="primary-command"
              onClick={() => setDialog("subscription")}
              disabled={!customers.length || !currentPrices.length}
            >
              <Plus size={17} />
              {t.addSubscription}
            </button>
          )}
        </div>
      </section>
      {view === "catalog" ? (
        <section className="catalog-grid">
          {catalog.products.length === 0 ? (
            <p className="crm-empty">{t.emptyCatalog}</p>
          ) : (
            catalog.products.map((product) => (
              <article className="catalog-product" key={product.id}>
                <header>
                  <div>
                    <span>{product.code}</span>
                    <h2>{product.name}</h2>
                  </div>
                  <span className="state state-active">{t.active}</span>
                </header>
                {catalog.versions
                  .filter((version) => version.productId === product.id)
                  .map((version) => (
                    <div className="catalog-version" key={version.id}>
                      <strong>
                        {t.version} {version.version}
                      </strong>
                      {catalog.plans
                        .filter((plan) => plan.productVersionId === version.id)
                        .map((plan) => {
                          const prices = catalog.prices.filter((price) => price.planId === plan.id);
                          return (
                            <div className="catalog-plan" key={plan.id}>
                              <div>
                                <strong>{plan.name}</strong>
                                <small>{plan.code}</small>
                              </div>
                              <div>
                                {prices.map((price) => (
                                  <span className="price-chip" key={price.id}>
                                    {currency(price.amountMinor, price.currency)} / {t[price.interval]}
                                  </span>
                                ))}
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  ))}
              </article>
            ))
          )}
        </section>
      ) : (
        <section className="subscription-layout">
          <div className="subscription-table">
            {subscriptions.length === 0 ? (
              <p className="crm-empty">{t.emptySubscriptions}</p>
            ) : (
              subscriptions.map((subscription) => (
                <article className="subscription-row" key={subscription.id}>
                  <div>
                    <strong>{subscription.customerName}</strong>
                    <small>
                      {subscription.planName} · x{subscription.quantity}
                    </small>
                  </div>
                  <span className={`state state-${subscription.status}`}>{t[subscription.status]}</span>
                  <time>
                    {subscription.renewalAt ? new Date(subscription.renewalAt).toLocaleDateString(locale) : "--"}
                  </time>
                  <form onSubmit={(event) => changePlan(event, subscription)}>
                    <select name="priceId" defaultValue={subscription.priceId}>
                      {currentPrices.map((price) => (
                        <option key={price.id} value={price.id}>
                          {price.planName} · {currency(price.amountMinor, price.currency)}
                        </option>
                      ))}
                    </select>
                    <button className="icon-button" title={t.changePlan} aria-label={t.changePlan}>
                      <RefreshCw size={15} />
                    </button>
                  </form>
                  <div className="row-actions">
                    {subscription.status === "active" && (
                      <button title={t.pause} aria-label={t.pause} onClick={() => status(subscription, "paused")}>
                        <Pause size={15} />
                      </button>
                    )}
                    {subscription.status === "paused" && (
                      <button title={t.resume} aria-label={t.resume} onClick={() => status(subscription, "active")}>
                        <Play size={15} />
                      </button>
                    )}
                    {subscription.status !== "canceled" && (
                      <button title={t.cancel} aria-label={t.cancel} onClick={() => status(subscription, "canceled")}>
                        <Archive size={15} />
                      </button>
                    )}
                  </div>
                </article>
              ))
            )}
          </div>
          <aside className="renewal-panel">
            <header>
              <CalendarClock size={19} />
              <h2>{t.renewals}</h2>
            </header>
            {alerts.length === 0 ? (
              <p>{t.noRenewals}</p>
            ) : (
              alerts.map((alert) => (
                <div key={alert.subscriptionId}>
                  <strong>{alert.customerName}</strong>
                  <small>{alert.planName}</small>
                  <time>
                    {new Date(alert.renewalAt).toLocaleDateString(locale)} · {alert.daysRemaining}d
                  </time>
                </div>
              ))
            )}
          </aside>
        </section>
      )}
      {dialog && (
        <div
          className="dialog-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setDialog(null);
          }}
        >
          <section className="crm-dialog" role="dialog" aria-modal="true">
            <header>
              <h2>
                {
                  t[
                    dialog === "product"
                      ? "addProduct"
                      : dialog === "version"
                        ? "addVersion"
                        : dialog === "plan"
                          ? "addPlan"
                          : dialog === "price"
                            ? "publishPrice"
                            : "addSubscription"
                  ]
                }
              </h2>
              <button className="icon-button" onClick={() => setDialog(null)} aria-label={t.cancel}>
                <X size={18} />
              </button>
            </header>
            <form className="commerce-form" onSubmit={submit}>
              {dialog === "product" && (
                <>
                  <label>
                    {t.code}
                    <input name="code" pattern="[a-z0-9][a-z0-9-]{1,62}[a-z0-9]" required />
                  </label>
                  <label>
                    {t.name}
                    <input name="name" required />
                  </label>
                  <label className="wide">
                    {t.descriptionLabel}
                    <textarea name="description" maxLength={2000} />
                  </label>
                </>
              )}
              {dialog === "version" && (
                <>
                  <label>
                    {t.product}
                    <select name="productId">
                      {catalog.products.map((item) => (
                        <option value={item.id} key={item.id}>
                          {item.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    {t.version}
                    <input name="version" required />
                  </label>
                  <label>
                    {t.status}
                    <select name="status">
                      <option value="draft">{t.draft}</option>
                      <option value="active">{t.active}</option>
                    </select>
                  </label>
                  <label>
                    {t.releasedAt}
                    <input name="releasedAt" type="datetime-local" />
                  </label>
                </>
              )}
              {dialog === "plan" && (
                <>
                  <label>
                    {t.version}
                    <select name="versionId">
                      {catalog.versions.map((item) => (
                        <option value={item.id} key={item.id}>
                          {catalog.products.find((product) => product.id === item.productId)?.name} · {item.version}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    {t.code}
                    <input name="code" required />
                  </label>
                  <label>
                    {t.name}
                    <input name="name" required />
                  </label>
                  <label>
                    {t.descriptionLabel}
                    <input name="description" />
                  </label>
                </>
              )}
              {dialog === "price" && (
                <>
                  <label>
                    {t.plan}
                    <select name="planId">
                      {catalog.plans.map((item) => (
                        <option value={item.id} key={item.id}>
                          {item.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    {t.currency}
                    <input name="currency" defaultValue="EUR" pattern="[A-Za-z]{3}" required />
                  </label>
                  <label>
                    {t.netPrice}
                    <input name="amount" type="number" min="0" step="0.01" required />
                  </label>
                  <label>
                    {t.cost}
                    <input name="cost" type="number" min="0" step="0.01" required />
                  </label>
                  <label>
                    {t.tax}
                    <input name="tax" type="number" min="0" max="100" step="0.01" defaultValue="21" required />
                  </label>
                  <label>
                    {t.interval}
                    <select name="interval">
                      {["monthly", "quarterly", "semiannual", "annual", "free"].map((item) => (
                        <option value={item} key={item}>
                          {t[item]}
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              )}
              {dialog === "subscription" && (
                <>
                  <label>
                    {t.customer}
                    <select name="customerId">
                      {customers.map((item) => (
                        <option value={item.id} key={item.id}>
                          {item.displayName}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    {t.plan}
                    <select name="priceId">
                      {currentPrices.map((item) => (
                        <option value={item.id} key={item.id}>
                          {item.planName} · {currency(item.amountMinor, item.currency)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    {t.quantity}
                    <input name="quantity" type="number" min="1" defaultValue="1" required />
                  </label>
                  <label>
                    {t.renewalAt}
                    <input name="renewalAt" type="datetime-local" />
                  </label>
                  <label>
                    {t.alertDays}
                    <input name="alertDays" type="number" min="0" max="365" defaultValue="14" required />
                  </label>
                </>
              )}
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
                <button className="secondary-button" type="button" onClick={() => setDialog(null)}>
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

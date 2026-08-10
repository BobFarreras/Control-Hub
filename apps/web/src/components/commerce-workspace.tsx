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
import { SelectControl } from "@/components/form-field";
import { MetricHelp } from "@/components/metric-help";
import { toCatalogCode } from "@/lib/catalog-code";
import { catalogProductOffering } from "@/lib/catalog-product-offering";
import { formValue } from "@/lib/form";
import { actionHandler, eventHandler } from "@/lib/handlers";
import { parseAmountToMinor } from "@/lib/money";

type Product = { id: string; code: string; name: string; description?: string | null; status: string };
type Version = { id: string; productId: string; version: string; status: string };
type CommercialModel = "subscription" | "maintenance" | "one_time" | "project_service";
type Plan = {
  id: string;
  productVersionId: string;
  code: string;
  name: string;
  commercialModel: CommercialModel;
  status: string;
};
type Price = {
  id: string;
  planId: string;
  currency: string;
  amountMinor: number;
  costMinor: number;
  taxBasisPoints: number;
  interval: "free" | "one_time" | "monthly" | "quarterly" | "semiannual" | "annual";
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
  view,
  renderedAt
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
  /** Fixed by the server so the markup it sends and the first client render agree. Reading the
   *  clock while rendering makes the two disagree and produces a hydration mismatch. */
  renderedAt: number;
}) {
  const router = useRouter();
  const [dialog, setDialog] = useState<"product" | "version" | "plan" | "price" | "subscription" | null>(null);
  const [dialogContext, setDialogContext] = useState<{ productId?: string; versionId?: string; planId?: string }>({});
  const [productCode, setProductCode] = useState("");
  const [planCode, setPlanCode] = useState("");
  const [productCodeEdited, setProductCodeEdited] = useState(false);
  const [planCodeEdited, setPlanCodeEdited] = useState(false);
  const [commercialModel, setCommercialModel] = useState<CommercialModel>("subscription");
  const [billingInterval, setBillingInterval] = useState("monthly");
  const [error, setError] = useState("");
  /** Last resort for a handler that rejected outright, so a failure is never silent. */
  const fail = () => setError(t.formError ?? "OPERATION_FAILED");
  const currency = (minor: number, code: string) =>
    new Intl.NumberFormat(locale, { style: "currency", currency: code }).format(minor / 100);
  async function showResponseError(response: Response) {
    const payload = (await response.json().catch(() => null)) as { code?: string; error?: { code?: string } } | null;
    const code = payload?.code ?? payload?.error?.code;
    setError(
      code === "MFA_REQUIRED" ? (t.mfaRequired ?? t.formError ?? "MFA_REQUIRED") : (t.formError ?? "OPERATION_FAILED")
    );
  }
  const currentPrices = useMemo(
    () =>
      catalog.plans.flatMap((plan) => {
        const item = catalog.prices.find(
          (price) => price.planId === plan.id && new Date(price.effectiveFrom).getTime() <= renderedAt
        );
        return item ? [{ ...item, planName: plan.name }] : [];
      }),
    [catalog, renderedAt]
  );
  const openDialog = (
    next: "product" | "version" | "plan" | "price" | "subscription",
    context: { productId?: string; versionId?: string; planId?: string } = {}
  ) => {
    if (next === "product" || next === "plan") {
      setCommercialModel("subscription");
      setBillingInterval("monthly");
    }
    if (next === "price") {
      const model = catalog.plans.find((plan) => plan.id === context.planId)?.commercialModel ?? "subscription";
      setCommercialModel(model);
      setBillingInterval(model === "one_time" || model === "project_service" ? "one_time" : "monthly");
    }
    setDialogContext(context);
    setDialog(next);
  };
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const form = event.currentTarget;
    const data = new FormData(form);
    let url = "";
    let body: Record<string, unknown> = {};
    if (dialog === "product") {
      const amount = parseAmountToMinor(formValue(data, "amount"));
      const cost = parseAmountToMinor(formValue(data, "cost"));
      const tax = parseAmountToMinor(formValue(data, "tax"));
      if ("error" in amount || "error" in cost || "error" in tax || tax.minor > 10_000) {
        setError(t.invalidFinancialInput ?? t.formError ?? "INVALID_INPUT");
        return;
      }
      url = "/api/v1/commerce/products/with-offer";
      body = {
        product: {
          code: data.get("productCode"),
          name: data.get("productName"),
          description: data.get("productDescription") || undefined
        },
        version: { version: data.get("version") },
        plan: {
          code: data.get("planCode"),
          name: data.get("planName"),
          commercialModel: data.get("commercialModel")
        },
        price: {
          currency: data.get("currency"),
          amountMinor: amount.minor,
          costMinor: cost.minor,
          taxBasisPoints: tax.minor,
          interval: data.get("interval")
        }
      };
    }
    if (dialog === "version") {
      url = `/api/v1/commerce/products/${formValue(data, "productId")}/versions`;
      body = {
        version: data.get("version"),
        status: data.get("status"),
        releasedAt: data.get("releasedAt") ? new Date(formValue(data, "releasedAt")).toISOString() : undefined
      };
    }
    if (dialog === "plan") {
      url = `/api/v1/commerce/versions/${formValue(data, "versionId")}/plans`;
      body = {
        code: data.get("code"),
        name: data.get("name"),
        description: data.get("description") || undefined,
        commercialModel: data.get("commercialModel")
      };
    }
    if (dialog === "price") {
      url = `/api/v1/commerce/plans/${formValue(data, "planId")}/prices`;
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
        renewalAt: data.get("renewalAt") ? new Date(formValue(data, "renewalAt")).toISOString() : undefined,
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
    setProductCode("");
    setPlanCode("");
    setProductCodeEdited(false);
    setPlanCodeEdited(false);
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
  const dialogContextLabel =
    dialog === "version"
      ? catalog.products.find((product) => product.id === dialogContext.productId)?.name
      : dialog === "plan"
        ? catalog.versions.find((version) => version.id === dialogContext.versionId)?.version
        : dialog === "price"
          ? catalog.plans.find((plan) => plan.id === dialogContext.planId)?.name
          : undefined;
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
      <section className={`commerce-summary-strip${view === "catalog" ? " catalog-summary-strip" : ""}`}>
        {view === "catalog" ? (
          <article>
            <div>
              <span>{t.products}</span>
              <strong>{catalog.products.length}</strong>
            </div>
            <div>
              <span>{t.plans}</span>
              <strong>{catalog.plans.length}</strong>
            </div>
            <div>
              <span>{t.publishedOffers}</span>
              <strong>{currentPrices.length}</strong>
            </div>
          </article>
        ) : (
          metrics.map((item) => (
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
          ))
        )}
        <div className="commerce-actions">
          {view === "catalog" ? (
            <button className="primary-command" onClick={() => openDialog("product")}>
              <PackagePlus size={17} />
              {t.addProduct}
            </button>
          ) : (
            <button
              className="primary-command"
              onClick={() => openDialog("subscription")}
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
            catalog.products.map((product) => {
              const {
                versions,
                plans: productPlans,
                prices: productPrices
              } = catalogProductOffering(product.id, catalog);
              return (
                <article className="catalog-product" key={product.id}>
                  <header>
                    <div>
                      <span>{product.code}</span>
                      <h2>{product.name}</h2>
                    </div>
                    <span className={`state state-${product.status}`}>{t[product.status] ?? product.status}</span>
                  </header>
                  <div className="catalog-product-summary">
                    <p>{product.description || t.noProductDescription}</p>
                    <div>
                      <span>
                        <strong>{productPlans.length}</strong> {(t.plans ?? "").toLocaleLowerCase(locale)}
                      </span>
                      <span>
                        <strong>{productPrices.length}</strong> {(t.publishedOffers ?? "").toLocaleLowerCase(locale)}
                      </span>
                    </div>
                    <Link className="catalog-detail-link" href={`/${locale}/products/${product.id}`}>
                      {t.viewProduct}
                    </Link>
                  </div>
                  <details className="catalog-offer-details">
                    <summary>{t.manageOffer}</summary>
                    <div className="catalog-offer-toolbar">
                      <span>
                        {t.versions}: {versions.length}
                      </span>
                      <button
                        className="secondary-button"
                        onClick={() => openDialog("version", { productId: product.id })}
                      >
                        <Plus size={15} /> {t.addVersion}
                      </button>
                    </div>
                    {versions.map((version) => (
                      <div className="catalog-version" key={version.id}>
                        <header>
                          <strong>
                            {t.version} {version.version}
                          </strong>
                          <button
                            className="secondary-button"
                            onClick={() => openDialog("plan", { versionId: version.id })}
                          >
                            <Plus size={15} /> {t.addPlan}
                          </button>
                        </header>
                        {catalog.plans.filter((plan) => plan.productVersionId === version.id).length === 0 && (
                          <p className="catalog-inline-empty">{t.noPlans}</p>
                        )}
                        {catalog.plans
                          .filter((plan) => plan.productVersionId === version.id)
                          .map((plan) => {
                            const prices = catalog.prices.filter((price) => price.planId === plan.id);
                            return (
                              <div className="catalog-plan" key={plan.id}>
                                <div>
                                  <strong>{plan.name}</strong>
                                  <small>{plan.code}</small>
                                  <span className="catalog-model">
                                    {t[plan.commercialModel] ?? plan.commercialModel}
                                  </span>
                                </div>
                                <div>
                                  {prices.map((price) => (
                                    <span className="price-chip" key={price.id}>
                                      {currency(price.amountMinor, price.currency)} / {t[price.interval]}
                                    </span>
                                  ))}
                                  <button
                                    className="catalog-price-action"
                                    onClick={() => openDialog("price", { planId: plan.id })}
                                  >
                                    <CircleDollarSign size={14} /> {t.publishPrice}
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                      </div>
                    ))}
                  </details>
                </article>
              );
            })
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
                  <form
                    onSubmit={eventHandler(
                      (event: FormEvent<HTMLFormElement>) => changePlan(event, subscription),
                      fail
                    )}
                  >
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
                      <button
                        title={t.pause}
                        aria-label={t.pause}
                        onClick={actionHandler(() => status(subscription, "paused"), fail)}
                      >
                        <Pause size={15} />
                      </button>
                    )}
                    {subscription.status === "paused" && (
                      <button
                        title={t.resume}
                        aria-label={t.resume}
                        onClick={actionHandler(() => status(subscription, "active"), fail)}
                      >
                        <Play size={15} />
                      </button>
                    )}
                    {subscription.status !== "canceled" && (
                      <button
                        title={t.cancel}
                        aria-label={t.cancel}
                        onClick={actionHandler(() => status(subscription, "canceled"), fail)}
                      >
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
            <form className="commerce-form" onSubmit={eventHandler(submit, fail)}>
              {dialogContextLabel && dialog !== "product" && dialog !== "subscription" && (
                <p className="commerce-dialog-context">
                  <span>{dialog === "version" ? t.product : dialog === "plan" ? t.version : t.plan}</span>
                  <strong>{dialogContextLabel}</strong>
                </p>
              )}
              {dialog === "product" && (
                <>
                  <fieldset className="commerce-wizard-section">
                    <legend>
                      <span>1</span>
                      {t.productDetails}
                    </legend>
                    <label>
                      {t.name}
                      <input
                        name="productName"
                        required
                        onChange={(event) => {
                          if (!productCodeEdited) setProductCode(toCatalogCode(event.target.value, "product"));
                        }}
                      />
                    </label>
                    <label>
                      {t.code}
                      <input
                        name="productCode"
                        value={productCode}
                        pattern="[a-z0-9][a-z0-9-]{1,62}[a-z0-9]"
                        required
                        onChange={(event) => {
                          setProductCodeEdited(true);
                          setProductCode(event.target.value);
                        }}
                      />
                    </label>
                    <label className="wide">
                      {t.descriptionLabel}
                      <textarea name="productDescription" maxLength={2000} />
                    </label>
                  </fieldset>
                  <fieldset className="commerce-wizard-section">
                    <legend>
                      <span>2</span>
                      {t.firstPlan}
                    </legend>
                    <label>
                      {t.version}
                      <input name="version" defaultValue="1.0" required />
                    </label>
                    <label>
                      {t.planName}
                      <input
                        name="planName"
                        required
                        onChange={(event) => {
                          if (!planCodeEdited) setPlanCode(toCatalogCode(event.target.value, "plan"));
                        }}
                      />
                    </label>
                    <label>
                      {t.planCode}
                      <input
                        name="planCode"
                        value={planCode}
                        pattern="[a-z0-9][a-z0-9-]{1,62}[a-z0-9]"
                        required
                        onChange={(event) => {
                          setPlanCodeEdited(true);
                          setPlanCode(event.target.value);
                        }}
                      />
                    </label>
                    <label>
                      {t.commercialModel}
                      <SelectControl
                        name="commercialModel"
                        value={commercialModel}
                        onChange={(event) => {
                          const model = event.target.value as CommercialModel;
                          setCommercialModel(model);
                          setBillingInterval(
                            model === "one_time" || model === "project_service" ? "one_time" : "monthly"
                          );
                        }}
                        options={["subscription", "maintenance", "one_time", "project_service"].map((item) => ({
                          value: item,
                          label: t[item] ?? item
                        }))}
                      />
                    </label>
                  </fieldset>
                  <fieldset className="commerce-wizard-section">
                    <legend>
                      <span>3</span>
                      {t.firstPrice}
                    </legend>
                    <label>
                      {t.currency}
                      <input name="currency" defaultValue="EUR" pattern="[A-Za-z]{3}" required />
                    </label>
                    <label>
                      {t.netPrice}
                      <input name="amount" inputMode="decimal" required />
                    </label>
                    <label>
                      {t.cost}
                      <input name="cost" inputMode="decimal" defaultValue="0" required />
                    </label>
                    <label>
                      {t.tax}
                      <input name="tax" inputMode="decimal" defaultValue="21" required />
                    </label>
                    <label>
                      {t.interval}
                      <SelectControl
                        name="interval"
                        value={billingInterval}
                        onChange={(event) => setBillingInterval(event.target.value)}
                        options={(commercialModel === "one_time" || commercialModel === "project_service"
                          ? ["one_time"]
                          : ["monthly", "quarterly", "semiannual", "annual", "free"]
                        ).map((item) => ({
                          value: item,
                          label: t[item] ?? item
                        }))}
                      />
                    </label>
                  </fieldset>
                </>
              )}
              {dialog === "version" && (
                <>
                  {dialogContext.productId ? (
                    <input type="hidden" name="productId" value={dialogContext.productId} />
                  ) : (
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
                  )}
                  <label>
                    {t.version}
                    <input name="version" required />
                  </label>
                  <label>
                    {t.status}
                    <SelectControl
                      name="status"
                      defaultValue="draft"
                      options={[
                        { value: "draft", label: t.draft ?? "" },
                        { value: "active", label: t.active ?? "" }
                      ]}
                    />
                  </label>
                  <label>
                    {t.releasedAt}
                    <input name="releasedAt" type="datetime-local" />
                  </label>
                </>
              )}
              {dialog === "plan" && (
                <>
                  {dialogContext.versionId ? (
                    <input type="hidden" name="versionId" value={dialogContext.versionId} />
                  ) : (
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
                  )}
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
                  <label>
                    {t.commercialModel}
                    <SelectControl
                      name="commercialModel"
                      value={commercialModel}
                      onChange={(event) => setCommercialModel(event.target.value as CommercialModel)}
                      options={["subscription", "maintenance", "one_time", "project_service"].map((item) => ({
                        value: item,
                        label: t[item] ?? item
                      }))}
                    />
                  </label>
                </>
              )}
              {dialog === "price" && (
                <>
                  {dialogContext.planId ? (
                    <input type="hidden" name="planId" value={dialogContext.planId} />
                  ) : (
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
                  )}
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
                    <SelectControl
                      name="interval"
                      value={billingInterval}
                      onChange={(event) => setBillingInterval(event.target.value)}
                      options={(commercialModel === "one_time" || commercialModel === "project_service"
                        ? ["one_time"]
                        : ["monthly", "quarterly", "semiannual", "annual", "free"]
                      ).map((item) => ({
                        value: item,
                        label: t[item] ?? item
                      }))}
                    />
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

"use client";

import { ExternalLink, Pencil, Plus, Save, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { SelectControl } from "@/components/form-field";
import { useToast } from "@/components/toast";
import type { ProductCatalogDetail as ProductDetail, ProductResource, Version } from "@/lib/api-types";
import { formValue } from "@/lib/form";
import { parseAmountToMinor } from "@/lib/money";

type Props = { detail: ProductDetail; labels: Record<string, string>; locale: string };
type Editor = "product" | "version" | "resource" | "newVersion" | "newPlan" | "newPrice" | null;

const formatMoney = (amountMinor: number, currency: string, locale: string) =>
  new Intl.NumberFormat(locale, { style: "currency", currency }).format(amountMinor / 100);
const lines = (value: FormDataEntryValue | null) =>
  (typeof value === "string" ? value : "")
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);

export function ProductCatalogDetail({ detail, labels: t, locale }: Props) {
  const router = useRouter();
  const { toast } = useToast();
  const [editor, setEditor] = useState<Editor>(null);
  const [selectedVersion, setSelectedVersion] = useState<Version | null>(null);
  const [targetId, setTargetId] = useState<string | null>(null);
  const [resources, setResources] = useState(detail.resources);
  const [saving, setSaving] = useState(false);

  async function request(url: string, method: "PATCH" | "PUT" | "POST", body: unknown) {
    setSaving(true);
    const response = await fetch(url, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
    setSaving(false);
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { code?: string } | null;
      toast("error", payload?.code === "CONCURRENT_MODIFICATION" ? t.concurrentModification! : t.formError!);
      return false;
    }
    toast("success", t.changesSaved!);
    setEditor(null);
    router.refresh();
    return true;
  }

  async function addOfferingPart(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!targetId) return;
    const data = new FormData(event.currentTarget);
    if (editor === "newVersion") {
      await request(`/api/v1/commerce/products/${detail.product.id}/versions`, "POST", {
        version: formValue(data, "version"),
        status: "active"
      });
    } else if (editor === "newPlan") {
      await request(`/api/v1/commerce/versions/${targetId}/plans`, "POST", {
        code: formValue(data, "code"),
        name: formValue(data, "name"),
        description: formValue(data, "description") || undefined,
        commercialModel: formValue(data, "commercialModel")
      });
    } else if (editor === "newPrice") {
      const amount = parseAmountToMinor(formValue(data, "amount"));
      const cost = parseAmountToMinor(formValue(data, "cost"));
      const tax = parseAmountToMinor(formValue(data, "tax"));
      if ("error" in amount || "error" in cost || "error" in tax || tax.minor > 10_000) {
        toast("error", t.invalidFinancialInput!);
        return;
      }
      await request(`/api/v1/commerce/plans/${targetId}/prices`, "POST", {
        currency: formValue(data, "currency").toUpperCase(),
        amountMinor: amount.minor,
        costMinor: cost.minor,
        taxBasisPoints: tax.minor,
        interval: formValue(data, "interval")
      });
    }
  }

  async function saveProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await request(`/api/v1/commerce/products/${detail.product.id}`, "PATCH", {
      name: formValue(data, "name"),
      description: formValue(data, "description") || undefined,
      status: formValue(data, "status"),
      expectedUpdatedAt: detail.product.updatedAt
    });
  }

  async function saveVersion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedVersion) return;
    const data = new FormData(event.currentTarget);
    let schemaDocument: Record<string, unknown> | undefined;
    const schema = formValue(data, "schema").trim();
    if (schema) {
      try {
        const parsed: unknown = JSON.parse(schema);
        if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") throw new Error();
        schemaDocument = parsed as Record<string, unknown>;
      } catch {
        toast("error", t.invalidSchema!);
        return;
      }
    }
    await request(`/api/v1/commerce/versions/${selectedVersion.id}/knowledge`, "PATCH", {
      releaseNotes: formValue(data, "releaseNotes") || undefined,
      features: lines(data.get("features")),
      contents: lines(data.get("contents")),
      schemaDocument,
      expectedUpdatedAt: selectedVersion.updatedAt
    });
  }

  async function replaceResources(next: ProductResource[]) {
    const ok = await request(`/api/v1/commerce/products/${detail.product.id}/resources`, "PUT", {
      resources: next.map(({ productVersionId, kind, label, url }) => ({
        ...(productVersionId ? { productVersionId } : {}),
        kind,
        label,
        url
      }))
    });
    if (ok) setResources(next);
  }

  async function addResource(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const resource: ProductResource = {
      id: crypto.randomUUID(),
      productId: detail.product.id,
      productVersionId: formValue(data, "productVersionId") || null,
      kind: formValue(data, "kind") as ProductResource["kind"],
      label: formValue(data, "label"),
      url: formValue(data, "url"),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    await replaceResources([...resources, resource]);
  }

  return (
    <section className="product-detail-layout">
      <article className="product-detail-hero">
        <div>
          <span className="catalog-code">{detail.product.code}</span>
          <h2>{detail.product.name}</h2>
          <p>{detail.product.description || t.noProductDescription}</p>
        </div>
        <div className="product-detail-summary" aria-label={t.offerStructure}>
          <article>
            <strong>{detail.versions.length}</strong>
            <span>{t.versions}</span>
          </article>
          <article>
            <strong>{detail.plans.length}</strong>
            <span>{t.plans}</span>
          </article>
          <article>
            <strong>{detail.customers.filter((item) => item.status === "active").length}</strong>
            <span>{t.activeCustomers}</span>
          </article>
          <article>
            <strong>{detail.resources.length}</strong>
            <span>{t.resources}</span>
          </article>
        </div>
        <div className="product-detail-actions">
          <span className={`state state-${detail.product.status}`}>
            {t[detail.product.status] ?? detail.product.status}
          </span>
          <button className="secondary-button" onClick={() => setEditor("product")}>
            <Pencil size={15} />
            {t.editProduct}
          </button>
        </div>
      </article>

      <section className="product-knowledge-grid">
        <article className="product-knowledge-panel">
          <header>
            <div>
              <span>{t.productKnowledge}</span>
              <h2>{t.resources}</h2>
            </div>
            <button className="secondary-button" onClick={() => setEditor("resource")}>
              <Plus size={15} />
              {t.addResource}
            </button>
          </header>
          {resources.length === 0 ? (
            <p className="crm-empty">{t.noResources}</p>
          ) : (
            resources.map((resource) => (
              <div className="product-resource-row" key={resource.id}>
                <div>
                  <span>{t[resource.kind] ?? resource.kind}</span>
                  <a href={resource.url} target="_blank" rel="noreferrer">
                    {resource.label}
                    <ExternalLink size={14} />
                  </a>
                </div>
                <button
                  className="icon-button"
                  aria-label={t.removeResource}
                  onClick={() => void replaceResources(resources.filter((item) => item.id !== resource.id))}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))
          )}
        </article>
        <article className="product-knowledge-panel">
          <header>
            <div>
              <span>{t.contractedProduct}</span>
              <h2>{t.customers}</h2>
            </div>
          </header>
          {detail.customers.length === 0 ? (
            <p className="crm-empty">{t.noProductCustomers}</p>
          ) : (
            detail.customers.map((customer) => (
              <div className="product-customer-row" key={customer.serviceId}>
                <div>
                  <strong>{customer.customerName}</strong>
                  <small>{customer.planName}</small>
                </div>
                <span className={`state state-${customer.status}`}>{t[customer.status] ?? customer.status}</span>
              </div>
            ))
          )}
        </article>
      </section>

      <section className="product-offer-tree">
        <header className="product-section-heading">
          <div>
            <span>{t.commercialStructure}</span>
            <h2>{t.offerStructure}</h2>
          </div>
          <p>{t.offerStructureHelp}</p>
          <button
            className="secondary-button"
            onClick={() => {
              setTargetId(detail.product.id);
              setEditor("newVersion");
            }}
          >
            <Plus size={15} />
            {t.addVersion}
          </button>
        </header>
        {detail.versions.length === 0 ? <p className="crm-empty">{t.noVersions}</p> : null}
        {detail.versions.map((version) => {
          const plans = detail.plans.filter((plan) => plan.productVersionId === version.id);
          return (
            <article className="product-detail-version" key={version.id}>
              <header>
                <div>
                  <span>{t.version}</span>
                  <strong>{version.version}</strong>
                </div>
                <div className="product-detail-actions">
                  <span className={`state state-${version.status}`}>{t[version.status] ?? version.status}</span>
                  <button
                    className="secondary-button"
                    onClick={() => {
                      setTargetId(version.id);
                      setEditor("newPlan");
                    }}
                  >
                    <Plus size={15} />
                    {t.addPlan}
                  </button>
                  <button
                    className="secondary-button"
                    onClick={() => {
                      setSelectedVersion(version);
                      setEditor("version");
                    }}
                  >
                    <Pencil size={15} />
                    {t.editContent}
                  </button>
                </div>
              </header>
              <div className="version-knowledge-summary">
                <div>
                  <strong>{t.features}</strong>
                  {version.features.length ? (
                    <ul>
                      {version.features.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  ) : (
                    <p>{t.noFeatures}</p>
                  )}
                </div>
                <div>
                  <strong>{t.productContents}</strong>
                  {version.contents.length ? (
                    <ul>
                      {version.contents.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  ) : (
                    <p>{t.noContents}</p>
                  )}
                </div>
              </div>
              {plans.length === 0 ? <p className="catalog-inline-empty">{t.noPlans}</p> : null}
              <div className="product-detail-plans">
                {plans.map((plan) => {
                  const prices = detail.prices.filter((price) => price.planId === plan.id);
                  return (
                    <article className="product-detail-plan" key={plan.id}>
                      <header>
                        <div>
                          <strong>{plan.name}</strong>
                          <small>{plan.code}</small>
                        </div>
                        <span className="catalog-model">{t[plan.commercialModel] ?? plan.commercialModel}</span>
                      </header>
                      <p>{plan.description || t.noProductDescription}</p>
                      <div className="product-detail-prices">
                        {prices.map((price) => (
                          <span className="price-chip" key={price.id}>
                            {formatMoney(price.amountMinor, price.currency, locale)} ·{" "}
                            {t[price.interval] ?? price.interval}
                          </span>
                        ))}
                        <button
                          className="catalog-price-action"
                          onClick={() => {
                            setTargetId(plan.id);
                            setEditor("newPrice");
                          }}
                        >
                          <Plus size={14} />
                          {t.publishPrice}
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            </article>
          );
        })}
      </section>

      {editor && (
        <div className="dialog-backdrop">
          <section
            className="crm-dialog product-detail-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={t.editProduct}
          >
            <header>
              <h2>
                {editor === "product"
                  ? t.editProduct
                  : editor === "version"
                    ? t.editContent
                    : editor === "resource"
                      ? t.addResource
                      : editor === "newVersion"
                        ? t.addVersion
                        : editor === "newPlan"
                          ? t.addPlan
                          : t.publishPrice}
              </h2>
              <button className="icon-button" aria-label={t.close} onClick={() => setEditor(null)}>
                <X size={18} />
              </button>
            </header>
            {editor === "product" && (
              <form className="product-detail-form" onSubmit={(event) => void saveProduct(event)}>
                <label>
                  {t.name}
                  <input name="name" defaultValue={detail.product.name} required maxLength={160} />
                </label>
                <label>
                  {t.descriptionLabel}
                  <textarea name="description" defaultValue={detail.product.description ?? ""} maxLength={2000} />
                </label>
                <label>
                  {t.status}
                  <SelectControl
                    name="status"
                    defaultValue={detail.product.status}
                    options={[
                      { value: "active", label: t.active! },
                      { value: "archived", label: t.archived! }
                    ]}
                  />
                </label>
                <button className="primary-command" disabled={saving}>
                  <Save size={16} />
                  {t.save}
                </button>
              </form>
            )}
            {editor === "version" && selectedVersion && (
              <form className="product-detail-form" onSubmit={(event) => void saveVersion(event)}>
                <label>
                  {t.releaseNotes}
                  <textarea name="releaseNotes" defaultValue={selectedVersion.releaseNotes ?? ""} />
                </label>
                <label>
                  {t.features}
                  <textarea
                    name="features"
                    defaultValue={selectedVersion.features.join("\n")}
                    placeholder={t.onePerLine}
                  />
                </label>
                <label>
                  {t.productContents}
                  <textarea
                    name="contents"
                    defaultValue={selectedVersion.contents.join("\n")}
                    placeholder={t.onePerLine}
                  />
                </label>
                <label>
                  {t.schema}
                  <textarea
                    className="code-textarea"
                    name="schema"
                    defaultValue={
                      selectedVersion.schemaDocument ? JSON.stringify(selectedVersion.schemaDocument, null, 2) : ""
                    }
                  />
                </label>
                <button className="primary-command" disabled={saving}>
                  <Save size={16} />
                  {t.save}
                </button>
              </form>
            )}
            {editor === "resource" && (
              <form className="product-detail-form" onSubmit={(event) => void addResource(event)}>
                <label>
                  {t.resourceType}
                  <SelectControl
                    name="kind"
                    defaultValue="information"
                    options={["information", "documentation", "diagram", "repository", "demo"].map((value) => ({
                      value,
                      label: t[value]!
                    }))}
                  />
                </label>
                <label>
                  {t.label}
                  <input name="label" required maxLength={160} />
                </label>
                <label>
                  {t.url}
                  <input name="url" type="url" pattern="https://.*" required />
                </label>
                <label>
                  {t.version}
                  <SelectControl
                    name="productVersionId"
                    defaultValue=""
                    options={[
                      { value: "", label: t.allVersions! },
                      ...detail.versions.map((version) => ({ value: version.id, label: version.version }))
                    ]}
                  />
                </label>
                <button className="primary-command" disabled={saving}>
                  <Plus size={16} />
                  {t.addResource}
                </button>
              </form>
            )}
            {editor === "newVersion" && (
              <form className="product-detail-form" onSubmit={(event) => void addOfferingPart(event)}>
                <label>
                  {t.version}
                  <input name="version" required maxLength={80} />
                </label>
                <button className="primary-command" disabled={saving}>
                  <Plus size={16} />
                  {t.addVersion}
                </button>
              </form>
            )}
            {editor === "newPlan" && (
              <form className="product-detail-form" onSubmit={(event) => void addOfferingPart(event)}>
                <label>
                  {t.planCode}
                  <input name="code" required maxLength={64} />
                </label>
                <label>
                  {t.planName}
                  <input name="name" required maxLength={160} />
                </label>
                <label>
                  {t.descriptionLabel}
                  <textarea name="description" maxLength={2000} />
                </label>
                <label>
                  {t.commercialModel}
                  <SelectControl
                    name="commercialModel"
                    defaultValue="subscription"
                    options={["subscription", "maintenance", "one_time", "project_service"].map((value) => ({
                      value,
                      label: t[value]!
                    }))}
                  />
                </label>
                <button className="primary-command" disabled={saving}>
                  <Plus size={16} />
                  {t.addPlan}
                </button>
              </form>
            )}
            {editor === "newPrice" && (
              <form className="product-detail-form" onSubmit={(event) => void addOfferingPart(event)}>
                <label>
                  {t.currency}
                  <input name="currency" defaultValue="EUR" required pattern="[A-Za-z]{3}" />
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
                    defaultValue="monthly"
                    options={["free", "one_time", "monthly", "quarterly", "semiannual", "annual"].map((value) => ({
                      value,
                      label: t[value]!
                    }))}
                  />
                </label>
                <button className="primary-command" disabled={saving}>
                  <Plus size={16} />
                  {t.publishPrice}
                </button>
              </form>
            )}
          </section>
        </div>
      )}
    </section>
  );
}

"use client";

import { AlertTriangle, Plus, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, type FormEvent } from "react";
import { SelectControl } from "@/components/form-field";
import { SmartDataTable, type SmartColumn } from "@/components/smart-data-table";
import type { Catalog, CustomerOption, CustomerService, Member, ProjectRow, TablePreference } from "@/lib/api-types";

type Props = {
  services: CustomerService[];
  catalog: Catalog;
  customers: CustomerOption[];
  members: Member[];
  projects: ProjectRow[];
  preference: TablePreference;
  total: number;
  page: number;
  pageSize: TablePreference["pageSize"];
  sort: string;
  labels: Record<string, string>;
  locale: string;
  loadError: boolean;
  renderedAt: number;
};

export function CustomerServicesWorkspace({
  services,
  catalog,
  customers,
  members,
  projects,
  preference,
  total,
  page,
  pageSize,
  sort,
  labels: t,
  locale,
  loadError,
  renderedAt
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [priceId, setPriceId] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [error, setError] = useState("");
  const offers = useMemo(
    () =>
      catalog.prices.map((price) => {
        const plan = catalog.plans.find((item) => item.id === price.planId)!;
        const version = catalog.versions.find((item) => item.id === plan.productVersionId)!;
        const product = catalog.products.find((item) => item.id === version.productId)!;
        return { ...price, plan, product };
      }),
    [catalog]
  );
  const selected = offers.find((offer) => offer.id === priceId);
  const recurring =
    selected?.plan.commercialModel === "subscription" || selected?.plan.commercialModel === "maintenance";
  const money = (minor: number, currency: string) =>
    new Intl.NumberFormat(locale, { style: "currency", currency }).format(minor / 100);
  const date = (value: string | null) => (value ? new Date(value).toLocaleDateString(locale) : "—");
  const defaultStart = new Date(renderedAt - new Date(renderedAt).getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
  const formString = (data: FormData, name: string) => {
    const value = data.get(name);
    return typeof value === "string" ? value : "";
  };
  const l = (key: string) => t[key] ?? key;

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (!selected) return setError(t.formError ?? "OPERATION_FAILED");
    const data = new FormData(event.currentTarget);
    const startsAt = formString(data, "startsAt");
    const endsAt = formString(data, "endsAt");
    const ownerMembershipId = formString(data, "ownerMembershipId");
    const projectId = formString(data, "projectId");
    const renewalAt = formString(data, "renewalAt");
    const body = {
      customerId,
      planId: selected.planId,
      priceId: selected.id,
      quantity: Number(data.get("quantity")),
      startsAt: new Date(startsAt).toISOString(),
      ...(endsAt ? { endsAt: new Date(endsAt).toISOString() } : {}),
      ...(ownerMembershipId ? { ownerMembershipId } : {}),
      ...(projectId ? { projectId } : {}),
      ...(recurring
        ? {
            autoRenew: data.get("autoRenew") === "true",
            ...(renewalAt ? { renewalAt: new Date(renewalAt).toISOString() } : {}),
            renewalAlertDays: Number(data.get("renewalAlertDays"))
          }
        : {})
    };
    const response = await fetch("/api/v1/commerce/customer-services", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
    if (!response.ok) return setError(t.formError ?? "OPERATION_FAILED");
    setOpen(false);
    router.refresh();
  }

  const columns: SmartColumn<CustomerService>[] = [
    {
      id: "customer",
      label: l("customer"),
      locked: true,
      width: 210,
      sort: { asc: "customer_asc", desc: "updated_desc" },
      filter: {
        parameter: "customerId",
        options: customers.map((customer) => ({ value: customer.id, label: customer.displayName }))
      },
      render: (service) => <Link href={`/${locale}/crm/customers/${service.customerId}`}>{service.customerName}</Link>
    },
    {
      id: "product",
      label: l("product"),
      width: 220,
      sort: { asc: "product_asc", desc: "updated_desc" },
      filter: {
        parameter: "productId",
        options: catalog.products.map((product) => ({ value: product.id, label: product.name }))
      },
      render: (service) => (
        <Link href={`/${locale}/products/${service.productId}`}>
          <strong>{service.productName}</strong>
          <small>{service.planName}</small>
        </Link>
      )
    },
    {
      id: "model",
      label: l("commercialModel"),
      width: 160,
      filter: {
        parameter: "commercialModel",
        options: ["subscription", "maintenance", "one_time", "project_service"].map((value) => ({
          value,
          label: t[value] ?? value
        }))
      },
      render: (service) => <span className="catalog-model">{t[service.commercialModel]}</span>
    },
    {
      id: "status",
      label: l("status"),
      width: 120,
      filter: {
        parameter: "status",
        options: ["active", "paused", "completed", "canceled"].map((value) => ({
          value,
          label: t[value] ?? value
        }))
      },
      render: (service) => <span className={`state state-${service.status}`}>{t[service.status]}</span>
    },
    {
      id: "contracted",
      label: l("contractedAt"),
      width: 135,
      sort: { asc: "contracted_asc", desc: "updated_desc" },
      render: (service) => date(service.contractedAt)
    },
    {
      id: "renewal",
      label: l("nextRenewalOrEnd"),
      width: 145,
      render: (service) => date(service.renewalAt ?? service.endsAt)
    },
    {
      id: "price",
      label: l("price"),
      width: 130,
      render: (service) =>
        service.financials ? (
          <>
            <strong>{money(service.financials.amountMinor * service.quantity, service.currency)}</strong>
            <small>{t[service.interval]}</small>
          </>
        ) : (
          "—"
        )
    },
    { id: "owner", label: l("owner"), width: 160, render: (service) => service.ownerName ?? "—" },
    {
      id: "project",
      label: l("project"),
      width: 170,
      render: (service) =>
        service.projectId ? <Link href={`/${locale}/projects/${service.projectId}`}>{service.projectName}</Link> : "—"
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

  return (
    <>
      {loadError && (
        <p className="crm-error">
          <AlertTriangle size={17} />
          {t.loadError}
        </p>
      )}
      <SmartDataTable
        tableId="commerce.customer-services"
        rows={services}
        columns={columns}
        preference={preference}
        total={total}
        page={page}
        pageSize={pageSize}
        pageParam="servicePage"
        pageSizeParam="servicePageSize"
        sortParam="serviceSort"
        sort={sort}
        sortOptions={[
          { value: "updated_desc", label: l("updatedDesc") },
          { value: "customer_asc", label: l("customerAsc") },
          { value: "product_asc", label: l("productAsc") },
          { value: "contracted_asc", label: l("contractedAsc") }
        ]}
        empty={l("emptyServices")}
        labels={tableLabels}
        primaryControls={
          <button className="primary-command" onClick={() => setOpen(true)}>
            <Plus size={17} />
            {t.addCustomerService}
          </button>
        }
      />
      {open && (
        <div className="dialog-backdrop" role="presentation">
          <section
            className="crm-dialog service-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="service-dialog-title"
          >
            <header>
              <div>
                <span>{t.customerServices}</span>
                <h2 id="service-dialog-title">{t.addCustomerService}</h2>
              </div>
              <button className="icon-button" onClick={() => setOpen(false)} aria-label={t.close}>
                <X size={18} />
              </button>
            </header>
            <form className="commerce-form" onSubmit={(event) => void create(event)}>
              {error && <p className="crm-error">{error}</p>}
              <label>
                {t.customer}
                <SelectControl
                  name="customerId"
                  required
                  value={customerId}
                  placeholder={t.selectCustomer}
                  onChange={(event) => setCustomerId(event.currentTarget.value)}
                  options={customers.map((customer) => ({ value: customer.id, label: customer.displayName }))}
                />
              </label>
              <label>
                {t.offer}
                <SelectControl
                  name="priceId"
                  required
                  value={priceId}
                  placeholder={t.selectOffer}
                  onChange={(event) => setPriceId(event.currentTarget.value)}
                  options={offers.map((offer) => ({
                    value: offer.id,
                    label: `${offer.product.name} · ${offer.plan.name} · ${t[offer.plan.commercialModel]}`
                  }))}
                />
              </label>
              <label>
                {t.quantity}
                <input name="quantity" type="number" min="1" max="1000000" defaultValue="1" required />
              </label>
              <label>
                {t.startsAt}
                <input name="startsAt" type="datetime-local" defaultValue={defaultStart} required />
              </label>
              <label>
                {t.endsAt}
                <input name="endsAt" type="datetime-local" />
              </label>
              <label>
                {t.owner}
                <SelectControl
                  name="ownerMembershipId"
                  defaultValue=""
                  placeholder={t.noOwner}
                  options={members.map((member) => ({ value: member.id, label: member.name }))}
                />
              </label>
              <label>
                {t.project}
                <SelectControl
                  name="projectId"
                  defaultValue=""
                  placeholder={t.noProject}
                  options={projects
                    .filter((project) => !customerId || project.customerId === customerId)
                    .map((project) => ({ value: project.id, label: `${project.code} · ${project.name}` }))}
                />
              </label>
              {recurring && (
                <>
                  <label>
                    {t.renewalAt}
                    <input name="renewalAt" type="datetime-local" />
                  </label>
                  <label>
                    {t.alertDays}
                    <input name="renewalAlertDays" type="number" min="0" max="365" defaultValue="14" />
                  </label>
                  <label className="inline-check">
                    <input name="autoRenew" type="checkbox" value="true" />
                    {t.autoRenew}
                  </label>
                </>
              )}
              <footer>
                <button type="button" className="secondary-button" onClick={() => setOpen(false)}>
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

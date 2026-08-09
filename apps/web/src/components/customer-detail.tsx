"use client";

import { Building2, CalendarClock, Check, Contact, History, ListTodo, Minus, Pencil, Plus, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { SelectControl } from "@/components/form-field";
import type { CustomerDetail as Customer } from "@/lib/api-types";
import { customerOverview } from "@/lib/customer-overview";
import { textEntries } from "@/lib/form";
import { actionHandler } from "@/lib/handlers";
import { parseAmountToMinor } from "@/lib/money";
import { adjustOpportunityProbability, opportunityProbabilityBand } from "@/lib/opportunity-probability";

type Labels = Record<string, string>;
type EditableCustomerField =
  | "displayName"
  | "legalName"
  | "billingEmail"
  | "phone"
  | "website"
  | "taxId"
  | "preferredLocale"
  | "timezone"
  | "status";

function EmptyState({ title, description }: { title: string | undefined; description: string | undefined }) {
  return (
    <div className="detail-empty">
      <strong>{title ?? ""}</strong>
      <p>{description ?? ""}</p>
    </div>
  );
}

export function CustomerDetail({
  customer,
  labels,
  locale,
  canReadFinancials
}: {
  customer: Customer;
  labels: Labels;
  locale: string;
  canReadFinancials: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [editingField, setEditingField] = useState<EditableCustomerField | null>(null);
  const [interestProbability, setInterestProbability] = useState(50);
  /** Last resort for a handler that rejected outright, so a failure is never silent. */
  const fail = () => setError("CRM_ERROR");
  const [pending, startTransition] = useTransition();
  const refresh = () => startTransition(() => router.refresh());
  async function submit(path: string, formData: FormData, extra: Record<string, unknown> = {}) {
    setError("");
    const body: Record<string, unknown> = { ...Object.fromEntries(textEntries(formData)), ...extra };
    if (typeof body.dueAt === "string") body.dueAt = new Date(body.dueAt).toISOString();
    const response = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      const payload = (await response.json()) as { code?: string };
      setError(payload.code ?? "CRM_ERROR");
      return;
    }
    refresh();
  }
  async function submitContact(formData: FormData) {
    await submit(`/api/v1/crm/customers/${customer.id}/contacts`, formData, {
      isPrimary: formData.get("isPrimary") === "true"
    });
  }
  async function complete(taskId: string) {
    const response = await fetch(`/api/v1/crm/tasks/${taskId}/complete`, { method: "POST" });
    if (response.ok) refresh();
    else setError("CRM_ERROR");
  }
  async function recoverSourceContact() {
    setError("");
    const response = await fetch(`/api/v1/crm/customers/${customer.id}/contacts/from-source-lead`, {
      method: "POST"
    });
    if (response.ok) refresh();
    else {
      const payload = (await response.json()) as { code?: string };
      setError(payload.code ?? "CRM_ERROR");
    }
  }
  async function updateCustomer(field: EditableCustomerField, value: string) {
    setError("");
    const editableValues = {
      displayName: customer.displayName,
      legalName: customer.legalName ?? "",
      billingEmail: customer.billingEmail ?? "",
      phone: customer.phone ?? "",
      website: customer.website ?? "",
      taxId: customer.taxId ?? "",
      preferredLocale: customer.preferredLocale ?? "",
      timezone: customer.timezone ?? "",
      status: customer.status,
      [field]: value
    };
    for (const optionalField of [
      "legalName",
      "billingEmail",
      "phone",
      "website",
      "taxId",
      "preferredLocale",
      "timezone"
    ] as const) {
      if (!editableValues[optionalField].trim()) delete editableValues[optionalField];
    }
    const response = await fetch(`/api/v1/crm/customers/${customer.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...editableValues, expectedUpdatedAt: customer.updatedAt })
    });
    if (response.ok) {
      setEditingField(null);
      refresh();
    } else {
      const payload = (await response.json()) as { code?: string };
      setError(payload.code ?? "CRM_ERROR");
    }
  }
  async function createInterest(formData: FormData) {
    setError("");
    const probability = formData.get("probability");
    const amount = formData.get("estimatedAmount");
    const body: Record<string, unknown> = {
      productId: formData.get("productId"),
      nextStep: formData.get("nextStep") || undefined,
      ...(probability ? { probability: Number(probability) } : {})
    };
    if (canReadFinancials && typeof amount === "string" && amount.trim()) {
      const parsed = parseAmountToMinor(amount);
      if ("error" in parsed) {
        setError("INVALID_INPUT");
        return;
      }
      body.estimatedAmountMinor = parsed.minor;
      body.currency = formData.get("currency");
    }
    const response = await fetch(`/api/v1/crm/customers/${customer.id}/interests`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
    if (response.ok) {
      setInterestProbability(50);
      refresh();
    } else {
      const payload = (await response.json()) as { code?: string };
      setError(payload.code ?? "CRM_ERROR");
    }
  }
  async function transitionInterest(interestId: string, stage: string) {
    setError("");
    const response = await fetch(`/api/v1/crm/interests/${interestId}/stage`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ stage })
    });
    if (response.ok) refresh();
    else {
      const payload = (await response.json()) as { code?: string };
      setError(payload.code ?? "CRM_ERROR");
    }
  }
  const nextInterestStages: Record<string, string[]> = {
    detected: ["qualified", "lost"],
    qualified: ["proposal", "lost"],
    proposal: ["negotiation", "lost"],
    negotiation: ["won", "lost"],
    won: [],
    lost: []
  };
  const editableField = (
    field: EditableCustomerField,
    label: string | undefined,
    value: string | null,
    inputType: "text" | "email" | "tel" | "website" | "select" | "locale" = "text"
  ) => {
    const editing = editingField === field;
    const fieldLabel = label ?? "";
    return (
      <div className={`customer-fact${editing ? " is-editing" : ""}`}>
        <dt>{fieldLabel}</dt>
        <dd>
          {editing ? (
            <form
              className="inline-field-editor"
              onSubmit={(event) => {
                event.preventDefault();
                const formData = new FormData(event.currentTarget);
                const value = formData.get("value");
                void updateCustomer(field, typeof value === "string" ? value : "");
              }}
            >
              {inputType === "select" ? (
                <SelectControl
                  name="value"
                  defaultValue={value ?? "active"}
                  autoFocus
                  disabled={pending}
                  options={[
                    { value: "active", label: labels.active ?? "" },
                    { value: "inactive", label: labels.inactive ?? "" }
                  ]}
                />
              ) : inputType === "locale" ? (
                <SelectControl
                  name="value"
                  defaultValue={value ?? ""}
                  autoFocus
                  disabled={pending}
                  options={[
                    { value: "", label: labels.notProvided ?? "" },
                    { value: "ca", label: "Català" },
                    { value: "es", label: "Español" },
                    { value: "en", label: "English" }
                  ]}
                />
              ) : (
                <input
                  name="value"
                  type={inputType === "website" ? "text" : inputType}
                  inputMode={inputType === "website" ? "url" : undefined}
                  defaultValue={value ?? ""}
                  required={field === "displayName"}
                  minLength={field === "displayName" ? 2 : undefined}
                  autoFocus
                  disabled={pending}
                />
              )}
              <button className="inline-field-action save" type="submit" title={labels.save} disabled={pending}>
                <Check size={15} />
              </button>
              <button
                className="inline-field-action"
                type="button"
                title={labels.cancel}
                onClick={() => setEditingField(null)}
                disabled={pending}
              >
                <X size={15} />
              </button>
            </form>
          ) : (
            <button
              className="inline-field-value"
              type="button"
              title={`${labels.edit ?? ""} ${fieldLabel.toLocaleLowerCase(locale)}`.trim()}
              onClick={() => {
                setError("");
                setEditingField(field);
              }}
            >
              <span>{value || labels.notProvided}</span>
              <Pencil size={13} aria-hidden="true" />
            </button>
          )}
        </dd>
      </div>
    );
  };
  async function createAddress(formData: FormData) {
    const body = { ...Object.fromEntries(textEntries(formData)), isPrimary: formData.get("isPrimary") === "true" };
    const response = await fetch(`/api/v1/crm/customers/${customer.id}/addresses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
    if (response.ok) refresh();
    else {
      const payload = (await response.json()) as { code?: string };
      setError(payload.code ?? "CRM_ERROR");
    }
  }
  async function deleteAddress(addressId: string) {
    const response = await fetch(`/api/v1/crm/customers/${customer.id}/addresses/${addressId}`, { method: "DELETE" });
    if (response.ok) refresh();
    else setError("CRM_ERROR");
  }
  const date = (value: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
  const overview = customerOverview(customer);
  const activityLabel = (type: string) => labels[type] ?? type.replaceAll(".", " · ");
  return (
    <div className="customer-detail" aria-busy={pending}>
      {error && (
        <p className="crm-error" role="alert">
          {labels[error] ?? error}
        </p>
      )}
      <section className="customer-overview-panel" aria-label={labels.customerOverview}>
        <div className="customer-company-card">
          <span className="overview-icon">
            <Building2 size={20} />
          </span>
          <div>
            <p className="eyebrow">{labels.companyData}</p>
            <h2>{customer.displayName}</h2>
            <dl className="customer-facts">
              {editableField("displayName", labels.displayName, customer.displayName)}
              {editableField("legalName", labels.legalName, customer.legalName)}
              {editableField("billingEmail", labels.billingEmail, customer.billingEmail, "email")}
              {editableField("phone", labels.phone, customer.phone, "tel")}
              {editableField("website", labels.website, customer.website, "website")}
              {editableField("taxId", labels.taxId, customer.taxId)}
              {editableField("preferredLocale", labels.preferredLocale, customer.preferredLocale, "locale")}
              {editableField("timezone", labels.timezone, customer.timezone)}
              {editableField("status", labels.status, customer.status, "select")}
              <div>
                <dt>{labels.customerSince}</dt>
                <dd>{date(customer.createdAt)}</dd>
              </div>
            </dl>
          </div>
        </div>
        <div className="customer-overview-metrics">
          <article>
            <Contact size={18} />
            <span>{labels.primaryContact}</span>
            <strong>{overview.primaryContact?.name ?? labels.notProvided}</strong>
          </article>
          <article>
            <ListTodo size={18} />
            <span>{labels.openTasks}</span>
            <strong>{overview.openTaskCount}</strong>
          </article>
          <article>
            <CalendarClock size={18} />
            <span>{labels.nextTask}</span>
            <strong>{overview.nextTask?.title ?? labels.noPendingTasks}</strong>
          </article>
          <article>
            <History size={18} />
            <span>{labels.lastActivity}</span>
            <strong>{overview.lastActivity ? activityLabel(overview.lastActivity.type) : labels.noActivity}</strong>
          </article>
        </div>
      </section>
      <section className="detail-panel customer-interests" aria-label={labels.interests}>
        <div className="section-heading">
          <div>
            <h2>{labels.interests}</h2>
            <p>{labels.interestsHint}</p>
          </div>
        </div>
        {customer.availableProducts.length > 0 && (
          <form className="interest-create" action={createInterest}>
            <SelectControl
              name="productId"
              required
              defaultValue=""
              placeholder={labels.selectProduct}
              aria-label={labels.selectProduct}
              options={customer.availableProducts.map((product) => ({ value: product.id, label: product.name }))}
            />
            <div className={`probability-control probability-${opportunityProbabilityBand(interestProbability)}`}>
              <div className="probability-adjustment">
                <button
                  type="button"
                  aria-label={labels.decreaseProbability}
                  disabled={interestProbability === 0}
                  onClick={() => setInterestProbability((value) => adjustOpportunityProbability(value, -1))}
                >
                  <Minus size={15} aria-hidden="true" />
                </button>
                <span
                  className="probability-track"
                  role="progressbar"
                  aria-label={labels.probability}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={interestProbability}
                >
                  <i style={{ width: `${interestProbability}%` }} />
                </span>
                <output aria-label={`${labels.probability}: ${interestProbability}%`}>{interestProbability}%</output>
                <button
                  type="button"
                  aria-label={labels.increaseProbability}
                  disabled={interestProbability === 100}
                  onClick={() => setInterestProbability((value) => adjustOpportunityProbability(value, 1))}
                >
                  <Plus size={15} aria-hidden="true" />
                </button>
              </div>
              <input name="probability" type="hidden" value={interestProbability} />
            </div>
            <input name="nextStep" maxLength={500} placeholder={labels.nextStep} />
            {canReadFinancials && (
              <input name="estimatedAmount" inputMode="decimal" placeholder={labels.estimatedAmount} />
            )}
            {canReadFinancials && (
              <SelectControl
                name="currency"
                defaultValue="EUR"
                aria-label={labels.currency}
                options={["EUR", "USD", "GBP"].map((currency) => ({ value: currency, label: currency }))}
              />
            )}
            <button className="primary-command">{labels.addInterest}</button>
          </form>
        )}
        {customer.interests.length === 0 && (
          <EmptyState title={labels.noInterests} description={labels.noInterestsHint} />
        )}
        {customer.interests.map((interest) => (
          <article className="interest-row" key={interest.id}>
            <div>
              <strong>{interest.productName}</strong>
              <small>{interest.nextStep ?? labels.noNextStep}</small>
            </div>
            {interest.probability === null ? (
              <span>—</span>
            ) : (
              <div className={`probability-summary probability-${opportunityProbabilityBand(interest.probability)}`}>
                <strong>{interest.probability}%</strong>
                <span className="probability-track" aria-hidden="true">
                  <i style={{ width: `${interest.probability}%` }} />
                </span>
              </div>
            )}
            {interest.estimatedAmountMinor !== undefined &&
              interest.estimatedAmountMinor !== null &&
              interest.currency && (
                <strong>
                  {new Intl.NumberFormat(locale, { style: "currency", currency: interest.currency }).format(
                    interest.estimatedAmountMinor / 100
                  )}
                </strong>
              )}
            <span className={`state state-${interest.stage}`}>{labels[interest.stage] ?? interest.stage}</span>
            {nextInterestStages[interest.stage]?.length ? (
              <SelectControl
                aria-label={labels.changeStage}
                defaultValue=""
                placeholder={labels.advanceStage}
                options={nextInterestStages[interest.stage]!.map((stage) => ({
                  value: stage,
                  label: labels[stage] ?? stage
                }))}
                onChange={(event) => {
                  if (event.target.value) void transitionInterest(interest.id, event.target.value);
                }}
              />
            ) : null}
          </article>
        ))}
      </section>
      <section className="detail-panel customer-addresses" aria-label={labels.addresses}>
        <h2>{labels.addresses}</h2>
        <form className="address-create" action={createAddress}>
          <SelectControl
            name="type"
            defaultValue="office"
            aria-label={labels.addressType}
            options={[
              { value: "office", label: labels.office ?? "" },
              { value: "billing", label: labels.billing ?? "" },
              { value: "shipping", label: labels.shipping ?? "" },
              { value: "other", label: labels.other ?? "" }
            ]}
          />
          <input name="label" placeholder={labels.addressLabel} />
          <input name="line1" required placeholder={labels.addressLine1} />
          <input name="line2" placeholder={labels.addressLine2} />
          <input name="postalCode" placeholder={labels.postalCode} />
          <input name="city" required placeholder={labels.city} />
          <input name="region" placeholder={labels.region} />
          <input
            name="countryCode"
            required
            minLength={2}
            maxLength={2}
            defaultValue="ES"
            placeholder={labels.countryCode}
          />
          <label className="inline-check">
            <input type="checkbox" name="isPrimary" value="true" /> {labels.primaryAddress}
          </label>
          <button className="primary-command">{labels.addAddress}</button>
        </form>
        {customer.addresses.length === 0 && (
          <EmptyState title={labels.noAddresses} description={labels.noAddressesHint} />
        )}
        <div className="address-list">
          {customer.addresses.map((address) => (
            <article key={address.id}>
              <div>
                <strong>{address.label ?? labels[address.type] ?? address.type}</strong>
                <span>
                  {address.line1}
                  {address.line2 ? ` · ${address.line2}` : ""}
                </span>
                <small>
                  {[address.postalCode, address.city, address.region, address.countryCode].filter(Boolean).join(" · ")}
                </small>
              </div>
              {address.isPrimary && <span className="state state-active">{labels.primary}</span>}
              <button
                className="inline-field-action"
                type="button"
                title={labels.deleteAddress}
                onClick={actionHandler(() => deleteAddress(address.id), fail)}
              >
                <X size={15} />
              </button>
            </article>
          ))}
        </div>
      </section>
      <section className="customer-relations" aria-label={labels.customerRelations}>
        <article className="detail-panel compact-panel">
          <h2>{labels.customerServices}</h2>
          {customer.services.length === 0 && (
            <EmptyState title={labels.noServices} description={labels.noServicesHint} />
          )}
          {customer.services.map((service) => (
            <div className="detail-row" key={service.id}>
              <div>
                <strong>{service.productName}</strong>
                <small>{service.planName}</small>
              </div>
              <span className={`state state-${service.status}`}>{labels[service.status] ?? service.status}</span>
            </div>
          ))}
        </article>
        <article className="detail-panel compact-panel">
          <h2>{labels.projects}</h2>
          {customer.projects.length === 0 && (
            <EmptyState title={labels.noProjects} description={labels.noProjectsHint} />
          )}
          {customer.projects.map((project) => (
            <Link className="detail-row" href={`/${locale}/projects/${project.id}`} key={project.id}>
              <div>
                <strong>{project.name}</strong>
                <small>{project.code}</small>
              </div>
              <span className={`state state-${project.status}`}>{labels[project.status] ?? project.status}</span>
            </Link>
          ))}
        </article>
        <article className="detail-panel compact-panel">
          <h2>{labels.supportTickets}</h2>
          {customer.tickets.length === 0 && <EmptyState title={labels.noTickets} description={labels.noTicketsHint} />}
          {customer.tickets.map((ticket) => (
            <Link className="detail-row" href={`/${locale}/support/${ticket.id}`} key={ticket.id}>
              <div>
                <strong>
                  #{ticket.ticketNumber} · {ticket.subject}
                </strong>
                <small>{labels[ticket.priority] ?? ticket.priority}</small>
              </div>
              <span className={`state state-${ticket.status}`}>{labels[ticket.status] ?? ticket.status}</span>
            </Link>
          ))}
        </article>
      </section>
      <section className="detail-column">
        <article className="detail-panel">
          <h2>{labels.contacts}</h2>
          <form className="inline-create contact-create" action={submitContact}>
            <input name="name" placeholder={labels.name} required minLength={2} />
            <input name="role" placeholder={labels.role} />
            <input name="email" type="email" placeholder={labels.email} />
            <input name="phone" type="tel" placeholder={labels.phone} />
            <label className="inline-check">
              <input name="isPrimary" type="checkbox" value="true" /> {labels.primary}
            </label>
            <button className="icon-button" title={labels.addContact}>
              <Plus size={18} />
            </button>
          </form>
          {customer.contacts.length === 0 && (
            <>
              <EmptyState title={labels.noContacts} description={labels.noContactsHint} />
              {customer.createdFromLeadId && (
                <button
                  type="button"
                  className="secondary-button recover-contact-button"
                  onClick={actionHandler(recoverSourceContact, fail)}
                >
                  <Plus size={16} />
                  {labels.recoverContactFromLead}
                </button>
              )}
            </>
          )}
          {customer.contacts.map((contact) => (
            <div className="detail-row" key={contact.id}>
              <div>
                <strong>{contact.name}</strong>
                <small>{contact.role ?? contact.email ?? contact.phone ?? "--"}</small>
              </div>
              {contact.isPrimary && <span className="state state-won">{labels.primary}</span>}
            </div>
          ))}
        </article>
        <article className="detail-panel">
          <h2>{labels.notes}</h2>
          <form className="inline-create" action={(data) => submit(`/api/v1/crm/customers/${customer.id}/notes`, data)}>
            <textarea name="body" placeholder={labels.addNote} required maxLength={10000} />
            <button className="icon-button" title={labels.addNote}>
              <Plus size={18} />
            </button>
          </form>
          {customer.notes.length === 0 && <EmptyState title={labels.noNotes} description={labels.noNotesHint} />}
          {customer.notes.map((note) => (
            <div className="detail-row stacked" key={note.id}>
              <p>{note.body}</p>
              <time>{date(note.createdAt)}</time>
            </div>
          ))}
        </article>
      </section>
      <section className="detail-column">
        <article className="detail-panel">
          <h2>{labels.tasks}</h2>
          <form className="inline-create" action={(data) => submit(`/api/v1/crm/customers/${customer.id}/tasks`, data)}>
            <input name="title" placeholder={labels.addTask} required maxLength={240} />
            <input name="dueAt" type="datetime-local" aria-label={labels.dueAt} />
            <button className="icon-button" title={labels.addTask}>
              <Plus size={18} />
            </button>
          </form>
          {customer.tasks.length === 0 && <EmptyState title={labels.noTasks} description={labels.noTasksHint} />}
          {customer.tasks.map((task) => (
            <div className="detail-row" key={task.id}>
              <div>
                <strong>{task.title}</strong>
                <small>{task.dueAt ? date(task.dueAt) : "--"}</small>
              </div>
              {task.completedAt ? (
                <span className="state state-won">{labels.complete}</span>
              ) : (
                <button
                  className="icon-button"
                  title={labels.complete}
                  onClick={actionHandler(() => complete(task.id), fail)}
                >
                  <Check size={17} />
                </button>
              )}
            </div>
          ))}
        </article>
        <article className="detail-panel">
          <h2>{labels.timeline}</h2>
          {customer.activity.length === 0 && (
            <EmptyState title={labels.noActivity} description={labels.noActivityHint} />
          )}
          {customer.activity.map((event) => (
            <div className="timeline-row" key={event.id}>
              <i />
              <div>
                <strong>{activityLabel(event.type)}</strong>
                <time>{date(event.occurredAt)}</time>
              </div>
            </div>
          ))}
        </article>
      </section>
    </div>
  );
}

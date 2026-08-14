"use client";

import { AlertTriangle, Plus, ShieldAlert, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import {
  ConfigForm,
  ConfigIssues,
  configReader,
  jsonHeaders,
  request,
  stateLabel,
  type ConfigIssue
} from "@/components/connector-forms";
import { ConnectorMark } from "@/components/connector-mark";
import { TextField } from "@/components/form-field";
import { SmartDataTable, type SmartColumn } from "@/components/smart-data-table";
import { StatusPill } from "@/components/status-pill";
import { useToast } from "@/components/toast";
import type {
  ConnectorCatalogueEntry,
  ConnectorInstance,
  ConnectorInstanceStatus,
  TablePreference
} from "@/lib/api-types";
import { configFromForm, connectCredentialKind } from "@/lib/connector-config";
import {
  connectorLabel,
  connectorSummary,
  credentialKindHint,
  credentialKindLabel,
  type Labels
} from "@/lib/connector-labels";
import { formValue } from "@/lib/form";
import { eventHandler } from "@/lib/handlers";
import { ageLabel, type ReadingAge } from "@/lib/infrastructure";
import { errorMessage, healthReason, healthTone, instanceStatusTone } from "@/lib/integrations";

/**
 * The integrations listing, and the dialog that connects a new one.
 *
 * Two things here are deliberate. Nothing a provider or a connector wrote is ever rendered: what
 * arrives from the API is a `code`, and what a person reads is our sentence for it, which is why
 * every failure goes through `errorMessage`. And a connector is configured through the fields it
 * declares, not through a JSON field: the catalogue says what to ask for, so the form is drawn
 * rather than typed.
 *
 * One integration on its own is `integration-detail.tsx`, on a route of its own. It used to be a
 * panel beside this table, which gave each of them half a screen to say something neither could
 * say in half a screen.
 *
 * Specification: `docs/specifications/connectors.md`.
 */


const instanceStatuses: ConnectorInstanceStatus[] = ["draft", "enabled", "disabled", "error"];

export function IntegrationsWorkspace({
  integrations,
  total,
  page,
  preference,
  catalogue,
  vaultAvailable,
  canManage,
  ages,
  labels: t,
  locale,
  loadError,
  sort
}: {
  integrations: ConnectorInstance[];
  total: number;
  page: number;
  preference: TablePreference;
  catalogue: ConnectorCatalogueEntry[];
  vaultAvailable: boolean;
  canManage: boolean;
  /**
   * How old each reading is, measured on the server and keyed by instance.
   *
   * Not computed here: "now" during a client render is a different instant from "now" during the
   * server render, and React calls that a hydration mismatch. The infrastructure screen already
   * settled this the same way.
   */
  ages: Record<string, ReadingAge | null>;
  labels: Labels;
  locale: string;
  loadError: boolean;
  sort: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [dialog, setDialog] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const [issues, setIssues] = useState<ConfigIssue[]>([]);
  /**
   * Which connector is being created, held here rather than read off the form on submit: the
   * fields below it change with it, so the choice has to drive a render. Empty until somebody
   * picks — a preselected connector would put an unrelated provider's questions in front of
   * whoever opened the dialog, and the first one alphabetically is nobody's likely answer.
   */
  const [type, setType] = useState("");
  const chosen = catalogue.find((connector) => connector.type === type);
  /** The secret this connector is connected with, if it is the sort that connects with one. */
  const secretKind = vaultAvailable ? connectCredentialKind(chosen) : null;

  function closeDialog() {
    setDialog(false);
    setType("");
    setIssues([]);
    setFormError("");
  }

  /** One integration is a route of its own, so a link to it is a link somebody can send. */
  const detailHref = (instance: ConnectorInstance) => `/${locale}/integrations/${instance.id}`;

  /**
   * Creating an integration, and giving it its secret, as one gesture.
   *
   * Two calls, because a secret does not travel through the route that creates an instance: the
   * vault is written by its own endpoint under its own permission, and putting a token in a
   * creation body would place it in whatever logs that route.
   *
   * Which means there is a moment where the instance exists and the secret does not. That is not
   * hidden and it is not undone: deleting a perfectly good integration because a second call
   * failed would turn a network blip into lost work. The dialog closes, the screen opens the new
   * integration, and the message says exactly what is missing — the credential form is right
   * there, and the instance is a draft that reaches nothing until somebody enables it.
   */
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const config = configFromForm(chosen?.configFields ?? [], configReader(data));
    const secret = formValue(data, "secret");
    setBusy(true);
    setFormError("");
    setIssues([]);
    const result = await request<{ integration: ConnectorInstance }>("/api/v1/integrations", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ connectorType: type, name: formValue(data, "name"), config })
    });
    if (!result.ok) {
      setBusy(false);
      setIssues(result.issues);
      return setFormError(errorMessage(t, result.code));
    }

    const created = result.data.integration;
    if (secretKind && secret !== "") {
      const written = await request<unknown>(
        `/api/v1/integrations/${created.id}/credentials/${encodeURIComponent(secretKind)}`,
        { method: "PUT", headers: jsonHeaders, body: JSON.stringify({ secret }) }
      );
      if (!written.ok) {
        setBusy(false);
        closeDialog();
        toast("error", t.createdWithoutCredential ?? "");
        return router.push(`/${locale}/integrations/${created.id}`);
      }
    }

    setBusy(false);
    closeDialog();
    toast("success", t.created ?? "");
    // Onto the new integration rather than back to the list: the screen it lands on is the one
    // holding the credential form and the enable button.
    router.push(`/${locale}/integrations/${created.id}`);
  }

  const columns: SmartColumn<ConnectorInstance>[] = [
    {
      id: "name",
      label: t.name!,
      render: (instance) => (
        <a className="ticket-subject" href={detailHref(instance)}>
          {instance.name}
        </a>
      )
    },
    {
      id: "type",
      label: t.type!,
      // The mark and the provider's own name, not the registry's kebab-case: `generic-webhook` is
      // what a URL wants, and it is not what anybody calls the thing they connected.
      render: (instance) => (
        <span className="cell-connector">
          <ConnectorMark type={instance.connectorType} size={17} />
          {connectorLabel(t, instance.connectorType)}
        </span>
      )
    },
    {
      id: "status",
      label: t.status!,
      render: (instance) => (
        <StatusPill tone={instanceStatusTone[instance.status]} label={stateLabel(t, "status", instance.status)} />
      ),
      filter: {
        parameter: "status",
        options: instanceStatuses.map((status) => ({ value: status, label: stateLabel(t, "status", status) }))
      }
    },
    {
      id: "health",
      label: t.health!,
      // The state and, when there is one, why. "Failing" on its own sends somebody into the
      // integration to find out what this line already knows.
      render: (instance) => {
        const reason = healthReason(t, instance.health.lastErrorCode);
        return (
          <span className="cell-health">
            <StatusPill
              tone={healthTone[instance.health.status]}
              label={stateLabel(t, "health", instance.health.status)}
            />
            {reason && <small>{reason}</small>}
          </span>
        );
      }
    },
    {
      id: "lastCheck",
      label: t.lastCheck!,
      /**
       * How old the reading is, not when it was taken. A timestamp makes the reader do the
       * subtraction, and the answer to "is this current?" is the whole reason the column exists.
       * A reading too old to trust says so: a row reading "healthy" from three hours ago is not
       * healthy, it is unobserved, and those two look identical without this.
       */
      render: (instance) => {
        const age = ages[instance.id];
        if (!age) return <span className="muted">{t.never}</span>;
        return (
          <time dateTime={instance.health.checkedAt!} className={age.stale ? "reading-stale" : undefined}>
            {ageLabel(t, age, t.never ?? "")}
            {age.stale && <small>{t.readingStale}</small>}
          </time>
        );
      }
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
      {!canManage && (
        <p className="notice notice-info">
          <ShieldAlert size={17} aria-hidden="true" />
          <span>{t.readOnlyNotice}</span>
        </p>
      )}
      <SmartDataTable
        tableId="integrations.list"
        rows={integrations}
        columns={columns}
        preference={preference}
        total={total}
        page={page}
        pageSize={preference.pageSize}
        pageParam="page"
        pageSizeParam="pageSize"
        sortParam="sort"
        sort={sort}
        sortOptions={[
          { value: "created_desc", label: t.sortNewest! },
          { value: "name_asc", label: t.sortName! }
        ]}
        empty={t.empty!}
        labels={t}
        rowHref={detailHref}
        primaryControls={
          canManage ? (
            <button
              className="primary-command"
              disabled={catalogue.length === 0}
              onClick={() => {
                setFormError("");
                setIssues([]);
                setDialog(true);
              }}
            >
              <Plus size={17} />
              {t.newIntegration}
            </button>
          ) : undefined
        }
      />

      {dialog && (
        <div
          className="dialog-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeDialog();
          }}
        >
          <section className="crm-dialog" role="dialog" aria-modal="true">
            <header>
              <h2>
                {chosen && <ConnectorMark type={chosen.type} size={20} />}
                {chosen ? connectorLabel(t, chosen.type) : t.newIntegration}
              </h2>
              <button className="icon-button" onClick={closeDialog} aria-label={t.cancel}>
                <X size={18} />
              </button>
            </header>
            {/* Two steps, not two dialogs: pick the platform, then answer only what that platform
                asks. A single form would have to hold every connector's questions at once. */}
            {!chosen ? (
              <div className="dialog-form">
                <p className="field-help wide">{t.pickConnector}</p>
                <ConnectorPicker catalogue={catalogue} labels={t} onPick={setType} />
              </div>
            ) : (
              <form className="dialog-form" onSubmit={eventHandler(create, () => setBusy(false))}>
                <TextField
                  label={t.integrationName!}
                  name="name"
                  required
                  minLength={2}
                  maxLength={120}
                  disabled={busy}
                />
                <ConfigForm
                  type={chosen.type}
                  fields={chosen.configFields}
                  config={{}}
                  issues={issues}
                  busy={busy}
                  version={type}
                  labels={t}
                />
                {/* Optional on purpose: somebody who has not been given the token yet should still
                    be able to create the integration and come back to it. */}
                {secretKind && (
                  <TextField
                    label={credentialKindLabel(t, secretKind)}
                    name="secret"
                    type="password"
                    maxLength={8192}
                    disabled={busy}
                    wide
                    autoComplete="off"
                    spellCheck={false}
                    {...(credentialKindHint(t, chosen.type, secretKind)
                      ? { hint: credentialKindHint(t, chosen.type, secretKind) }
                      : {})}
                  />
                )}
                <ConfigIssues issues={issues} fields={chosen.configFields} />
                {formError && (
                  <p className="form-error wide" role="alert">
                    {formError}
                  </p>
                )}
                <footer>
                  <button type="button" className="secondary-button" onClick={() => setType("")} disabled={busy}>
                    {t.back}
                  </button>
                  <button className="primary-button" disabled={busy}>
                    {t.create}
                  </button>
                </footer>
              </form>
            )}
          </section>
        </div>
      )}
    </>
  );
}

/**
 * What a connector refused, path by path.
 *
 * The path and the code, and nothing of what was typed: a configuration is where somebody pastes a
 * token by mistake, and echoing the value back would put it in a screenshot.
 */
/** The name a connector's field takes in a form, kept apart from the form's own fields. */
/**
 * The catalogue: what this build can connect to, as a thing to point at rather than a list to
 * read. Choosing is a separate step from filling anything in, so the form that follows belongs to
 * one provider and asks only what that provider needs.
 */
function ConnectorPicker({
  catalogue,
  labels: t,
  onPick
}: {
  catalogue: ConnectorCatalogueEntry[];
  labels: Labels;
  onPick: (type: string) => void;
}) {
  return (
    <div className="connector-picker wide">
      {catalogue.map((connector) => (
        <button type="button" key={connector.type} className="connector-card" onClick={() => onPick(connector.type)}>
          <ConnectorMark type={connector.type} />
          <strong>{connectorLabel(t, connector.type)}</strong>
          <small>{connectorSummary(t, connector.type)}</small>
        </button>
      ))}
    </div>
  );
}

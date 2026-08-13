"use client";

import {
  AlertTriangle,
  Check,
  Copy,
  KeyRound,
  Plus,
  Power,
  PowerOff,
  ShieldAlert,
  Stethoscope,
  Trash2,
  Webhook,
  X
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { SelectField, TextField, ToggleField } from "@/components/form-field";
import { SmartDataTable, type SmartColumn } from "@/components/smart-data-table";
import { StatusPill, type StatusTone } from "@/components/status-pill";
import { useToast } from "@/components/toast";
import type {
  ConnectorCatalogueEntry,
  ConnectorConfigField,
  ConnectorInstance,
  ConnectorInstanceStatus,
  ConnectorRun,
  CreatedConnectorEndpointResponse,
  IntegrationDetail,
  TablePreference
} from "@/lib/api-types";
import { configFromForm, fieldValue, isChecked, type FormReader } from "@/lib/connector-config";
import { formValue } from "@/lib/form";
import { eventHandler } from "@/lib/handlers";
import { errorMessage, healthTone, instanceStatusTone, problemCode, webhookUrl } from "@/lib/integrations";

/**
 * The integrations screen.
 *
 * Three things here are deliberate. Nothing a provider or a connector wrote is ever rendered: what
 * arrives from the API is a `code`, and what a person reads is our sentence for it, which is why
 * every failure goes through `errorMessage`. The address and the signing secret are shown once,
 * with the warning above the button that mints them rather than beside the result — a warning read
 * after the fact is not a warning. And a connector is configured through the fields it declares,
 * not through a JSON field: the catalogue says what to ask for, so the form is drawn rather than
 * typed, and the one connector shape this build does not ship is shown read-only instead.
 *
 * Specification: `docs/specifications/connectors.md`.
 */

type Labels = Record<string, string>;

/** What the API says is wrong with a configuration: a path inside it and a code, never a value. */
type ConfigIssue = { path: string; code: string };

type Failure = { ok: false; code: string | null; issues: ConfigIssue[] };
type Result<T> = { ok: true; data: T } | Failure;

function readIssues(payload: unknown): ConfigIssue[] {
  if (typeof payload !== "object" || payload === null) return [];
  const issues = (payload as { params?: { issues?: unknown } }).params?.issues;
  if (!Array.isArray(issues)) return [];
  return issues.flatMap((issue: unknown) => {
    if (typeof issue !== "object" || issue === null) return [];
    const { path, code } = issue as { path?: unknown; code?: unknown };
    return typeof path === "string" && typeof code === "string" ? [{ path, code }] : [];
  });
}

async function request<T>(path: string, init?: RequestInit): Promise<Result<T>> {
  const response = await fetch(path, init);
  const payload: unknown = await response.json().catch(() => null);
  if (response.ok) return { ok: true, data: payload as T };
  return { ok: false, code: problemCode(payload), issues: readIssues(payload) };
}

const jsonHeaders = { "content-type": "application/json" };

function moment(value: string | null, locale: string, fallback: string): string {
  return value ? new Date(value).toLocaleString(locale) : fallback;
}

/** `enabled` becomes `statusEnabled` and `healthEnabled`: one derivation, no table to keep in step. */
function stateLabel(t: Labels, prefix: "status" | "health", state: string): string {
  return t[`${prefix}${state.charAt(0).toUpperCase()}${state.slice(1)}`] ?? state;
}

const runTone: Record<ConnectorRun["status"], StatusTone> = {
  running: "active",
  succeeded: "done",
  failed: "danger",
  dead_letter: "closed"
};

const runLabel: Record<ConnectorRun["status"], string> = {
  running: "runRunning",
  succeeded: "runSucceeded",
  failed: "runFailed",
  dead_letter: "runDeadLetter"
};

const instanceStatuses: ConnectorInstanceStatus[] = ["draft", "enabled", "disabled", "error"];

export function IntegrationsWorkspace({
  integrations,
  total,
  page,
  preference,
  catalogue,
  detail,
  canManage,
  canRotate,
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
  detail: IntegrationDetail | null;
  canManage: boolean;
  canRotate: boolean;
  labels: Labels;
  locale: string;
  loadError: boolean;
  sort: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const [dialog, setDialog] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const [issues, setIssues] = useState<ConfigIssue[]>([]);
  /**
   * Which connector is being created, held here rather than read off the form on submit: the
   * fields below it change with it, so the choice has to drive a render.
   */
  const [type, setType] = useState(catalogue[0]?.type ?? "");
  const chosen = catalogue.find((connector) => connector.type === type);

  /** The selection lives in the query string, so a selected integration is a link somebody can send. */
  function href(changes: Record<string, string | null>) {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(changes)) {
      if (value === null) next.delete(key);
      else next.set(key, value);
    }
    const query = next.toString();
    return query ? `?${query}` : `/${locale}/integrations`;
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const config = configFromForm(chosen?.configFields ?? [], configReader(data));
    setBusy(true);
    setFormError("");
    setIssues([]);
    const result = await request<unknown>("/api/v1/integrations", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ connectorType: type, name: formValue(data, "name"), config })
    });
    setBusy(false);
    if (!result.ok) {
      setIssues(result.issues);
      return setFormError(errorMessage(t, result.code));
    }
    setDialog(false);
    toast("success", t.created ?? "");
    router.refresh();
  }

  const columns: SmartColumn<ConnectorInstance>[] = [
    {
      id: "name",
      label: t.name!,
      render: (instance) => (
        <a className="ticket-subject" href={href({ selected: instance.id })}>
          {instance.name}
        </a>
      )
    },
    {
      id: "type",
      label: t.type!,
      render: (instance) => <span className="ticket-reference">{instance.connectorType}</span>
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
      render: (instance) => (
        <StatusPill tone={healthTone[instance.health.status]} label={stateLabel(t, "health", instance.health.status)} />
      )
    },
    {
      id: "lastCheck",
      label: t.lastCheck!,
      render: (instance) =>
        instance.health.checkedAt ? (
          <time dateTime={instance.health.checkedAt}>{new Date(instance.health.checkedAt).toLocaleString(locale)}</time>
        ) : (
          <span className="muted">{t.never}</span>
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
      {!canManage && (
        <p className="notice notice-info">
          <ShieldAlert size={17} aria-hidden="true" />
          <span>{t.readOnlyNotice}</span>
        </p>
      )}
      <div className={detail ? "integrations-layout selected" : "integrations-layout"}>
        <div>
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
            rowHref={(instance) => href({ selected: instance.id })}
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
        </div>
        {detail && (
          // Keyed by the integration: selecting another one must not carry over an edited
          // configuration, and above all must not carry over a minted secret.
          <IntegrationPanel
            key={detail.instance.id}
            detail={detail}
            entry={catalogue.find((candidate) => candidate.type === detail.instance.connectorType)}
            canManage={canManage}
            canRotate={canRotate}
            labels={t}
            locale={locale}
            closeHref={href({ selected: null })}
          />
        )}
      </div>

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
              <h2>{t.newIntegration}</h2>
              <button className="icon-button" onClick={() => setDialog(false)} aria-label={t.cancel}>
                <X size={18} />
              </button>
            </header>
            <form className="dialog-form" onSubmit={eventHandler(create, () => setBusy(false))}>
              <SelectField
                label={t.connectorType!}
                name="connectorType"
                required
                disabled={busy}
                value={type}
                onChange={(event) => {
                  setType(event.currentTarget.value);
                  setIssues([]);
                }}
                options={catalogue.map((connector) => ({
                  value: connector.type,
                  label: connectorLabel(t, connector.type)
                }))}
              />
              <TextField
                label={t.integrationName!}
                name="name"
                required
                minLength={2}
                maxLength={120}
                disabled={busy}
              />
              <ConfigFields
                fields={chosen?.configFields ?? []}
                config={{}}
                issues={issues}
                busy={busy}
                version={type}
                labels={t}
              />
              <ConfigIssues issues={issues} fields={chosen?.configFields ?? []} />
              {formError && (
                <p className="form-error wide" role="alert">
                  {formError}
                </p>
              )}
              <footer>
                <button type="button" className="secondary-button" onClick={() => setDialog(false)} disabled={busy}>
                  {t.cancel}
                </button>
                <button className="primary-button" disabled={busy}>
                  {t.create}
                </button>
              </footer>
            </form>
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
const fieldName = (name: string) => `config.${name}`;

/** Reads a connector's fields out of a submitted form, as `configFromForm` wants them. */
const configReader =
  (data: FormData): FormReader =>
  (name) => {
    const value = data.get(fieldName(name));
    return typeof value === "string" ? value : null;
  };

/** A connector nobody has translated is still usable: its own key is a worse label, not no label. */
const fieldLabel = (t: Labels, name: string) => t[`field_${name}`] ?? name;

/** The connector's name as a person says it, falling back to the type the registry uses. */
export const connectorLabel = (t: Labels, type: string) => t[`connector_${type}`] ?? type;

/**
 * What the schema said is wrong, in words.
 *
 * The API sends a zod code and never the value, so this is a fixed vocabulary rather than a
 * message somebody wrote about one field. An unrecognised code still says something useful.
 */
const issueMessage = (t: Labels, code: string) => t[`issue_${code}`] ?? t.issueInvalid ?? "";

const inputType: Record<ConnectorConfigField["kind"], string> = {
  url: "url",
  text: "text",
  number: "number",
  toggle: "checkbox",
  list: "text"
};

/**
 * The form a connector asked for.
 *
 * Which fields exist, and which of them may be left blank, are the connector's own answers,
 * carried by the catalogue — so this draws a form for a provider it has never heard of, and a
 * connector added in a later release needs no change here. What it does own is the mapping from a
 * declared kind to a control, and putting a rejected value's complaint on the field it belongs to
 * instead of in a list underneath.
 *
 * `version` remounts the inputs after a save: they are uncontrolled, so without it the browser
 * would keep showing what was typed rather than what the server stored.
 */
function ConfigFields({
  fields,
  config,
  issues,
  busy,
  version,
  labels: t
}: {
  fields: readonly ConnectorConfigField[];
  config: Record<string, unknown>;
  issues: ConfigIssue[];
  busy: boolean;
  version: string;
  labels: Labels;
}) {
  return (
    <>
      {fields.map((field) => {
        const key = `${version}:${field.name}`;
        const label = fieldLabel(t, field.name);
        const hint = t[`fieldHint_${field.name}`];
        const issue = issues.find((candidate) => candidate.path === field.name);

        if (field.kind === "toggle") {
          return (
            <ToggleField
              key={key}
              label={label}
              name={fieldName(field.name)}
              defaultChecked={isChecked(field, config)}
              disabled={busy}
              {...(hint ? { hint } : {})}
            />
          );
        }

        return (
          <TextField
            key={key}
            label={label}
            name={fieldName(field.name)}
            type={inputType[field.kind]}
            required={field.required}
            disabled={busy}
            defaultValue={fieldValue(field, config)}
            spellCheck={false}
            wide={field.kind === "list"}
            {...(hint ? { hint } : {})}
            {...(issue ? { error: issueMessage(t, issue.code) } : {})}
          />
        );
      })}
    </>
  );
}

/**
 * The complaints no field claimed.
 *
 * A path that names a declared field is shown on that field, so what reaches here is what has
 * nowhere better to go: a rejection of the configuration as a whole, or a key the connector no
 * longer declares. Rendered as path and code, untranslated, because that is a developer's problem
 * and dressing it up as a sentence would only make it harder to search for.
 */
function ConfigIssues({ issues, fields }: { issues: ConfigIssue[]; fields: readonly ConnectorConfigField[] }) {
  const named = new Set(fields.map((field) => field.name));
  const orphans = issues.filter((issue) => !named.has(issue.path));
  if (orphans.length === 0) return null;
  return (
    <ul className="integration-issues wide">
      {orphans.map((issue) => (
        <li key={`${issue.path}:${issue.code}`}>
          <code>{issue.path || "/"}</code> {issue.code}
        </li>
      ))}
    </ul>
  );
}

/**
 * Writing a credential.
 *
 * The one direction this API has. A secret is written and never read back — no route returns one,
 * so the panel above this form can only ever list metadata — and the value does not survive the
 * submit either: it is read out of the form, sent, and the form is reset. Nothing here keeps it in
 * state, in the query string or in storage.
 *
 * Writing a second value for a kind that already has one opens a rotation rather than replacing
 * anything, which is what makes a key change survivable: both are accepted until the new one is
 * promoted. The hint says so, because a form that quietly did something different from what the
 * operator expected is how a rotation gets left half done.
 */
function CredentialForm({
  instanceId,
  kinds,
  labels: t
}: {
  instanceId: string;
  kinds: readonly string[];
  labels: Labels;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  async function write(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Captured before the await: after it, React has already pointed `currentTarget` at nothing.
    const form = event.currentTarget;
    const data = new FormData(form);
    const kind = formValue(data, "kind");
    setBusy(true);
    const result = await request<unknown>(
      `/api/v1/integrations/${instanceId}/credentials/${encodeURIComponent(kind)}`,
      { method: "PUT", headers: jsonHeaders, body: JSON.stringify({ secret: formValue(data, "secret") }) }
    );
    setBusy(false);
    if (!result.ok) return toast("error", errorMessage(t, result.code));
    form.reset();
    toast("success", t.credentialWritten ?? "");
    router.refresh();
  }

  return (
    <form className="dialog-form" onSubmit={eventHandler(write, () => setBusy(false))}>
      {kinds.length > 1 ? (
        <SelectField
          label={t.credentialKind!}
          name="kind"
          required
          disabled={busy}
          options={kinds.map((kind) => ({ value: kind, label: t[`credentialKind_${kind}`] ?? kind }))}
        />
      ) : (
        <input type="hidden" name="kind" value={kinds[0]} />
      )}
      <TextField
        label={t.credentialSecret!}
        name="secret"
        type="password"
        required
        minLength={8}
        maxLength={8192}
        disabled={busy}
        wide
        autoComplete="off"
        spellCheck={false}
        hint={t.credentialSecretHint}
      />
      <button className="primary-button" disabled={busy}>
        <KeyRound size={16} aria-hidden="true" />
        {t.credentialWrite}
      </button>
    </form>
  );
}

function IntegrationPanel({
  detail,
  entry,
  canManage,
  canRotate,
  labels: t,
  locale,
  closeHref
}: {
  detail: IntegrationDetail;
  entry: ConnectorCatalogueEntry | undefined;
  canManage: boolean;
  canRotate: boolean;
  labels: Labels;
  locale: string;
  closeHref: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [issues, setIssues] = useState<ConfigIssue[]>([]);
  // Held in memory and nowhere else: not in the query string, not in storage, and gone the moment
  // this panel unmounts. The only copy that outlives the render is the one the person saved.
  const [minted, setMinted] = useState<{ url: string; secret: string } | null>(null);
  const instance = detail.instance;
  const live = detail.endpoints.filter((endpoint) => !endpoint.revokedAt);

  const fail = (result: Failure) => toast("error", errorMessage(t, result.code));
  const crashed = () => {
    setBusy(false);
    toast("error", errorMessage(t, null));
  };

  function copy(value: string) {
    void navigator.clipboard.writeText(value).then(
      () => toast("success", t.copied ?? ""),
      () => toast("error", errorMessage(t, null))
    );
  }

  /** Every action on this integration: one shape, one failure path, one refresh. */
  async function act(path: string, method: "POST" | "DELETE", message: string) {
    setBusy(true);
    const result = await request<unknown>(path, { method });
    setBusy(false);
    if (!result.ok) return fail(result);
    toast("success", message);
    router.refresh();
  }

  async function saveConfig(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const config = configFromForm(entry?.configFields ?? [], configReader(new FormData(event.currentTarget)));
    setBusy(true);
    setIssues([]);
    const result = await request<unknown>(`/api/v1/integrations/${instance.id}`, {
      method: "PATCH",
      headers: jsonHeaders,
      body: JSON.stringify({ config })
    });
    setBusy(false);
    if (!result.ok) {
      setIssues(result.issues);
      return fail(result);
    }
    toast("success", t.configurationSaved ?? "");
    router.refresh();
  }

  async function mintEndpoint() {
    setBusy(true);
    const result = await request<CreatedConnectorEndpointResponse>(`/api/v1/integrations/${instance.id}/endpoints`, {
      method: "POST"
    });
    setBusy(false);
    if (!result.ok) return fail(result);
    // The API answers with a path, because it does not know its own public address. The browser
    // does: it is talking to it.
    setMinted({ url: webhookUrl(window.location.origin, result.data.path), secret: result.data.secret });
  }

  /**
   * Acknowledging is what refreshes the page.
   *
   * Refreshing when the secret is minted would re-render this panel and replace the one showing of
   * the secret with a table row. The person says when they have finished reading it.
   */
  function acknowledge() {
    setMinted(null);
    router.refresh();
  }

  return (
    <section className="detail-column" aria-label={instance.name}>
      <article className="detail-panel">
        <div className="panel-heading">
          <div>
            <p>{instance.connectorType}</p>
            <h2>{instance.name}</h2>
          </div>
          <a className="icon-button" href={closeHref} aria-label={t.close}>
            <X size={18} />
          </a>
        </div>
        <div className="integration-states">
          <StatusPill tone={instanceStatusTone[instance.status]} label={stateLabel(t, "status", instance.status)} />
          <StatusPill
            tone={healthTone[instance.health.status]}
            label={stateLabel(t, "health", instance.health.status)}
          />
        </div>
        <div className="detail-row">
          <span>{t.lastCheck}</span>
          <strong>{moment(instance.health.checkedAt, locale, t.never ?? "")}</strong>
        </div>
        <div className="detail-row">
          <span>{t.lastError}</span>
          <strong>{instance.health.lastErrorCode ? errorMessage(t, instance.health.lastErrorCode) : t.noError}</strong>
        </div>
        <div className="detail-row">
          <span>{t.configVersion}</span>
          <strong>{instance.configVersion}</strong>
        </div>
        {canManage && (
          <div className="dialog-actions">
            {instance.status === "enabled" ? (
              <button
                className="secondary-button"
                disabled={busy}
                onClick={eventHandler(
                  () => act(`/api/v1/integrations/${instance.id}/disable`, "POST", t.instanceDisabled ?? ""),
                  crashed
                )}
              >
                <PowerOff size={16} aria-hidden="true" />
                {t.disable}
              </button>
            ) : (
              <button
                className="secondary-button"
                disabled={busy}
                onClick={eventHandler(
                  () => act(`/api/v1/integrations/${instance.id}/enable`, "POST", t.instanceEnabled ?? ""),
                  crashed
                )}
              >
                <Power size={16} aria-hidden="true" />
                {t.enable}
              </button>
            )}
            <button
              className="secondary-button"
              disabled={busy || instance.status !== "enabled"}
              onClick={eventHandler(
                () => act(`/api/v1/integrations/${instance.id}/health-checks`, "POST", t.healthQueued ?? ""),
                crashed
              )}
            >
              <Stethoscope size={16} aria-hidden="true" />
              {t.checkHealth}
            </button>
          </div>
        )}
      </article>

      <article className="detail-panel">
        <h2>{t.configuration}</h2>
        {/* A connector this build no longer ships has no fields to draw and nothing that would
            accept an edit, so its configuration is shown rather than offered. */}
        {canManage && entry ? (
          <form className="dialog-form" onSubmit={eventHandler(saveConfig, crashed)}>
            <ConfigFields
              fields={entry.configFields}
              config={instance.config}
              issues={issues}
              busy={busy}
              version={`${instance.id}:${instance.configVersion}`}
              labels={t}
            />
            <ConfigIssues issues={issues} fields={entry.configFields} />
            <button className="primary-button" disabled={busy}>
              {t.save}
            </button>
          </form>
        ) : (
          <pre className="integration-config">{JSON.stringify(instance.config, null, 2)}</pre>
        )}
      </article>

      {entry?.capabilities.ingress && detail.vaultAvailable && (
        <article className="detail-panel">
          <h2>{t.endpoints}</h2>
          <p className="field-help">{t.endpointsDescription}</p>
          {minted ? (
            <div className="integration-secret">
              <h3>{t.endpointSecretTitle}</h3>
              <span className="field-label">{t.endpointUrlLabel}</span>
              <div>
                <code>{minted.url}</code>
                <button className="icon-button" onClick={() => copy(minted.url)} aria-label={t.copy}>
                  <Copy size={15} />
                </button>
              </div>
              <span className="field-label">{t.endpointSecretLabel}</span>
              <div>
                <code>{minted.secret}</code>
                <button className="icon-button" onClick={() => copy(minted.secret)} aria-label={t.copy}>
                  <Copy size={15} />
                </button>
              </div>
              <button className="primary-button" onClick={acknowledge}>
                <Check size={16} aria-hidden="true" />
                {t.secretAcknowledge}
              </button>
            </div>
          ) : (
            canManage &&
            live.length === 0 && (
              <>
                {/* Above the button, not beside the result: a warning read afterwards is not a
                    warning. */}
                <p className="notice notice-warning">
                  <AlertTriangle size={17} aria-hidden="true" />
                  <span>{t.endpointSecretWarning}</span>
                </p>
                <button className="secondary-button" disabled={busy} onClick={eventHandler(mintEndpoint, crashed)}>
                  <Webhook size={16} aria-hidden="true" />
                  {t.generateEndpoint}
                </button>
              </>
            )
          )}
          {detail.endpoints.length === 0 ? (
            <p className="crm-empty">{t.noEndpoints}</p>
          ) : (
            detail.endpoints.map((endpoint) => (
              <div className="detail-row" key={endpoint.id}>
                <span>
                  <strong>{t.endpointCreatedAt}</strong>
                  <time dateTime={endpoint.createdAt}>{moment(endpoint.createdAt, locale, "")}</time>
                </span>
                <span className="table-action-group">
                  <StatusPill
                    tone={endpoint.revokedAt ? "closed" : "active"}
                    label={endpoint.revokedAt ? t.endpointRevoked! : t.endpointLive!}
                  />
                  {canManage && !endpoint.revokedAt && (
                    <button
                      className="icon-button danger"
                      disabled={busy}
                      aria-label={t.revokeEndpoint}
                      onClick={eventHandler(
                        () =>
                          act(
                            `/api/v1/integrations/${instance.id}/endpoints/${endpoint.id}`,
                            "DELETE",
                            t.endpointRevokedToast ?? ""
                          ),
                        crashed
                      )}
                    >
                      <Trash2 size={15} />
                    </button>
                  )}
                </span>
              </div>
            ))
          )}
        </article>
      )}

      {detail.vaultAvailable && (
        <article className="detail-panel">
          <h2>{t.credentials}</h2>
          <p className="field-help">{t.credentialsDescription}</p>
          {detail.credentials.length === 0 ? (
            <p className="crm-empty">{t.noCredentials}</p>
          ) : (
            detail.credentials.map((credential) => (
              <div className="detail-row" key={credential.id}>
                <span>
                  {/* The same words the form above offers: a list naming `api_token` beside a
                      field offering "Token de l'API" reads as two different things. */}
                  <strong>{t[`credentialKind_${credential.kind}`] ?? credential.kind}</strong>
                  <small>
                    {t.credentialSlot}: {credential.slot === "primary" ? t.slotPrimary : t.slotSecondary}
                  </small>
                </span>
                <span>
                  <small>
                    {t.lastUsed}: {moment(credential.lastUsedAt, locale, t.never ?? "")}
                  </small>
                  <small>
                    {t.expiresAt}: {moment(credential.expiresAt, locale, t.never ?? "")}
                  </small>
                </span>
              </div>
            ))
          )}
          {/* Writing needs `credentials:rotate`, which is not the permission that manages an
              integration: whoever may change a base URL may not thereby hold its token. */}
          {canRotate && entry && entry.credentialKinds.length > 0 && (
            <CredentialForm instanceId={instance.id} kinds={entry.credentialKinds} labels={t} />
          )}
        </article>
      )}

      <article className="detail-panel">
        <h2>{t.runs}</h2>
        {detail.runs.length === 0 ? (
          <p className="crm-empty">{t.noRuns}</p>
        ) : (
          <ul className="timeline">
            {detail.runs.map((run) => (
              <li key={run.id}>
                <StatusPill tone={runTone[run.status]} label={t[runLabel[run.status]]!} />
                <div>
                  <p className="timeline-title">{run.operation}</p>
                  <p className="timeline-meta">
                    <time dateTime={run.startedAt}>{moment(run.startedAt, locale, "")}</time>
                    <span>
                      {t.attempt} {run.attempt}
                    </span>
                    <span>
                      {t.items} {run.itemsProcessed}
                    </span>
                    {run.errorCode && <span>{errorMessage(t, run.errorCode)}</span>}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </article>
    </section>
  );
}

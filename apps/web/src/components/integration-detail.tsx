"use client";

import {
  AlertTriangle,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Power,
  PowerOff,
  ShieldAlert,
  Stethoscope,
  Trash2,
  Webhook
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import {
  ConfigForm,
  ConfigIssues,
  CredentialForm,
  configReader,
  jsonHeaders,
  moment,
  request,
  runLabel,
  runTone,
  stateLabel,
  type ConfigIssue,
  type Failure
} from "@/components/connector-forms";
import { TextField } from "@/components/form-field";
import { StatusPill } from "@/components/status-pill";
import { useToast } from "@/components/toast";
import type {
  ConnectorCatalogueEntry,
  ConnectorRun,
  ConnectorRunsResponse,
  CreatedConnectorEndpointResponse,
  IntegrationDetail
} from "@/lib/api-types";
import { configFromForm } from "@/lib/connector-config";
import { credentialKindLabel, type Labels } from "@/lib/connector-labels";
import { eventHandler } from "@/lib/handlers";
import { errorMessage, healthTone, instanceStatusTone, runErrorMessage, webhookUrl } from "@/lib/integrations";

/**
 * One integration, on a page of its own.
 *
 * It used to be a panel beside the listing, which meant the configuration, the ingress address,
 * the credentials and the run history all shared half a screen with a table nobody was reading at
 * the time. A route instead: it has an address somebody can send, it inherits the back navigation
 * every other detail screen in the product has, and the listing gets its width back.
 *
 * Specification: `docs/specifications/connectors.md`.
 */

export function IntegrationDetailScreen({
  detail,
  entry,
  canManage,
  canRotate,
  labels: t,
  locale
}: {
  detail: IntegrationDetail;
  entry: ConnectorCatalogueEntry | undefined;
  canManage: boolean;
  canRotate: boolean;
  labels: Labels;
  locale: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [issues, setIssues] = useState<ConfigIssue[]>([]);
  // Held in memory and nowhere else: not in the query string, not in storage, and gone the moment
  // this screen unmounts. The only copy that outlives the render is the one the person saved.
  const [minted, setMinted] = useState<{ url: string; secret: string } | null>(null);
  const [removing, setRemoving] = useState(false);
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
   * Refreshing when the secret is minted would re-render this screen and replace the one showing
   * of the secret with a table row. The person says when they have finished reading it.
   */
  function acknowledge() {
    setMinted(null);
    router.refresh();
  }

  /**
   * Removing it, and then leaving: there is no longer a page here to return to.
   *
   * `replace` rather than `push`, so the back button does not offer a route that now answers 404.
   */
  async function remove() {
    setBusy(true);
    const result = await request<unknown>(`/api/v1/integrations/${instance.id}`, { method: "DELETE" });
    if (!result.ok) {
      setBusy(false);
      return fail(result);
    }
    toast("success", (t.instanceDeleted ?? "").replace("{name}", instance.name));
    router.replace(`/${locale}/integrations`);
  }

  return (
    <>
      {!canManage && (
        <p className="notice notice-info">
          <ShieldAlert size={17} aria-hidden="true" />
          <span>{t.readOnlyNotice}</span>
        </p>
      )}

      <div className="integration-detail">
        <article className="detail-panel">
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
            <strong>
              {instance.health.lastErrorCode ? runErrorMessage(t, instance.health.lastErrorCode) : t.noError}
            </strong>
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
              <ConfigForm
                type={instance.connectorType}
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
                    <strong>{credentialKindLabel(t, credential.kind)}</strong>
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
              <CredentialForm
                instanceId={instance.id}
                type={instance.connectorType}
                kinds={entry.credentialKinds}
                labels={t}
              />
            )}
          </article>
        )}

        <RunsPanel
          instanceId={instance.id}
          initialRuns={detail.runs}
          initialTotal={detail.runsTotal}
          labels={t}
          locale={locale}
        />

        {/* Last, on its own, and away from the buttons that stop an integration: the difference
            between disabling and deleting is the whole point, and putting them side by side would
            invite the wrong one. */}
        {canManage && (
          <article className="detail-panel danger-zone">
            <h2>{t.dangerZone}</h2>
            <p className="field-help">{t.deleteExplanation}</p>
            <button className="secondary-button danger" disabled={busy} onClick={() => setRemoving(true)}>
              <Trash2 size={16} aria-hidden="true" />
              {t.deleteIntegration}
            </button>
          </article>
        )}
      </div>

      {removing && (
        <DeleteDialog
          name={instance.name}
          busy={busy}
          labels={t}
          onCancel={() => setRemoving(false)}
          onConfirm={remove}
          onCrash={crashed}
        />
      )}
    </>
  );
}

const runsPageSize = 20;

/**
 * What this integration has run, a page at a time.
 *
 * A healthy connector polls every few minutes, so this list has no natural end — an integration
 * open for a day already has hundreds of entries. Capped in height and paged on its own rather
 * than the page-wide table pager, because the runs are one panel among six, not the screen.
 */
function RunsPanel({
  instanceId,
  initialRuns,
  initialTotal,
  labels: t,
  locale
}: {
  instanceId: string;
  initialRuns: ConnectorRun[];
  initialTotal: number;
  labels: Labels;
  locale: string;
}) {
  const { toast } = useToast();
  const [runs, setRuns] = useState(initialRuns);
  const [total, setTotal] = useState(initialTotal);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const pages = Math.max(1, Math.ceil(total / runsPageSize));

  async function goTo(next: number) {
    setLoading(true);
    const result = await request<ConnectorRunsResponse>(
      `/api/v1/integrations/${instanceId}/runs?page=${next}&pageSize=${runsPageSize}`
    );
    setLoading(false);
    if (!result.ok) return toast("error", errorMessage(t, result.code));
    setRuns(result.data.runs);
    setTotal(result.data.total);
    setPage(next);
  }

  return (
    <article className="detail-panel">
      <h2>{t.runs}</h2>
      {runs.length === 0 ? (
        <p className="crm-empty">{t.noRuns}</p>
      ) : (
        <>
          <div className="runs-scroll">
            <ol className="timeline">
              {runs.map((run) => (
                <li key={run.id}>
                  <div className="timeline-mark" aria-hidden="true" />
                  <div className="timeline-body">
                    <p className="timeline-title">
                      {run.operation}
                      <StatusPill tone={runTone[run.status]} label={t[runLabel[run.status]]!} />
                    </p>
                    <p className="timeline-meta">
                      <time dateTime={run.startedAt}>{moment(run.startedAt, locale, "")}</time>
                      <span>
                        {t.attempt} {run.attempt}
                      </span>
                      <span>
                        {t.items} {run.itemsProcessed}
                      </span>
                      {run.errorCode && <span>{runErrorMessage(t, run.errorCode)}</span>}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
          {pages > 1 && (
            <footer className="table-pagination runs-pagination">
              <span>{(t.runsPageOf ?? "").replace("{page}", String(page)).replace("{pages}", String(pages))}</span>
              <button
                className="icon-button"
                disabled={loading || page <= 1}
                onClick={() => void goTo(page - 1)}
                aria-label={t.runsPrevious}
              >
                <ChevronLeft size={17} />
              </button>
              <button
                className="icon-button"
                disabled={loading || page >= pages}
                onClick={() => void goTo(page + 1)}
                aria-label={t.runsNext}
              >
                <ChevronRight size={17} />
              </button>
            </footer>
          )}
        </>
      )}
    </article>
  );
}

/**
 * The confirmation, which reads out what it is about to destroy.
 *
 * Typing the name is friction and nothing more — the control that actually decides is the
 * permission checked in the API, and no dialog could be one. What this is for is that the list
 * above it gets read: the automation links and the alert rules that go with an integration belong
 * to the infrastructure screen, so somebody deleting from here would otherwise not learn they
 * existed until they were gone.
 */
function DeleteDialog({
  name,
  busy,
  labels: t,
  onCancel,
  onConfirm,
  onCrash
}: {
  name: string;
  busy: boolean;
  labels: Labels;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
  onCrash: (error: unknown) => void;
}) {
  const [typed, setTyped] = useState("");
  const matches = typed === name;

  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div className="dialog" role="dialog" aria-modal="true" aria-label={t.deleteIntegration}>
        <h2>{t.deleteIntegration}</h2>
        <p className="notice notice-warning">
          <AlertTriangle size={17} aria-hidden="true" />
          <span>{(t.deleteWarning ?? "").replace("{name}", name)}</span>
        </p>
        <ul className="integration-issues">
          <li>{t.deleteTakesConfiguration}</li>
          <li>{t.deleteTakesCredentials}</li>
          <li>{t.deleteTakesEndpoints}</li>
          <li>{t.deleteTakesRuns}</li>
          <li>{t.deleteTakesInfrastructure}</li>
        </ul>
        {/* We forget the envelope; the provider does not forget the token. Saying so here is the
            only place it can still be acted on. */}
        <p className="field-help">{t.deleteRevokeAtProvider}</p>
        <TextField
          label={(t.deleteConfirmLabel ?? "").replace("{name}", name)}
          name="confirmation"
          value={typed}
          onChange={(event) => setTyped(event.currentTarget.value)}
          disabled={busy}
          autoComplete="off"
          spellCheck={false}
          wide
        />
        <div className="dialog-actions">
          <button type="button" className="secondary-button" onClick={onCancel} disabled={busy}>
            {t.cancel}
          </button>
          <button
            type="button"
            className="primary-button danger"
            disabled={busy || !matches}
            onClick={eventHandler(onConfirm, onCrash)}
          >
            <Trash2 size={16} aria-hidden="true" />
            {t.deleteConfirm}
          </button>
        </div>
      </div>
    </div>
  );
}

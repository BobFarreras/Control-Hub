"use client";

import {
  AlertTriangle,
  Check,
  ExternalLink,
  Eye,
  Plus,
  Power,
  PowerOff,
  ShieldAlert,
  Trash2,
  UserPlus
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { SelectField, TextField, ToggleField } from "@/components/form-field";
import { MetricTile } from "@/components/metric-tile";
import { StatusPill } from "@/components/status-pill";
import { useToast } from "@/components/toast";
import type {
  AlertSeverity,
  CustomerOption,
  InfrastructureAlert,
  InfrastructureAlertRule,
  InfrastructureAutomation,
  InfrastructureOverview
} from "@/lib/api-types";
import { formValue } from "@/lib/form";
import { actionHandler, eventHandler } from "@/lib/handlers";
import { ageLabel, alertState, alertStateTone, severityTone, type ReadingAge } from "@/lib/infrastructure";
import { errorMessage, problemCode } from "@/lib/integrations";

/**
 * The infrastructure screen.
 *
 * Three things here are deliberate, and each of them is a rule from the specification rather
 * than a preference. **No provider address reaches the browser**: the link to a workflow is
 * composed and validated on the server, and what arrives here is either a link we built or
 * `null`, in which case the name renders as text. **Every observed figure is drawn with its
 * age**, computed on the server against one instant so that the same row cannot say two things
 * before and after hydration — and once a reading is old enough it says so in words, because a
 * figure from three hours ago otherwise looks exactly like one from a second ago. And a
 * provider's own sentences are never rendered: what arrives from the API is a `code`, and what
 * a person reads is our translation of it.
 *
 * Specification: `docs/specifications/infrastructure.md`.
 */

type Labels = Record<string, string>;

/** One automation, with what the server worked out about it: its link and the age of its reading. */
export type AutomationRow = InfrastructureAutomation & {
  instanceName: string;
  /** Built and validated on the server from the configured base. Null renders as plain text. */
  link: string | null;
  age: ReadingAge | null;
};

export type RuleRow = InfrastructureAlertRule & { instanceName: string };

const severities: AlertSeverity[] = ["critical", "high", "normal", "low"];

const jsonHeaders = { "content-type": "application/json" };

type Result = { ok: true } | { ok: false; code: string | null };

async function call(path: string, init: RequestInit): Promise<Result> {
  const response = await fetch(path, init);
  if (response.ok) return { ok: true };
  const payload: unknown = await response.json().catch(() => null);
  return { ok: false, code: problemCode(payload) };
}

/** `critical` becomes `severityCritical`: one derivation, no table to keep in step with the union. */
function severityLabel(t: Labels, severity: AlertSeverity): string {
  return t[`severity${severity.charAt(0).toUpperCase()}${severity.slice(1)}`] ?? severity;
}

function automationStateLabel(t: Labels, automation: AutomationRow): string {
  if (automation.archived) return t.automationArchived ?? "";
  return (automation.active ? t.automationActive : t.automationInactive) ?? "";
}

export function InfrastructureWorkspace({
  overview,
  observedFromAge,
  automations,
  alerts,
  rules,
  customers,
  canOperate,
  showResolved,
  labels: t,
  locale,
  loadError
}: {
  overview: InfrastructureOverview | null;
  observedFromAge: ReadingAge | null;
  automations: AutomationRow[];
  alerts: InfrastructureAlert[];
  rules: RuleRow[];
  customers: CustomerOption[];
  canOperate: boolean;
  /** Whether the list includes the alerts that are already over. It lives in the query string. */
  showResolved: boolean;
  labels: Labels;
  locale: string;
  loadError: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [linking, setLinking] = useState<AutomationRow | null>(null);
  const [ruleDialog, setRuleDialog] = useState(false);
  const [formError, setFormError] = useState("");
  const [ruleInstanceId, setRuleInstanceId] = useState("");
  const [ruleTargetType, setRuleTargetType] = useState<"instance" | "automation">("instance");

  /** The instances the rules can watch, taken from what has actually been read. */
  const instances = [...new Map(automations.map((row) => [row.instanceId, row.instanceName])).entries()].map(
    ([id, name]) => ({ value: id, label: name })
  );

  function failed(result: { code: string | null }) {
    toast("error", errorMessage(t, result.code));
  }

  async function run(path: string, init: RequestInit, message: string) {
    setBusy(true);
    const result = await call(path, init);
    setBusy(false);
    if (!result.ok) return failed(result);
    toast("success", message);
    router.refresh();
  }

  async function acknowledge(alertId: string) {
    await run(`/api/v1/infrastructure/alerts/${alertId}/acknowledge`, { method: "POST" }, t.acknowledged ?? "");
  }

  async function resolve(alertId: string) {
    await run(`/api/v1/infrastructure/alerts/${alertId}/resolve`, { method: "POST" }, t.resolved ?? "");
  }

  async function toggleRule(rule: RuleRow) {
    await run(
      `/api/v1/infrastructure/alert-rules/${rule.id}`,
      { method: "PATCH", headers: jsonHeaders, body: JSON.stringify({ enabled: !rule.enabled }) },
      t.updated ?? ""
    );
  }

  async function removeRule(rule: RuleRow) {
    if (!confirm((t.removeRuleDescription ?? "").replace("{name}", rule.name))) return;
    await run(`/api/v1/infrastructure/alert-rules/${rule.id}`, { method: "DELETE" }, t.removed ?? "");
  }

  async function link(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!linking) return;
    const data = new FormData(event.currentTarget);
    const customerId = formValue(data, "customerId");
    const notes = formValue(data, "notes").trim();
    setBusy(true);
    setFormError("");
    const result = await call(
      `/api/v1/infrastructure/automations/${linking.instanceId}/${encodeURIComponent(linking.externalId)}/link`,
      {
        method: "PUT",
        headers: jsonHeaders,
        // Withdrawing the client keeps the note: somebody wrote it, and losing it as a side
        // effect of unlinking would be a surprise the API already refuses to cause.
        body: JSON.stringify({ customerId: customerId || null, notes: notes || null })
      }
    );
    setBusy(false);
    if (!result.ok) return setFormError(errorMessage(t, result.code));
    setLinking(null);
    toast("success", t.linked ?? "");
    router.refresh();
  }

  async function createRule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setFormError("");
    const result = await call("/api/v1/infrastructure/alert-rules", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({
        name: formValue(data, "name"),
        kind: "workflow_failed",
        instanceId: formValue(data, "instanceId"),
        targetType: ruleTargetType,
        targetId: ruleTargetType === "automation" ? formValue(data, "targetId") : null,
        severity: formValue(data, "severity"),
        freshnessSeconds: Number(formValue(data, "freshnessSeconds")),
        opensIncident: data.get("opensIncident") !== null,
        params: {
          withinMinutes: Number(formValue(data, "withinMinutes")),
          minimumFailures: Number(formValue(data, "minimumFailures"))
        }
      })
    });
    setBusy(false);
    if (!result.ok) return setFormError(errorMessage(t, result.code));
    setRuleDialog(false);
    toast("success", t.created ?? "");
    router.refresh();
  }

  const onError = () => {
    setBusy(false);
    toast("error", t.errorUnknown ?? "");
  };

  return (
    <>
      {loadError && (
        <p className="crm-error">
          <AlertTriangle size={17} />
          {t.loadError}
        </p>
      )}
      {!canOperate && (
        <p className="notice notice-info">
          <ShieldAlert size={17} aria-hidden="true" />
          <span>{t.readOnlyNotice}</span>
        </p>
      )}

      {overview && (
        <section className="metric-row" aria-label={t.title}>
          <MetricTile label={t.overviewAutomations!} value={overview.automations.total} />
          <MetricTile label={t.overviewActive!} value={overview.automations.active} />
          <MetricTile label={t.overviewLinked!} value={overview.automations.linked} />
          <MetricTile
            label={t.overviewAlerts!}
            value={overview.alerts.total}
            footnote={`${t.overviewAcknowledged} ${overview.alerts.acknowledged}`}
          />
          {/* The oldest reading behind the figures, never the newest: a summary is only as fresh
              as the stalest thing that went into it. */}
          <MetricTile label={t.observedFrom!} value={ageLabel(t, observedFromAge, t.observedNever ?? "")} />
        </section>
      )}

      <section className="project-panel" aria-label={t.sectionAlerts}>
        <header className="project-panel-heading">
          <h3>{t.sectionAlerts}</h3>
          {/* A link and not a checkbox: what the list contains is then something somebody can send. */}
          <a
            className="secondary-button"
            href={showResolved ? `/${locale}/infrastructure` : `/${locale}/infrastructure?resolved=1`}
          >
            {showResolved ? t.onlyFiring : t.showResolved}
          </a>
        </header>
        {alerts.length === 0 ? (
          <p className="muted">{t.alertsEmpty}</p>
        ) : (
          <div className="crm-table-wrap inside-panel">
            <table className="crm-table">
              <thead>
                <tr>
                  <th>{t.rule}</th>
                  <th>{t.severity}</th>
                  <th>{t.state}</th>
                  <th>{t.startedAt}</th>
                  <th>{t.occurrences}</th>
                  {canOperate && <th />}
                </tr>
              </thead>
              <tbody>
                {alerts.map((alert) => {
                  const state = alertState(alert);
                  return (
                    <tr key={alert.id}>
                      <td>
                        <span className="ticket-subject">{alert.ruleName}</span>
                        <small className="muted">{alert.dedupKey}</small>
                      </td>
                      <td>
                        <StatusPill tone={severityTone[alert.severity]} label={severityLabel(t, alert.severity)} />
                      </td>
                      <td>
                        <StatusPill
                          tone={alertStateTone[state]}
                          label={t[`alert${state.charAt(0).toUpperCase()}${state.slice(1)}`] ?? state}
                        />
                        {alert.incidentId && <small className="muted">{t.incidentOpened}</small>}
                      </td>
                      <td>
                        <time dateTime={alert.startedAt}>{new Date(alert.startedAt).toLocaleString(locale)}</time>
                      </td>
                      <td>{alert.occurrences}</td>
                      {canOperate && (
                        <td className="pending-actions">
                          {state === "firing" && (
                            <button
                              className="icon-button"
                              disabled={busy}
                              aria-label={t.acknowledge}
                              onClick={actionHandler(acknowledge, onError).bind(null, alert.id)}
                            >
                              <Eye size={16} />
                            </button>
                          )}
                          {alert.status === "firing" && (
                            <button
                              className="icon-button"
                              disabled={busy}
                              aria-label={t.resolve}
                              onClick={actionHandler(resolve, onError).bind(null, alert.id)}
                            >
                              <Check size={16} />
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="project-panel" aria-label={t.sectionAutomations}>
        <h3>{t.sectionAutomations}</h3>
        {automations.length === 0 ? (
          <p className="muted">{t.automationsEmpty}</p>
        ) : (
          <div className="crm-table-wrap inside-panel">
            <table className="crm-table">
              <thead>
                <tr>
                  <th>{t.name}</th>
                  <th>{t.state}</th>
                  <th>{t.customer}</th>
                  <th>{t.observed}</th>
                  {canOperate && <th />}
                </tr>
              </thead>
              <tbody>
                {automations.map((automation) => (
                  <tr key={`${automation.instanceId}:${automation.externalId}`}>
                    <td>
                      {automation.link ? (
                        <a className="ticket-subject" href={automation.link} target="_blank" rel="noopener noreferrer">
                          {automation.name}
                          <ExternalLink size={14} aria-label={t.open} />
                        </a>
                      ) : (
                        <span className="ticket-subject">{automation.name}</span>
                      )}
                      <small className="muted">{automation.instanceName}</small>
                    </td>
                    <td>
                      <StatusPill
                        tone={automation.archived ? "closed" : automation.active ? "active" : "neutral"}
                        label={automationStateLabel(t, automation)}
                      />
                    </td>
                    <td>
                      {customers.find((customer) => customer.id === automation.customerId)?.displayName ?? (
                        <span className="muted">{t.noCustomer}</span>
                      )}
                    </td>
                    <td>
                      <time dateTime={automation.observedAt}>{ageLabel(t, automation.age, t.observedNever ?? "")}</time>
                      {automation.age?.stale && (
                        <small className="muted" title={t.staleHint}>
                          {t.stale}
                        </small>
                      )}
                    </td>
                    {canOperate && (
                      <td className="pending-actions">
                        <button
                          className="icon-button"
                          disabled={busy}
                          aria-label={t.assign}
                          onClick={() => {
                            setFormError("");
                            setLinking(automation);
                          }}
                        >
                          <UserPlus size={16} />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="project-panel" aria-label={t.sectionRules}>
        <header className="project-panel-heading">
          <h3>{t.sectionRules}</h3>
          {canOperate && (
            <button
              className="primary-command"
              disabled={instances.length === 0}
              onClick={() => {
                setFormError("");
                setRuleInstanceId(instances[0]?.value ?? "");
                setRuleTargetType("instance");
                setRuleDialog(true);
              }}
            >
              <Plus size={17} />
              {t.newRule}
            </button>
          )}
        </header>
        {rules.length === 0 ? (
          <p className="muted">{t.rulesEmpty}</p>
        ) : (
          <div className="crm-table-wrap inside-panel">
            <table className="crm-table">
              <thead>
                <tr>
                  <th>{t.ruleName}</th>
                  <th>{t.ruleTarget}</th>
                  <th>{t.severity}</th>
                  <th>{t.ruleFreshness}</th>
                  <th>{t.ruleEnabled}</th>
                  {canOperate && <th />}
                </tr>
              </thead>
              <tbody>
                {rules.map((rule) => (
                  <tr key={rule.id}>
                    <td>
                      <span className="ticket-subject">{rule.name}</span>
                      <small className="muted">{t.kindWorkflowFailed}</small>
                    </td>
                    <td>
                      {rule.targetType === "automation" ? (
                        <>
                          {t.targetAutomation}
                          <small className="muted">{rule.targetId}</small>
                        </>
                      ) : (
                        t.targetInstance
                      )}
                      <small className="muted">{rule.instanceName}</small>
                    </td>
                    <td>
                      <StatusPill tone={severityTone[rule.severity]} label={severityLabel(t, rule.severity)} />
                    </td>
                    <td>{rule.freshnessSeconds}</td>
                    <td>{rule.enabled ? t.ruleEnabled : t.disable}</td>
                    {canOperate && (
                      <td className="pending-actions">
                        <button
                          className="icon-button"
                          disabled={busy}
                          aria-label={rule.enabled ? t.disable : t.enable}
                          onClick={actionHandler(toggleRule, onError).bind(null, rule)}
                        >
                          {rule.enabled ? <PowerOff size={16} /> : <Power size={16} />}
                        </button>
                        <button
                          className="icon-button"
                          disabled={busy}
                          aria-label={t.removeRule}
                          onClick={actionHandler(removeRule, onError).bind(null, rule)}
                        >
                          <Trash2 size={16} />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {linking && (
        <div
          className="dialog-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setLinking(null);
          }}
        >
          <section className="crm-dialog" role="dialog" aria-modal="true" aria-label={t.assignTitle}>
            <header>
              <h2>{t.assignTitle}</h2>
              <p className="muted">{linking.name}</p>
            </header>
            <form className="dialog-form" onSubmit={eventHandler(link, onError)}>
              <SelectField
                label={t.chooseCustomer!}
                name="customerId"
                defaultValue={linking.customerId ?? ""}
                options={[
                  { value: "", label: t.noCustomer! },
                  ...customers.map((customer) => ({ value: customer.id, label: customer.displayName }))
                ]}
              />
              <TextField label={t.notes!} name="notes" defaultValue={linking.notes ?? ""} hint={t.notesHint} wide />
              {formError && (
                <p className="form-error wide" role="alert">
                  {formError}
                </p>
              )}
              <footer>
                <button type="button" className="secondary-button" onClick={() => setLinking(null)}>
                  {t.cancel}
                </button>
                <button type="submit" className="primary-button" disabled={busy}>
                  {t.save}
                </button>
              </footer>
            </form>
          </section>
        </div>
      )}

      {ruleDialog && (
        <div
          className="dialog-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setRuleDialog(false);
          }}
        >
          <section className="crm-dialog" role="dialog" aria-modal="true" aria-label={t.newRule}>
            <header>
              <h2>{t.newRule}</h2>
            </header>
            <form className="dialog-form" onSubmit={eventHandler(createRule, onError)}>
              <TextField label={t.ruleName!} name="name" required minLength={3} maxLength={120} wide />
              <SelectField
                label={t.ruleInstance!}
                name="instanceId"
                value={ruleInstanceId}
                onChange={(event) => setRuleInstanceId(event.currentTarget.value)}
                options={instances}
              />
              <SelectField
                label={t.ruleTarget!}
                name="targetType"
                value={ruleTargetType}
                onChange={(event) =>
                  setRuleTargetType(event.currentTarget.value === "automation" ? "automation" : "instance")
                }
                options={[
                  { value: "instance", label: t.targetInstance! },
                  { value: "automation", label: t.targetAutomation! }
                ]}
              />
              {ruleTargetType === "automation" && (
                <SelectField
                  label={t.ruleTargetId!}
                  name="targetId"
                  options={automations
                    .filter((automation) => automation.instanceId === ruleInstanceId)
                    .map((automation) => ({ value: automation.externalId, label: automation.name }))}
                />
              )}
              <SelectField
                label={t.ruleSeverity!}
                name="severity"
                defaultValue="high"
                options={severities.map((severity) => ({ value: severity, label: severityLabel(t, severity) }))}
              />
              <TextField
                label={t.ruleFreshness!}
                name="freshnessSeconds"
                type="number"
                min={60}
                max={86400}
                defaultValue={900}
                hint={t.ruleFreshnessHint}
              />
              <TextField label={t.ruleWithinMinutes!} name="withinMinutes" type="number" min={1} defaultValue={60} />
              <TextField label={t.ruleMinimumFailures!} name="minimumFailures" type="number" min={1} defaultValue={1} />
              <ToggleField label={t.ruleOpensIncident!} name="opensIncident" />
              {formError && (
                <p className="form-error wide" role="alert">
                  {formError}
                </p>
              )}
              <footer>
                <button type="button" className="secondary-button" onClick={() => setRuleDialog(false)}>
                  {t.cancel}
                </button>
                <button type="submit" className="primary-button" disabled={busy}>
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

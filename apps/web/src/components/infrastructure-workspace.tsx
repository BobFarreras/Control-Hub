"use client";

import {
  AlertTriangle,
  Check,
  ExternalLink,
  Eye,
  Pencil,
  Plus,
  Power,
  PowerOff,
  ShieldAlert,
  Trash2,
  UserPlus
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { SelectField, TextField, ToggleField } from "@/components/form-field";
import { MetricTile } from "@/components/metric-tile";
import { StatusPill } from "@/components/status-pill";
import { useToast } from "@/components/toast";
import type {
  AlertSeverity,
  ConnectorDiscoveryResponse,
  CustomerOption,
  DiscoveredInstance,
  HostEnvironment,
  InfrastructureAlert,
  InfrastructureAlertRule,
  InfrastructureAutomation,
  InfrastructureOverview,
  InventorySummary,
  ObservedTally,
  ObservedHost,
  ObservedService,
  ObservedState,
  Reading,
  ServiceExpectedState,
  ServiceKind
} from "@/lib/api-types";
import { formValue } from "@/lib/form";
import { actionHandler, eventHandler } from "@/lib/handlers";
import {
  ageLabel,
  alertState,
  alertStateTone,
  filterInventory,
  observedStateTone,
  readingSources,
  severityTone,
  type Figure,
  type InventoryFilter,
  type ReadingAge
} from "@/lib/infrastructure";
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

/** A service with what the server worked out about its reading: its age and its figures in words. */
export type ServiceRow = ObservedService & { age: ReadingAge | null; figures: Figure[] };

export type HostRow = Omit<ObservedHost, "services"> & {
  age: ReadingAge | null;
  figures: Figure[];
  services: ServiceRow[];
};

const severities: AlertSeverity[] = ["critical", "high", "normal", "low"];
const environments: HostEnvironment[] = ["production", "staging", "development"];
const observedStates: ObservedState[] = ["up", "down", "unknown"];
const serviceKinds: ServiceKind[] = ["container", "http", "database", "automation"];
const expectedStates: ServiceExpectedState[] = ["up", "stopped", "ignored"];

const jsonHeaders = { "content-type": "application/json" };

type Result = { ok: true } | { ok: false; code: string | null };

async function call(path: string, init: RequestInit): Promise<Result> {
  const response = await fetch(path, init);
  if (response.ok) return { ok: true };
  const payload: unknown = await response.json().catch(() => null);
  return { ok: false, code: problemCode(payload) };
}

type Answered<T> = { ok: true; data: T } | { ok: false; code: string | null };

/** The same call, for the one read on this screen whose answer is the point rather than its success. */
async function ask<T>(path: string): Promise<Answered<T>> {
  const response = await fetch(path);
  const payload: unknown = await response.json().catch(() => null);
  return response.ok ? { ok: true, data: payload as T } : { ok: false, code: problemCode(payload) };
}

/** `critical` becomes `severityCritical`: one derivation, no table to keep in step with the union. */
function capitalised(value: string): string {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

/**
 * The three states under a total, in words.
 *
 * All three are always written, zeroes included: a fleet with nothing down should say so rather
 * than leave the reader to notice an absence, and a footnote whose parts change shape between one
 * machine and the next is one nobody reads twice.
 */
function tallyFootnote(t: Labels, tally: ObservedTally): string {
  return [
    `${tally.up} ${t.stateUp ?? ""}`,
    `${tally.down} ${t.stateDown ?? ""}`,
    `${tally.unknown} ${t.stateUnknown ?? ""}`
  ].join(" · ");
}

function severityLabel(t: Labels, severity: AlertSeverity): string {
  return t[`severity${capitalised(severity)}`] ?? severity;
}

/**
 * What is currently known of one machine or service: the state, in a pill, and the hour it was
 * read beside it.
 *
 * The state is the API's and is never recomputed here. `unknown` is drawn as its own answer and
 * carries the sentence that says what it means, because a collector we have lost sight of is not
 * an outage and nobody should be sent looking for one. There is no second staleness badge either:
 * whether a reading still counts was already decided against the cadence the collector declares,
 * and a coarser rule drawn next to it would be a second opinion on the same question.
 */
function ReadingState({ reading, age, labels: t }: { reading: Reading; age: ReadingAge | null; labels: Labels }) {
  return (
    <span className="infra-state" title={reading.state === "unknown" ? t.stateUnknownHint : undefined}>
      <StatusPill
        tone={observedStateTone[reading.state]}
        label={t[`state${capitalised(reading.state)}`] ?? reading.state}
      />
      <small className="muted">{ageLabel(t, age, t.observedNever ?? "")}</small>
    </span>
  );
}

/**
 * One group of the filter: a legend and a chip per value.
 *
 * Checkboxes and not a select, because the three questions are answered with any number of values
 * each and a multiple select is the control nobody discovers. They are real inputs under the
 * chips rather than buttons with a class, so the group is a group to a screen reader and the
 * keyboard already works.
 */
function FilterGroup<T extends string>({
  legend,
  options,
  chosen,
  onChange
}: {
  legend: string;
  options: readonly { value: T; label: string }[];
  chosen: readonly T[];
  onChange: (values: T[]) => void;
}) {
  if (options.length === 0) return null;
  return (
    <fieldset className="fleet-filter-group">
      <legend>{legend}</legend>
      {options.map((option) => (
        <label className="fleet-chip" key={option.value}>
          <input
            type="checkbox"
            checked={chosen.includes(option.value)}
            onChange={() =>
              onChange(
                chosen.includes(option.value)
                  ? chosen.filter((value) => value !== option.value)
                  : [...chosen, option.value]
              )
            }
          />
          <span>{option.label}</span>
        </label>
      ))}
    </fieldset>
  );
}

/**
 * What a collector is reading, and which of it nobody has declared.
 *
 * It lives on this screen rather than beside the guided check because of the button: declaring is
 * `infrastructure:operate` and the form that does it is the dialog below, already written and
 * already permissioned. Putting the list next to the check would mean either a second copy of
 * that dialog or carrying a hostname across a navigation, and a hostname in a query string is the
 * kind of thing the module's own rules exist to prevent.
 *
 * It is asked for, never fetched on load. Nothing goes out to Prometheus either way -- the labels
 * come from readings already stored -- but a panel that reads the whole fleet's records to draw
 * itself every time somebody opens the screen would be a cost paid by everyone for a question few
 * people are asking.
 */
function DiscoveryPanel({
  collectors,
  canOperate,
  labels: t,
  locale,
  onDeclare
}: {
  collectors: { value: string; label: string }[];
  canOperate: boolean;
  labels: Labels;
  locale: string;
  /** Opens the dialog below with the label already in the field that gets typed wrongly. */
  onDeclare: (hostname: string) => void;
}) {
  const { toast } = useToast();
  const [instanceId, setInstanceId] = useState(collectors[0]?.value ?? "");
  const [busy, setBusy] = useState(false);
  const [seen, setSeen] = useState<DiscoveredInstance[] | null>(null);

  async function look() {
    if (!instanceId) return;
    setBusy(true);
    const result = await ask<ConnectorDiscoveryResponse>(`/api/v1/infrastructure/connectors/${instanceId}/discovery`);
    setBusy(false);
    if (!result.ok) {
      setSeen(null);
      return toast("error", errorMessage(t, result.code));
    }
    setSeen(result.data.instances);
  }

  const undeclared = seen?.filter((instance) => !instance.declaredAs).length ?? 0;

  return (
    <section className="project-panel" aria-label={t.discoveryTitle}>
      <h3>{t.discoveryTitle}</h3>
      <p className="field-help">{t.discoveryAbout}</p>

      <div className="discovery-ask">
        <SelectField
          label={t.discoveryCollector ?? ""}
          name="discoveryCollector"
          value={instanceId}
          onChange={(event) => {
            setInstanceId(event.target.value);
            // The answer belonged to the collector that was chosen when it was asked for. Leaving
            // it on screen under a different name would be one collector's labels attributed to
            // another, which is the exact confusion this panel exists to end.
            setSeen(null);
          }}
          options={collectors}
        />
        <button className="secondary-button" onClick={() => void look()} disabled={busy || !instanceId} type="button">
          <Eye size={16} aria-hidden="true" />
          {busy ? t.discoveryRunning : t.discoveryRun}
        </button>
      </div>

      {!seen ? (
        <p className="crm-empty">{t.discoveryNotRun}</p>
      ) : seen.length === 0 ? (
        <p className="crm-empty">{t.discoveryEmpty}</p>
      ) : (
        <>
          <p className="muted">
            {(t.discoveryCount ?? "")
              .replace("{seen}", String(seen.length))
              .replace("{undeclared}", String(undeclared))}
          </p>
          <ul className="discovery-list">
            {seen.map((instance) => (
              <li key={instance.label} className="discovery-row" data-declared={instance.declaredAs ? "yes" : "no"}>
                <code className="discovery-label">{instance.label}</code>
                {instance.declaredAs ? (
                  <Link className="link-button" href={`/${locale}/infrastructure/hosts/${instance.declaredAs.hostId}`}>
                    {(t.discoveryDeclaredAs ?? "").replace("{name}", instance.declaredAs.name)}
                  </Link>
                ) : (
                  <span className="discovery-undeclared">{t.discoveryUndeclared}</span>
                )}
                {!instance.declaredAs && canOperate && (
                  <button className="secondary-button" type="button" onClick={() => onDeclare(instance.label)}>
                    <Plus size={16} aria-hidden="true" />
                    {t.discoveryDeclare}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function automationStateLabel(t: Labels, automation: AutomationRow): string {
  if (automation.archived) return t.automationArchived ?? "";
  return (automation.active ? t.automationActive : t.automationInactive) ?? "";
}

export function InfrastructureWorkspace({
  overview,
  summary,
  observedFromAge,
  hosts,
  instanceNames,
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
  /** The fleet counted by the API. Never narrowed by the filters below it. */
  summary: InventorySummary | null;
  observedFromAge: ReadingAge | null;
  hosts: HostRow[];
  /** What each connector instance is called, so the filter offers names and not identifiers. */
  instanceNames: Record<string, string>;
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
  // Null is closed; a host of null is one being declared rather than one being corrected. A
  // `hostname` is the discovery filling in the field that gets typed wrongly the first time, and
  // it is read only when there is no host, because correcting a machine starts from its own value.
  const [hostDialog, setHostDialog] = useState<{ host: HostRow | null; hostname?: string } | null>(null);
  const [serviceDialog, setServiceDialog] = useState<{ hostId: string; service: ServiceRow | null } | null>(null);
  const [ruleDialog, setRuleDialog] = useState(false);
  // What somebody asked to be shown. Client state and not a query string: it narrows a list
  // already in the browser, changes nothing on the server, and reloading to filter would refetch
  // the whole fleet to draw less of it.
  const [filter, setFilter] = useState<InventoryFilter>({ environments: [], states: [], instanceIds: [] });

  // What the filter offers and what it currently shows. Both derived from the fleet already in
  // hand: nothing is fetched to narrow a list, and no state is recomputed while narrowing it.
  const sources = readingSources(hosts);
  const shown = filterInventory(hosts, filter);
  // True whenever anything has been asked of the fleet, and not merely when fewer machines came
  // back: a filter that happens to match everything still has to be visible and still has to be
  // clearable.
  const narrowed = Object.values(filter).some((values) => values.length > 0);
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

  async function submitHost(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!hostDialog) return;
    const data = new FormData(event.currentTarget);
    const existing = hostDialog.host;
    setBusy(true);
    setFormError("");
    const result = await call(
      existing ? `/api/v1/infrastructure/hosts/${existing.id}` : "/api/v1/infrastructure/hosts",
      {
        method: existing ? "PATCH" : "POST",
        headers: jsonHeaders,
        body: JSON.stringify({
          name: formValue(data, "name"),
          hostname: formValue(data, "hostname"),
          environment: formValue(data, "environment"),
          notes: formValue(data, "notes").trim() || null
        })
      }
    );
    setBusy(false);
    if (!result.ok) return setFormError(errorMessage(t, result.code));
    setHostDialog(null);
    toast("success", (existing ? t.hostUpdated : t.hostCreated) ?? "");
    router.refresh();
  }

  async function submitService(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!serviceDialog) return;
    const data = new FormData(event.currentTarget);
    const existing = serviceDialog.service;
    const body = {
      name: formValue(data, "name"),
      kind: formValue(data, "kind"),
      matchKey: formValue(data, "matchKey"),
      expectedState: formValue(data, "expectedState"),
      customerId: formValue(data, "customerId") || null
    };
    setBusy(true);
    setFormError("");
    const result = await call(
      existing ? `/api/v1/infrastructure/services/${existing.id}` : "/api/v1/infrastructure/services",
      {
        method: existing ? "PATCH" : "POST",
        headers: jsonHeaders,
        // A service that moved machine is watching something else, which is why the host travels
        // only when the service is being declared and never when it is being corrected.
        body: JSON.stringify(existing ? body : { ...body, hostId: serviceDialog.hostId })
      }
    );
    setBusy(false);
    if (!result.ok) return setFormError(errorMessage(t, result.code));
    setServiceDialog(null);
    toast("success", (existing ? t.serviceUpdated : t.serviceCreated) ?? "");
    router.refresh();
  }

  async function removeService(service: ServiceRow) {
    if (!confirm((t.removeServiceDescription ?? "").replace("{name}", service.name))) return;
    await run(`/api/v1/infrastructure/services/${service.id}`, { method: "DELETE" }, t.serviceRemoved ?? "");
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

      {(overview || summary) && (
        <section className="metric-row" aria-label={t.title}>
          {/* The fleet as the API counted it, from the very readings the rows below are drawn
              from. Deliberately not narrowed by the filters: how much of the fleet is down does
              not depend on what somebody is currently looking at. */}
          {summary && (
            <>
              <MetricTile
                label={t.overviewHosts!}
                value={summary.hosts.total}
                footnote={tallyFootnote(t, summary.hosts)}
              />
              <MetricTile
                label={t.overviewServices!}
                value={summary.services.total}
                footnote={tallyFootnote(t, summary.services)}
              />
            </>
          )}
          {overview && (
            <>
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
            </>
          )}
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
                        <StatusPill tone={alertStateTone[state]} label={t[`alert${capitalised(state)}`] ?? state} />
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

      <section className="project-panel" aria-label={t.sectionHosts}>
        <header className="project-panel-heading">
          <h3>{t.sectionHosts}</h3>
          {canOperate && (
            <button
              className="primary-command"
              onClick={() => {
                setFormError("");
                setHostDialog({ host: null });
              }}
            >
              <Plus size={17} />
              {t.newHost}
            </button>
          )}
        </header>
        {hosts.length > 0 && (
          <div className="fleet-filter">
            <FilterGroup
              legend={t.filterEnvironment!}
              options={environments.map((environment) => ({
                value: environment,
                label: t[`environment${capitalised(environment)}`] ?? environment
              }))}
              chosen={filter.environments}
              onChange={(environments) => setFilter({ ...filter, environments })}
            />
            <FilterGroup
              legend={t.filterState!}
              options={observedStates.map((state) => ({
                value: state,
                label: t[`state${capitalised(state)}`] ?? state
              }))}
              chosen={filter.states}
              onChange={(states) => setFilter({ ...filter, states })}
            />
            {/* Only the collectors that actually read something here, so choosing one can never
                empty the list, and named rather than identified by their row in the database. */}
            <FilterGroup
              legend={t.filterSource!}
              options={sources.map((instanceId) => ({
                value: instanceId,
                label: instanceNames[instanceId] ?? instanceId
              }))}
              chosen={filter.instanceIds}
              onChange={(instanceIds) => setFilter({ ...filter, instanceIds })}
            />
            {narrowed && (
              <p className="fleet-filter-count">
                <span>
                  {(t.filterShowing ?? "")
                    .replace("{shown}", String(shown.length))
                    .replace("{total}", String(hosts.length))}
                </span>
                <button
                  className="link-button"
                  onClick={() => setFilter({ environments: [], states: [], instanceIds: [] })}
                >
                  {t.filterClear}
                </button>
              </p>
            )}
          </div>
        )}
        {hosts.length === 0 ? (
          <p className="muted">{t.hostsEmpty}</p>
        ) : shown.length === 0 ? (
          <p className="muted">{t.filterNoMatch}</p>
        ) : (
          <ul className="infra-hosts">
            {shown.map((host) => (
              <li className="infra-host" key={host.id}>
                <header>
                  <div>
                    {/* A machine with fifteen services does not fit in a card, and this is the way
                        to the page where it does. */}
                    <Link className="ticket-subject" href={`/${locale}/infrastructure/hosts/${host.id}`}>
                      {host.name}
                    </Link>
                    <small className="muted">
                      {host.hostname} · {t[`environment${capitalised(host.environment)}`] ?? host.environment}
                    </small>
                  </div>
                  <ReadingState reading={host.reading} age={host.age} labels={t} />
                  {canOperate && (
                    <span className="pending-actions">
                      <button
                        className="icon-button"
                        disabled={busy}
                        aria-label={t.editHost}
                        onClick={() => {
                          setFormError("");
                          setHostDialog({ host });
                        }}
                      >
                        <Pencil size={16} />
                      </button>
                      <button
                        className="icon-button"
                        disabled={busy}
                        aria-label={t.newService}
                        onClick={() => {
                          setFormError("");
                          setServiceDialog({ hostId: host.id, service: null });
                        }}
                      >
                        <Plus size={16} />
                      </button>
                    </span>
                  )}
                </header>

                {host.figures.length > 0 && (
                  <dl className="infra-figures">
                    {host.figures.map((figure) => (
                      <div key={figure.field}>
                        <dt>{figure.label}</dt>
                        <dd>{figure.value}</dd>
                      </div>
                    ))}
                  </dl>
                )}
                {host.notes && <p className="muted">{host.notes}</p>}

                {host.services.length === 0 ? (
                  <p className="muted">{t.servicesEmpty}</p>
                ) : (
                  <div className="crm-table-wrap inside-panel">
                    <table className="crm-table" aria-label={`${t.sectionServices} · ${host.name}`}>
                      <thead>
                        <tr>
                          <th>{t.serviceName}</th>
                          <th>{t.serviceKind}</th>
                          <th>{t.state}</th>
                          <th>{t.observed}</th>
                          {canOperate && <th />}
                        </tr>
                      </thead>
                      <tbody>
                        {host.services.map((service) => (
                          <tr key={service.id}>
                            <td>
                              <span className="ticket-subject">{service.name}</span>
                              <small className="muted">{service.matchKey}</small>
                            </td>
                            <td>
                              {t[`kind${capitalised(service.kind)}`] ?? service.kind}
                              {service.expectedState !== "up" && (
                                <small className="muted">
                                  {t[`expected${capitalised(service.expectedState)}`] ?? service.expectedState}
                                </small>
                              )}
                            </td>
                            <td>
                              <ReadingState reading={service.reading} age={service.age} labels={t} />
                            </td>
                            <td>
                              {service.figures.length === 0 ? (
                                <span className="muted">-</span>
                              ) : (
                                service.figures.map((figure) => (
                                  <small className="muted" key={figure.field}>
                                    {figure.label}: {figure.value}
                                  </small>
                                ))
                              )}
                            </td>
                            {canOperate && (
                              <td className="pending-actions">
                                <button
                                  className="icon-button"
                                  disabled={busy}
                                  aria-label={t.editService}
                                  onClick={() => {
                                    setFormError("");
                                    setServiceDialog({ hostId: host.id, service });
                                  }}
                                >
                                  <Pencil size={16} />
                                </button>
                                <button
                                  className="icon-button"
                                  disabled={busy}
                                  aria-label={t.removeService}
                                  onClick={actionHandler(removeService, onError).bind(null, service)}
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
              </li>
            ))}
          </ul>
        )}
      </section>

      <DiscoveryPanel
        collectors={Object.entries(instanceNames)
          .map(([value, label]) => ({ value, label }))
          .sort((one, other) => one.label.localeCompare(other.label))}
        canOperate={canOperate}
        labels={t}
        locale={locale}
        onDeclare={(hostname) => {
          setFormError("");
          setHostDialog({ host: null, hostname });
        }}
      />

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

      {hostDialog && (
        <div
          className="dialog-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setHostDialog(null);
          }}
        >
          <section
            className="crm-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={hostDialog.host ? t.editHost : t.newHost}
          >
            <header>
              <h2>{hostDialog.host ? t.editHost : t.newHost}</h2>
            </header>
            <form className="dialog-form" onSubmit={eventHandler(submitHost, onError)}>
              <TextField
                label={t.hostName!}
                name="name"
                required
                minLength={3}
                maxLength={120}
                defaultValue={hostDialog.host?.name ?? ""}
              />
              {/* The label a reading is matched by. A machine declared with the wrong one is never
                  contradicted by any data, which reads on this screen as a machine that is fine. */}
              <TextField
                label={t.hostHostname!}
                name="hostname"
                required
                maxLength={190}
                hint={t.hostHostnameHint}
                defaultValue={hostDialog.host?.hostname ?? hostDialog.hostname ?? ""}
              />
              <SelectField
                label={t.hostEnvironment!}
                name="environment"
                defaultValue={hostDialog.host?.environment ?? "production"}
                options={environments.map((environment) => ({
                  value: environment,
                  label: t[`environment${capitalised(environment)}`] ?? environment
                }))}
              />
              <TextField
                label={t.hostNotes!}
                name="notes"
                maxLength={2000}
                defaultValue={hostDialog.host?.notes ?? ""}
                wide
              />
              {formError && (
                <p className="form-error wide" role="alert">
                  {formError}
                </p>
              )}
              <footer>
                <button type="button" className="secondary-button" onClick={() => setHostDialog(null)}>
                  {t.cancel}
                </button>
                <button type="submit" className="primary-button" disabled={busy}>
                  {hostDialog.host ? t.save : t.create}
                </button>
              </footer>
            </form>
          </section>
        </div>
      )}

      {serviceDialog && (
        <div
          className="dialog-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setServiceDialog(null);
          }}
        >
          <section
            className="crm-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={serviceDialog.service ? t.editService : t.newService}
          >
            <header>
              <h2>{serviceDialog.service ? t.editService : t.newService}</h2>
              <p className="muted">{hosts.find((host) => host.id === serviceDialog.hostId)?.name}</p>
            </header>
            <form className="dialog-form" onSubmit={eventHandler(submitService, onError)}>
              <TextField
                label={t.serviceName!}
                name="name"
                required
                minLength={3}
                maxLength={120}
                defaultValue={serviceDialog.service?.name ?? ""}
              />
              <SelectField
                label={t.serviceKind!}
                name="kind"
                defaultValue={serviceDialog.service?.kind ?? "container"}
                options={serviceKinds.map((kind) => ({ value: kind, label: t[`kind${capitalised(kind)}`] ?? kind }))}
              />
              {/* What the service is and how it is seen are two different things: the Postgres of a
                  self-hosted Supabase is a database, and cAdvisor sees it as a container. */}
              <TextField
                label={t.serviceMatchKey!}
                name="matchKey"
                required
                maxLength={200}
                hint={t.serviceMatchKeyHint}
                defaultValue={serviceDialog.service?.matchKey ?? ""}
                wide
              />
              <SelectField
                label={t.serviceExpected!}
                name="expectedState"
                defaultValue={serviceDialog.service?.expectedState ?? "up"}
                options={expectedStates.map((state) => ({
                  value: state,
                  label: t[`expected${capitalised(state)}`] ?? state
                }))}
              />
              <SelectField
                label={t.serviceCustomer!}
                name="customerId"
                defaultValue={serviceDialog.service?.customerId ?? ""}
                options={[
                  { value: "", label: t.noCustomer! },
                  ...customers.map((customer) => ({ value: customer.id, label: customer.displayName }))
                ]}
              />
              {formError && (
                <p className="form-error wide" role="alert">
                  {formError}
                </p>
              )}
              <footer>
                <button type="button" className="secondary-button" onClick={() => setServiceDialog(null)}>
                  {t.cancel}
                </button>
                <button type="submit" className="primary-button" disabled={busy}>
                  {serviceDialog.service ? t.save : t.create}
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

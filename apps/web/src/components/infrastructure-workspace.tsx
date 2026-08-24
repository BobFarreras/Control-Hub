"use client";

import {
  AlertTriangle,
  Check,
  ExternalLink,
  Eye,
  Layers,
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
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { ConnectorMark } from "@/components/connector-mark";
import { SelectField, TextField, ToggleField } from "@/components/form-field";
import { StatusPill, type StatusTone } from "@/components/status-pill";
import { useToast } from "@/components/toast";
import type {
  AlertSeverity,
  ConnectorDiscoveryResponse,
  ConnectorServicesResponse,
  CustomerOption,
  DiscoveredInstance,
  DiscoveredService,
  HostEnvironment,
  InfrastructureAlert,
  InfrastructureAlertRule,
  InfrastructureAutomation,
  InfrastructureDeployedProject,
  InfrastructureOverview,
  InfrastructureSupabaseProject,
  InventorySummary,
  ObservedTally,
  ObservedHost,
  ObservedService,
  ObservedState,
  Reading,
  ServiceExpectedState,
  ServiceKind
} from "@/lib/api-types";
import { ask } from "@/lib/ask";
import { formValue } from "@/lib/form";
import { actionHandler, eventHandler } from "@/lib/handlers";
import {
  ageLabel,
  alertState,
  alertStateTone,
  filterInventory,
  observedStateTone,
  oldestAge,
  readingFigures,
  severityTone,
  sliceByCollector,
  tallyReadings,
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

/** One deployed project, with the collector's name and the age of the reading behind it. */
export type ProjectRow = InfrastructureDeployedProject & {
  instanceName: string;
  /** Built and validated on the server out of the domain. Null renders as plain text. */
  link: string | null;
  /**
   * The creation date in words, formatted on the server.
   *
   * A date and not an age, because a project created in January is not a stale reading; and
   * formatted there rather than here for the reason every other figure on this screen is: the
   * server and the browser do not necessarily agree about a time zone, and a row that renders
   * one date and hydrates into another is the bug this whole file is arranged to avoid.
   */
  createdLabel: string | null;
  /** How long ago what production serves was built. Null when nothing is deployed. */
  deployedAge: ReadingAge | null;
  age: ReadingAge | null;
  /** How long ago the last build failed, or null when none did inside the window. */
  failureAge: ReadingAge | null;
};

/** One Supabase project, with the collector's name and the age of the reading behind it. */
export type SupabaseProjectRow = InfrastructureSupabaseProject & {
  instanceName: string;
  /** The creation date in words, formatted on the server. Same reason as `ProjectRow.createdLabel`. */
  createdLabel: string | null;
  age: ReadingAge | null;
};

/**
 * What the association dialog is open over.
 *
 * One dialog for two bands, because it asks the same two questions and the answers go to routes
 * of the same shape. `kind` is the path segment, which is why it reads as one: an automation and
 * a project are annotated in two different tables and nothing here has to know why. A Supabase
 * project is a `"projects"` target too, and for the same reason: the link does not know which
 * provider a project came from, so there is no third path segment to route it to.
 */
type LinkTarget = {
  kind: "automations" | "projects";
  instanceId: string;
  externalId: string;
  name: string;
  customerId: string | null;
  notes: string | null;
};

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
const serviceKinds: ServiceKind[] = ["container", "http", "database", "automation", "backup"];
const expectedStates: ServiceExpectedState[] = ["up", "stopped", "ignored"];

const jsonHeaders = { "content-type": "application/json" };

type Result = { ok: true } | { ok: false; code: string | null };

async function call(path: string, init: RequestInit): Promise<Result> {
  const response = await fetch(path, init);
  if (response.ok) return { ok: true };
  const payload: unknown = await response.json().catch(() => null);
  return { ok: false, code: problemCode(payload) };
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

/**
 * One number on the strip at the top of the screen.
 *
 * A strip and not a row of cards. Most of these carry a single figure, and a card each gave every
 * one of them a box, a border and a hand's width of nothing around it -- five boxes spending the
 * width of the screen to say five numbers. Here the number leads, the word follows it, and the
 * breakdown sits under both in the small type it deserves.
 */
function BarFigure({ label, value, note }: { label: string; value: ReactNode; note?: string }) {
  return (
    <div className="figure-cell">
      <strong>{value}</strong>
      <span>{label}</span>
      {note && <small>{note}</small>}
    </div>
  );
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
 * What a collector reads, drawn as the machine rather than as our database.
 *
 * The panel this replaces listed bare labels behind a button and answered "3 etiquetes vistes".
 * That is a true sentence about our tables and a useless one about a server: it did not say which
 * of twenty containers is running, so the next thing anybody did was open a terminal. What a
 * person opening this screen wants is the machine at a glance, and the software already held it
 * -- the readings were stored, they simply were not drawn.
 *
 * **The state is the one the inventory uses**, decided by the same function over the same records,
 * whether or not somebody has declared the thing. A container drawn as running here and as down on
 * the machine's page would be the product arguing with itself.
 *
 * **Every group folds.** Twenty containers are what somebody came for on the day something is
 * wrong and scrolling on every other day, so the fold opens on what is not right: a group holding
 * something down or unseen is open, a group where everything answers is shut with its tally on
 * the summary. `<details>` and not state of our own -- it is the one control a browser already
 * gives a keyboard, a screen reader and a find-in-page.
 *
 * It reads on its own, without waiting to be asked. Nothing leaves for the collector either way
 * -- both endpoints read records already stored -- and the click that used to guard it was
 * guarding the wrong thing: the reason to open this screen *is* this question.
 */
function CollectorView({
  instanceId,
  name,
  connectorType,
  canOperate,
  labels: t,
  locale,
  onDeclare,
  onClaim
}: {
  /** The collector the panel is about. Never empty: it is only mounted with one. */
  instanceId: string;
  /** What that collector is called, so a panel among several says whose readings these are. */
  name: string;
  connectorType: string | undefined;
  canOperate: boolean;
  labels: Labels;
  locale: string;
  /** Opens the dialog below with the label already in the field that gets typed wrongly. */
  onDeclare: (hostname: string) => void;
  /**
   * Says the label is another name for a machine already declared, which is the other thing
   * an undeclared label can be. Absent when there is no machine to attach it to.
   */
  onClaim: ((label: string) => void) | null;
}) {
  const [machines, setMachines] = useState<DiscoveredInstance[] | null>(null);
  const [services, setServices] = useState<DiscoveredService[] | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    // No reset here: the panel is mounted keyed by the collector, so a change of collector builds
    // a new one rather than emptying this one.
    let live = true;

    void (async () => {
      const [seen, read] = await Promise.all([
        ask<ConnectorDiscoveryResponse>(`/api/v1/infrastructure/connectors/${instanceId}/discovery`),
        ask<ConnectorServicesResponse>(`/api/v1/infrastructure/connectors/${instanceId}/services`)
      ]);
      // The answer belongs to the collector that was asked. A late reply from the previous one
      // would be the labels of one collector drawn under the name of another.
      if (!live) return;
      if (!seen.ok) return setFailure(errorMessage(t, seen.code));
      if (!read.ok) return setFailure(errorMessage(t, read.code));
      setMachines(seen.data.instances);
      setServices(read.data.services);
    })();

    return () => {
      live = false;
    };
  }, [instanceId, t]);

  // Figures are worked out here because this panel never renders on the server: it has no data
  // until the browser has asked, so there is no first paint for a second clock to disagree with.
  const now = new Date();

  const groups = new Map<ServiceKind, DiscoveredService[]>();
  for (const service of services ?? []) {
    const group = groups.get(service.kind);
    if (group) group.push(service);
    else groups.set(service.kind, [service]);
  }

  const loading = !failure && (machines === null || services === null);
  const tally = tallyReadings((services ?? []).map((service) => service.reading));

  // A collector that reads none of this is not drawn at all. An n8n reads workflows, which are
  // automations and have their own table on this screen; asking it what machines and containers it
  // sees is a question with no subject, and answering "nothing stored yet" is a panel apologising
  // for a question nobody asked. Failures still show: not being able to ask is worth saying.
  if (!failure && !loading && (machines?.length ?? 0) + (services?.length ?? 0) === 0) return null;

  return (
    <section className="project-panel collector-panel" aria-label={`${t.discoveryTitle} ${name}`}>
      <header className="project-panel-heading">
        <h3>
          <ConnectorMark type={connectorType ?? ""} size={18} />
          {name}
        </h3>
        {services && services.length > 0 && <small className="muted">{tallyFootnote(t, tally)}</small>}
      </header>

      {failure ? (
        <p className="crm-error">
          <AlertTriangle size={17} aria-hidden="true" />
          {failure}
        </p>
      ) : loading ? (
        <p className="crm-empty">{t.collectorLoading}</p>
      ) : (
        <div className="collector-groups">
          {/* The machines first: they are the thing everything else sits on, and the only group
              whose undeclared rows lead to the dialog that declares a machine. */}
          {machines!.length > 0 && (
            <details className="collector-group" open>
              <summary>
                <span className="collector-group-name">{t.sectionHosts}</span>
                <span className="collector-group-count">{machines!.length}</span>
              </summary>
              <ul className="collector-list">
                {machines!.map((instance) => (
                  <li key={instance.label} className="collector-row">
                    <code className="discovery-label">{instance.label}</code>
                    <span className="collector-row-state">
                      {instance.declaredAs ? (
                        <Link
                          className="link-button"
                          href={`/${locale}/infrastructure/hosts/${instance.declaredAs.hostId}`}
                        >
                          {instance.declaredAs.name}
                        </Link>
                      ) : canOperate ? (
                        <>
                          {/* Two things an unclaimed label can be, offered side by side: a
                              machine nobody has declared yet, or another name for one already
                              declared. A Prometheus aggregates by scrape target, so one VPS
                              arrives here as three labels and only the first is a new machine. */}
                          <button className="link-button" type="button" onClick={() => onDeclare(instance.label)}>
                            {t.discoveryDeclare}
                          </button>
                          {onClaim && (
                            <button className="link-button" type="button" onClick={() => onClaim(instance.label)}>
                              {t.discoveryClaim}
                            </button>
                          )}
                        </>
                      ) : (
                        <span className="discovery-undeclared">{t.discoveryUndeclared}</span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          )}

          {[...groups].map(([kind, rows]) => {
            const group = tallyReadings(rows.map((row) => row.reading));
            return (
              <details
                className="collector-group"
                key={kind}
                open={group.up < group.total}
                // Twenty containers in a column the width of a group holding one backup is a
                // scroll beside a hand's width of nothing. Past eight, the group takes the row
                // and lays its own cards out across it.
                data-many={rows.length > 8 ? "yes" : undefined}
              >
                <summary>
                  <span className="collector-group-name">{t[`kind${capitalised(kind)}`] ?? kind}</span>
                  <span className="collector-group-count">{rows.length}</span>
                  <small className="muted">{tallyFootnote(t, group)}</small>
                </summary>
                <ul className="collector-list">
                  {rows.map((service) => {
                    const figures = readingFigures(t, locale, service.reading, now);
                    return (
                      <li key={service.matchKey} className="collector-row">
                        {/* The name first: a column of twenty of these is scanned for a name, and
                            the state is what is checked once the name has been found. */}
                        <span className="collector-name">{service.name}</span>
                        <span className="collector-row-state">
                          <StatusPill
                            tone={observedStateTone[service.reading.state]}
                            label={t[`state${capitalised(service.reading.state)}`] ?? service.reading.state}
                          />
                          {!service.declared && <span className="discovery-undeclared">{t.discoveryUndeclared}</span>}
                        </span>
                        {figures.length > 0 && (
                          <small className="collector-figures">
                            {figures.map((figure) => (
                              <span key={figure.field}>
                                {figure.label} {figure.value}
                              </span>
                            ))}
                          </small>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </details>
            );
          })}
        </div>
      )}
    </section>
  );
}

function automationStateLabel(t: Labels, automation: AutomationRow): string {
  if (automation.archived) return t.automationArchived ?? "";
  return (automation.active ? t.automationActive : t.automationInactive) ?? "";
}

/**
 * What production is doing, in a word.
 *
 * Three answers and not two: `null` is a project nobody has deployed, and drawing that as an
 * outage would send somebody looking for a site that was never there. The tone follows the word
 * and never carries the meaning alone.
 */
function productionState(t: Labels, project: ProjectRow): { tone: StatusTone; label: string } {
  if (project.productionReady === null) return { tone: "neutral", label: t.projectNeverDeployed ?? "" };
  if (project.productionReady) return { tone: "active", label: t.projectServing ?? "" };
  return { tone: "danger", label: t.projectDown ?? "" };
}

/**
 * What a Supabase project is doing, in a word. `null` is a project mid-transition -- restoring,
 * upgrading, resizing -- and drawing that as an outage would be reporting one that is not
 * happening, the same reason `productionReady` above has a neutral answer of its own.
 */
function supabaseState(t: Labels, project: SupabaseProjectRow): { tone: StatusTone; label: string } {
  if (project.healthy === null) return { tone: "neutral", label: t.supabaseProjectTransitioning ?? "" };
  if (project.healthy) return { tone: "active", label: t.supabaseProjectHealthy ?? "" };
  return { tone: "danger", label: t.supabaseProjectDown ?? "" };
}

export function InfrastructureWorkspace({
  overview,
  summary,
  observedFromAge,
  hosts,
  instanceNames,
  instanceTypes,
  automations,
  projects,
  supabaseProjects,
  alerts,
  rules,
  customers,
  canOperate,
  showResolved,
  initialCollector,
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
  /** Which provider each one is, which is what its mark is drawn from. Never an address. */
  instanceTypes: Record<string, string>;
  automations: AutomationRow[];
  projects: ProjectRow[];
  supabaseProjects: SupabaseProjectRow[];
  alerts: InfrastructureAlert[];
  rules: RuleRow[];
  customers: CustomerOption[];
  canOperate: boolean;
  /** Whether the list includes the alerts that are already over. It lives in the query string. */
  showResolved: boolean;
  /** The collector the address bar asked for, or null for the whole of it. */
  initialCollector: string | null;
  labels: Labels;
  locale: string;
  loadError: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [linking, setLinking] = useState<LinkTarget | null>(null);
  // Null is closed; a host of null is one being declared rather than one being corrected. A
  // `hostname` is the discovery filling in the field that gets typed wrongly the first time, and
  // it is read only when there is no host, because correcting a machine starts from its own value.
  const [hostDialog, setHostDialog] = useState<{ host: HostRow | null; hostname?: string } | null>(null);
  const [serviceDialog, setServiceDialog] = useState<{ hostId: string; service: ServiceRow | null } | null>(null);
  const [labelDialog, setLabelDialog] = useState<{ label: string } | null>(null);
  const [ruleDialog, setRuleDialog] = useState(false);
  // What somebody asked to be shown. Client state and not a query string: it narrows a list
  // already in the browser, changes nothing on the server, and reloading to filter would refetch
  // the whole fleet to draw less of it.
  const [filter, setFilter] = useState<InventoryFilter>({ environments: [], states: [], instanceIds: [] });
  // Which collector the screen is about. Unlike the filters below it this one does live in the
  // address bar, because it decides which sections the screen has at all: a screen showing the
  // machine collector and a screen showing the automation one are two different screens, and one
  // of them has to be something somebody can send to somebody else.
  const [collector, setCollector] = useState<string | null>(initialCollector);

  /** Every collector configured, named, so the choice is a name and never a row identifier. */
  const collectors = Object.entries(instanceNames)
    .map(([value, label]) => ({ value, label }))
    .sort((one, other) => one.label.localeCompare(other.label));

  /**
   * Everything the screen holds, reduced to what the chosen collector accounts for.
   *
   * The whole page is drawn from this and never from the props again, so a section cannot show
   * one collector while the heading above it counts another. With nothing chosen it is the props
   * themselves, and the screen is what it always was.
   */
  const chosen = sliceByCollector({ hosts, automations, projects, alerts, rules }, collector);
  // A one-line filter and not another call through `sliceByCollector`: a Supabase project is not
  // one of the five lists that generic already knows how to slice at once, and adding a sixth
  // type parameter for the same single line it already writes for `projects` would not save
  // anything.
  const chosenSupabaseProjects =
    collector === null ? supabaseProjects : supabaseProjects.filter((row) => row.instanceId === collector);

  function chooseCollector(value: string) {
    const next = value === "" ? null : value;
    setCollector(next);
    // Written into the address without navigating: the fleet is already in the browser, and
    // reloading the page to draw less of it would refetch everything to show a subset.
    const url = new URL(window.location.href);
    if (next) url.searchParams.set("collector", next);
    else url.searchParams.delete("collector");
    window.history.replaceState(null, "", url.toString());
  }

  /** Where the alerts link goes, keeping whatever collector is being looked at. */
  const alertsHref = (resolved: boolean) => {
    const query = new URLSearchParams();
    if (resolved) query.set("resolved", "1");
    if (collector) query.set("collector", collector);
    const rest = query.toString();
    return `/${locale}/infrastructure${rest ? `?${rest}` : ""}`;
  };

  // What the filter currently shows, derived from the slice already in hand: nothing is fetched
  // to narrow a list, and no state is recomputed while narrowing it.
  const shown = filterInventory(chosen.hosts, filter);
  // True whenever anything has been asked of the fleet, and not merely when fewer machines came
  // back: a filter that happens to match everything still has to be visible and still has to be
  // clearable.
  const narrowed = Object.values(filter).some((values) => values.length > 0);

  /**
   * The figures above the lists, counted over whatever is being shown.
   *
   * With nothing chosen they are the API's own count of the whole fleet, which is the only count
   * that can speak for machines this screen never received. With a collector chosen they are
   * counted here instead, because the API counted a fleet and the screen is showing a part of
   * one -- and a heading that kept saying "twelve machines" over a list of two would be the
   * screen contradicting itself. The states are the ones the API decided; nothing is judged
   * again on this side, only added up.
   */
  const services = chosen.hosts.flatMap((host) => host.services);
  const figures =
    collector === null
      ? {
          hosts: summary?.hosts ?? null,
          services: summary?.services ?? null,
          automations: overview?.automations ?? null,
          alerts: overview?.alerts ?? null,
          observedFrom: observedFromAge
        }
      : {
          hosts: tallyReadings(chosen.hosts.map((host) => host.reading)),
          services: tallyReadings(services.map((service) => service.reading)),
          automations: {
            total: chosen.automations.length,
            active: chosen.automations.filter((row) => row.active).length,
            linked: chosen.automations.filter((row) => row.customerId).length
          },
          alerts: {
            total: chosen.alerts.length,
            acknowledged: chosen.alerts.filter((alert) => alert.acknowledgedAt).length
          },
          // Chosen among the ages the server worked out, never measured again here.
          observedFrom: oldestAge([
            ...chosen.hosts.map((host) => host.age),
            ...services.map((service) => service.age),
            ...chosen.automations.map((row) => row.age)
          ])
        };

  /** Whether any of the figures survived the rule above, so the row itself can go too. */
  const countable = [figures.hosts, figures.services, figures.automations, figures.alerts].some(
    (figure) => (figure?.total ?? 0) > 0
  );

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

  /**
   * Says a collector label is another name for a machine already declared.
   *
   * A Prometheus aggregates by scrape target and a scrape target is not a computer: one VPS is a
   * `node-exporter:9100` for its own figures, a `cadvisor:8080` for its containers and a
   * `127.0.0.1:9090` for the Prometheus itself. The machine gets declared with one of them and
   * everything else arrives under another, which is why its page could show twenty containers
   * stored and none of them hers. Somebody says which labels are the same machine; nothing is
   * guessed here, because two machines make any guess wrong.
   */
  async function submitLabel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!labelDialog) return;
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setFormError("");
    const result = await call(`/api/v1/infrastructure/hosts/${formValue(data, "hostId")}/labels`, {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ label: labelDialog.label })
    });
    setBusy(false);
    if (!result.ok) return setFormError(errorMessage(t, result.code));
    setLabelDialog(null);
    toast("success", t.labelClaimed ?? "");
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
      `/api/v1/infrastructure/${linking.kind}/${linking.instanceId}/${encodeURIComponent(linking.externalId)}/link`,
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
    const done = linking.kind === "projects" ? t.linkedProject : t.linked;
    setLinking(null);
    toast("success", done ?? "");
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
    <div className="infra-stack">
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

      {/* What the screen is about, and the count of it, on one line. Everything under it follows
          this one choice, and it uses the product's own selector rather than a control invented
          here -- with the collector's mark beside its name, because a list of collectors is read
          by which provider each one is long before it is read by what somebody called it. */}
      <div className="collector-band">
        <div className="collector-pick">
          <SelectField
            label={t.collectorScope ?? ""}
            name="collector"
            value={collector ?? ""}
            onChange={(event) => chooseCollector(event.target.value)}
            options={[
              { value: "", label: t.collectorAll ?? "", icon: <Layers size={16} aria-hidden="true" /> },
              ...collectors.map((option) => ({
                ...option,
                icon: <ConnectorMark type={instanceTypes[option.value] ?? ""} size={16} />
              }))
            ]}
          />
        </div>

        {countable && (
          <div className="figure-bar" aria-label={t.title}>
            {/* Counted over what is being shown, and drawn only where there is something to count:
            a figure reading zero over a selection that holds no such thing is a question nobody
            asked, and seven of them are the empty space this screen was losing. */}
            {figures.hosts && figures.hosts.total > 0 && (
              <BarFigure label={t.overviewHosts!} value={figures.hosts.total} note={tallyFootnote(t, figures.hosts)} />
            )}
            {figures.services && figures.services.total > 0 && (
              <BarFigure
                label={t.overviewServices!}
                value={figures.services.total}
                note={tallyFootnote(t, figures.services)}
              />
            )}
            {figures.automations && figures.automations.total > 0 && (
              <BarFigure
                label={t.overviewAutomations!}
                value={figures.automations.total}
                note={`${figures.automations.active} ${t.overviewActive} · ${figures.automations.linked} ${t.overviewLinked}`}
              />
            )}
            {figures.alerts && figures.alerts.total > 0 && (
              <BarFigure
                label={t.overviewAlerts!}
                value={figures.alerts.total}
                note={`${t.overviewAcknowledged} ${figures.alerts.acknowledged}`}
              />
            )}
            {/* The oldest reading behind the figures, never the newest: a summary is only as fresh
            as the stalest thing that went into it. */}
            {figures.observedFrom && (
              <BarFigure label={t.observedFrom!} value={ageLabel(t, figures.observedFrom, t.observedNever ?? "")} />
            )}
          </div>
        )}
      </div>

      {/* Nothing on fire is one line, not a panel. The way to the alerts that are already over
          stays on that line: a screen that hid the door because there was nothing behind it
          today would leave nowhere to look at what there was yesterday. */}
      {chosen.alerts.length === 0 ? (
        <p className="infra-strip">
          <span>{t.alertsEmpty}</span>
          <a className="link-button" href={alertsHref(!showResolved)}>
            {showResolved ? t.onlyFiring : t.showResolved}
          </a>
        </p>
      ) : (
        <section className="project-panel" aria-label={t.sectionAlerts}>
          <header className="project-panel-heading">
            <h3>{t.sectionAlerts}</h3>
            {/* A link and not a checkbox: what the list contains is then something somebody can send. */}
            <a className="secondary-button" href={alertsHref(!showResolved)}>
              {showResolved ? t.onlyFiring : t.showResolved}
            </a>
          </header>
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
                {chosen.alerts.map((alert) => {
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
        </section>
      )}

      {(collector === null || chosen.hosts.length > 0) && (
        <section className="project-panel" aria-label={t.sectionHosts}>
          {/* Heading, filters and the button that adds one, on a single line. They were three
              bands stacked on top of each other, each of them mostly empty, and they are one
              question: which machines am I looking at. */}
          <header className="project-panel-heading fleet-heading">
            <h3>{t.sectionHosts}</h3>
            {chosen.hosts.length > 0 && (
              <div className="fleet-filter">
                {/* The product's own selector, the one every other list on this screen is filtered
                  with, instead of two rows of chips invented here. Each question takes one answer
                  and "any" is the first of them, which is what the chips were really for: an empty
                  set of chips and a chosen "any" mean the same thing, and only one of the two can
                  be read at a glance. There is no collector question left here -- the selector at
                  the top of the screen already answered it, and asking twice is how a list ends up
                  narrowed to a collector that is not the one on the heading. */}
                <SelectField
                  label={t.filterEnvironment!}
                  name="filterEnvironment"
                  value={filter.environments[0] ?? ""}
                  onChange={(event) =>
                    setFilter({
                      ...filter,
                      environments: event.target.value ? [event.target.value as HostEnvironment] : []
                    })
                  }
                  options={[
                    { value: "", label: t.filterAny ?? "" },
                    ...environments.map((environment) => ({
                      value: environment,
                      label: t[`environment${capitalised(environment)}`] ?? environment
                    }))
                  ]}
                />
                <SelectField
                  label={t.filterState!}
                  name="filterState"
                  value={filter.states[0] ?? ""}
                  onChange={(event) =>
                    setFilter({ ...filter, states: event.target.value ? [event.target.value as ObservedState] : [] })
                  }
                  options={[
                    { value: "", label: t.filterAny ?? "" },
                    ...observedStates.map((state) => ({
                      value: state,
                      label: t[`state${capitalised(state)}`] ?? state
                    }))
                  ]}
                />
                {narrowed && (
                  <p className="fleet-filter-count">
                    <span>
                      {(t.filterShowing ?? "")
                        .replace("{shown}", String(shown.length))
                        .replace("{total}", String(chosen.hosts.length))}
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
          {chosen.hosts.length === 0 ? (
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
      )}

      {/* Every collector, or the one that was chosen. Nothing was drawn here at all until a
          collector was picked, and the reason given was that a list of two collectors says
          nothing about either -- which was answering the wrong question. They are not merged into
          one list: each gets its own panel under its own name, so the whole of the infrastructure
          is on the screen at once and it is still legible whose readings each figure is. Keyed by
          the collector so the answer on screen always belongs to the one named above it. */}
      {(collector ? [collector] : collectors.map((option) => option.value)).map((instanceId) => (
        <CollectorView
          key={instanceId}
          instanceId={instanceId}
          name={instanceNames[instanceId] ?? instanceId}
          connectorType={instanceTypes[instanceId]}
          canOperate={canOperate}
          labels={t}
          locale={locale}
          onDeclare={(hostname) => {
            setFormError("");
            setHostDialog({ host: null, hostname });
          }}
          onClaim={
            canOperate && hosts.length > 0
              ? (label) => {
                  setFormError("");
                  setLabelDialog({ label });
                }
              : null
          }
        />
      ))}

      {/* A section with nothing of this collector in it is not drawn at all. Somebody looking at
          the machine collector is not looking for an empty automations table, and the empty
          panel was the space this screen was spending on questions nobody asked. */}
      {(collector === null || chosen.automations.length > 0) && (
        <section className="project-panel" aria-label={t.sectionAutomations}>
          <h3>{t.sectionAutomations}</h3>
          {chosen.automations.length === 0 ? (
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
                  {chosen.automations.map((automation) => (
                    <tr key={`${automation.instanceId}:${automation.externalId}`}>
                      <td>
                        {automation.link ? (
                          <a
                            className="ticket-subject"
                            href={automation.link}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
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
                        <time dateTime={automation.observedAt}>
                          {ageLabel(t, automation.age, t.observedNever ?? "")}
                        </time>
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
                              setLinking({ kind: "automations", ...automation });
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
      )}

      {/* The projects a hosting provider deploys, on the same terms: absent under a collector
          that reads none. Production and the last failed build are two columns because both can
          be true at once -- a site serving perfectly whose Friday build broke is the ordinary
          case, and one column would have to hide one of the two. */}
      {(collector === null || chosen.projects.length > 0) && (
        <section className="project-panel" aria-label={t.sectionProjects}>
          <h3>{t.sectionProjects}</h3>
          {chosen.projects.length === 0 ? (
            <p className="muted">{t.projectsEmpty}</p>
          ) : (
            <div className="crm-table-wrap inside-panel">
              <table className="crm-table">
                <thead>
                  <tr>
                    <th>{t.name}</th>
                    <th>{t.projectDomain}</th>
                    <th>{t.projectProduction}</th>
                    <th>{t.projectCreated}</th>
                    <th>{t.projectLastFailure}</th>
                    <th>{t.customer}</th>
                    <th>{t.observed}</th>
                    {canOperate && <th />}
                  </tr>
                </thead>
                <tbody>
                  {chosen.projects.map((project) => {
                    const production = productionState(t, project);
                    return (
                      <tr key={`${project.instanceId}:${project.externalId}`}>
                        <td>
                          <span className="ticket-subject">{project.name}</span>
                          {/* What it is built with belongs with what it is called, not in a column
                              of its own: it identifies the project, it never changes, and nobody
                              scans a fleet by framework. */}
                          <small className="muted">
                            {project.framework
                              ? `${project.instanceName} · ${project.framework}`
                              : project.instanceName}
                          </small>
                        </td>
                        <td>
                          {/* The client's own domain, and the only address on this screen that is
                              not the provider's. The anchor was composed and checked on the
                              server like every other link here: an alias is what a provider
                              answered, and nothing that arrives from one becomes a destination
                              on this side. */}
                          {project.link ? (
                            <a className="ticket-subject" href={project.link} target="_blank" rel="noopener noreferrer">
                              {project.domain}
                              <ExternalLink size={14} aria-label={t.open} />
                            </a>
                          ) : (
                            <span className={project.domain ? "ticket-subject" : "muted"}>
                              {project.domain ?? t.noLink}
                            </span>
                          )}
                        </td>
                        <td>
                          <StatusPill tone={production.tone} label={production.label} />
                          {/* When what is being served was built. While production is serving this
                              is the last build that came out well, which is why no record of
                              successful builds has to be kept to answer it. */}
                          {project.productionDeployedAt && (
                            <small className="muted">
                              {(t.projectDeployedAgo ?? "").replace(
                                "{age}",
                                ageLabel(t, project.deployedAge, t.observedNever ?? "")
                              )}
                            </small>
                          )}
                        </td>
                        <td>
                          {/* Empty when the provider sent no date. There is no word for it that
                              would not be inventing a fact: a project has a creation date or we
                              did not receive one, and neither is news. */}
                          {project.createdLabel && <time dateTime={project.createdAt!}>{project.createdLabel}</time>}
                        </td>
                        <td>
                          {project.lastFailureAt ? (
                            <>
                              <time dateTime={project.lastFailureAt}>
                                {ageLabel(t, project.failureAge, t.observedNever ?? "")}
                              </time>
                              {project.lastFailureRef && <small className="muted">{project.lastFailureRef}</small>}
                            </>
                          ) : (
                            <span className="muted">{t.projectNoFailure}</span>
                          )}
                        </td>
                        <td>
                          {customers.find((customer) => customer.id === project.customerId)?.displayName ?? (
                            <span className="muted">{t.noCustomer}</span>
                          )}
                        </td>
                        <td>
                          <time dateTime={project.observedAt}>{ageLabel(t, project.age, t.observedNever ?? "")}</time>
                          {project.age?.stale && (
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
                                setLinking({ kind: "projects", ...project });
                              }}
                            >
                              <UserPlus size={16} />
                            </button>
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
      )}

      {/* The projects a database provider hosts, in a band of its own: the columns are not the
          Vercel ones -- there is no domain and no build to fail -- so a shared table would either
          leave cells empty or grow columns that mean nothing for one provider or the other. */}
      {(collector === null || chosenSupabaseProjects.length > 0) && (
        <section className="project-panel" aria-label={t.sectionSupabaseProjects}>
          <h3>{t.sectionSupabaseProjects}</h3>
          {chosenSupabaseProjects.length === 0 ? (
            <p className="muted">{t.supabaseProjectsEmpty}</p>
          ) : (
            <div className="crm-table-wrap inside-panel">
              <table className="crm-table">
                <thead>
                  <tr>
                    <th>{t.name}</th>
                    <th>{t.supabaseProjectRegion}</th>
                    <th>{t.supabaseProjectStatus}</th>
                    <th>{t.projectCreated}</th>
                    <th>{t.customer}</th>
                    <th>{t.observed}</th>
                    {canOperate && <th />}
                  </tr>
                </thead>
                <tbody>
                  {chosenSupabaseProjects.map((project) => {
                    const state = supabaseState(t, project);
                    return (
                      <tr key={`${project.instanceId}:${project.externalId}`}>
                        <td>
                          <span className="ticket-subject">{project.name}</span>
                          <small className="muted">{project.instanceName}</small>
                        </td>
                        <td>{project.region ?? <span className="muted">{t.noLink}</span>}</td>
                        <td>
                          <StatusPill tone={state.tone} label={state.label} />
                          {/* The provider's own word underneath the one we mapped it to: `healthy`
                              collapses a dozen states into three, and the raw one is still worth
                              having when three is not enough to tell what is actually happening. */}
                          {project.status && <small className="muted">{project.status}</small>}
                        </td>
                        <td>
                          {project.createdLabel && (
                            <time dateTime={project.createdAt!}>{project.createdLabel}</time>
                          )}
                        </td>
                        <td>
                          {customers.find((customer) => customer.id === project.customerId)?.displayName ?? (
                            <span className="muted">{t.noCustomer}</span>
                          )}
                        </td>
                        <td>
                          <time dateTime={project.observedAt}>{ageLabel(t, project.age, t.observedNever ?? "")}</time>
                          {project.age?.stale && (
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
                                setLinking({ kind: "projects", ...project });
                              }}
                            >
                              <UserPlus size={16} />
                            </button>
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
      )}

      {/* The rules a collector has, on the same terms as the tables above. Making one is reached
          from the whole infrastructure, where every collector is on offer in the dialog. */}
      {(collector === null || chosen.rules.length > 0) && (
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
          {chosen.rules.length === 0 ? (
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
                  {chosen.rules.map((rule) => (
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
      )}

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

      {labelDialog && (
        <div
          className="dialog-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setLabelDialog(null);
          }}
        >
          <section className="crm-dialog" role="dialog" aria-modal="true" aria-label={t.claimTitle}>
            <header>
              <h2>{t.claimTitle}</h2>
              <p className="muted">{t.claimAbout}</p>
            </header>
            <form className="dialog-form" onSubmit={eventHandler(submitLabel, onError)}>
              <p className="wide">
                <code className="discovery-label">{labelDialog.label}</code>
              </p>
              <SelectField
                label={t.claimHost!}
                name="hostId"
                defaultValue={hosts[0]?.id ?? ""}
                options={hosts.map((host) => ({ value: host.id, label: `${host.name} · ${host.hostname}` }))}
              />
              {formError && (
                <p className="form-error wide" role="alert">
                  {formError}
                </p>
              )}
              <footer>
                <button type="button" className="secondary-button" onClick={() => setLabelDialog(null)}>
                  {t.cancel}
                </button>
                <button type="submit" className="primary-button" disabled={busy}>
                  {t.claimSubmit}
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
    </div>
  );
}

import { getDictionary, getInfrastructureDictionary, isLocale } from "@control-hub/i18n";
import { notFound } from "next/navigation";
import { AppSidebar } from "@/components/app-sidebar";
import {
  InfrastructureWorkspace,
  type AutomationRow,
  type HostRow,
  type RuleRow
} from "@/components/infrastructure-workspace";
import { PageTopbar } from "@/components/page-topbar";
import { apiFetch, readJson } from "@/lib/api";
import type {
  ConnectorInstance,
  CustomerOption,
  InfrastructureAlert,
  InfrastructureAlertRulesResponse,
  InfrastructureAlertsResponse,
  InfrastructureAutomationsResponse,
  InfrastructureInventoryResponse,
  InfrastructureOverview,
  InfrastructureOverviewResponse,
  InventorySummary,
  IntegrationsResponse,
  Page as ApiPage
} from "@/lib/api-types";
import { featureEnabled } from "@/lib/features";
import { readingAge, readingFigures } from "@/lib/infrastructure";
import { automationLink } from "@/lib/infrastructure-link";
import { requireSession } from "@/lib/require-session";

/**
 * The infrastructure screen.
 *
 * Two decisions live here rather than in the component. **The link to a workflow is composed and
 * validated on this side**, out of the base an operator configured on the integration and the
 * workflow id the provider gave us: the infrastructure API deliberately answers with neither, so
 * this is the only place that holds both halves, and the browser receives a link we built or
 * nothing at all. **The age of every reading is computed here too**, and so are the words its
 * figures are read in, against a single instant, so that a row cannot read differently on the
 * server and after hydration, and so that a figure arrives already carrying how old it is.
 *
 * What is not decided here is whether a machine is up: that is the API's answer, taken as given.
 * Two places deciding it is how a green screen and a live alert end up describing one machine at
 * the same time.
 *
 * The bases come from the integrations surface, which needs its own permission. Without it there
 * are no links and the names render as text, which is the same outcome as a base nobody
 * configured — not an error, and not a reason for the screen to fail.
 *
 * Specification: `docs/specifications/infrastructure.md`.
 */

type Loaded = {
  overview: InfrastructureOverview | null;
  /** The fleet counted by state, as the API counted it. Never narrowed by a filter. */
  summary: InventorySummary | null;
  hosts: HostRow[];
  /** What each connector instance is called, so a filter can offer names instead of ids. */
  instanceNames: Record<string, string>;
  /** Which provider each one is. The type and never the configuration: it only draws a mark. */
  instanceTypes: Record<string, string>;
  automations: AutomationRow[];
  alerts: InfrastructureAlert[];
  rules: RuleRow[];
  customers: CustomerOption[];
  canOperate: boolean;
  loadError: boolean;
};

const empty: Loaded = {
  overview: null,
  summary: null,
  hosts: [],
  instanceNames: {},
  instanceTypes: {},
  automations: [],
  alerts: [],
  rules: [],
  customers: [],
  canOperate: false,
  loadError: true
};

async function canOperate(): Promise<boolean> {
  const response = await apiFetch("/api/v1/me");
  if (!response.ok) return false;
  const payload = await readJson<{ context: { permissions: string[] } }>(response);
  return payload.context.permissions.includes("infrastructure:operate");
}

/** The configured base of each integration, which is the half of a link that is ours. */
function basesOf(
  integrations: ConnectorInstance[]
): Map<string, { name: string; connectorType: string; baseUrl: string | null }> {
  return new Map(
    integrations.map((instance) => {
      const baseUrl = instance.config.baseUrl;
      return [
        instance.id,
        {
          name: instance.name,
          connectorType: instance.connectorType,
          baseUrl: typeof baseUrl === "string" ? baseUrl : null
        }
      ];
    })
  );
}

async function load(locale: string, labels: Record<string, string>, showResolved: boolean, now: Date): Promise<Loaded> {
  try {
    const [
      overviewResponse,
      inventoryResponse,
      automationsResponse,
      alertsResponse,
      rulesResponse,
      integrationsResponse,
      customersResponse,
      operate
    ] = await Promise.all([
      apiFetch("/api/v1/infrastructure/overview"),
      apiFetch("/api/v1/infrastructure/inventory"),
      apiFetch("/api/v1/infrastructure/automations"),
      apiFetch(`/api/v1/infrastructure/alerts${showResolved ? "" : "?status=firing"}`),
      apiFetch("/api/v1/infrastructure/alert-rules"),
      apiFetch("/api/v1/integrations"),
      apiFetch("/api/v1/crm/customers?page=1&pageSize=100&sort=name_asc"),
      canOperate()
    ]);

    if (!overviewResponse.ok || !automationsResponse.ok) return empty;

    const bases = basesOf(
      integrationsResponse.ok ? (await readJson<IntegrationsResponse>(integrationsResponse)).integrations : []
    );
    const named = (instanceId: string) => bases.get(instanceId)?.name ?? instanceId;

    // Read once and used twice: the rows below and the summary above have to come out of the
    // same answer, or the screen would count one fleet and list another.
    const inventory = inventoryResponse.ok
      ? (await readJson<InfrastructureInventoryResponse>(inventoryResponse)).inventory
      : null;

    return {
      overview: (await readJson<InfrastructureOverviewResponse>(overviewResponse)).overview,
      // A reading arrives with the two things only this side can add: how old it is, and what its
      // figures say in words. Both are worked out against the one instant above. The state itself
      // travels untouched -- the API decided it against the cadence the collector declares, and a
      // second opinion on this side is exactly what must not exist.
      summary: inventory?.summary ?? null,
      hosts:
        inventory?.hosts.map<HostRow>((host) => ({
          ...host,
          age: readingAge(host.reading.observedAt, now),
          figures: readingFigures(labels, locale, host.reading, now),
          services: host.services.map((service) => ({
            ...service,
            age: readingAge(service.reading.observedAt, now),
            figures: readingFigures(labels, locale, service.reading, now)
          }))
        })) ?? [],
      instanceNames: Object.fromEntries([...bases].map(([id, base]) => [id, base.name])),
      instanceTypes: Object.fromEntries([...bases].map(([id, base]) => [id, base.connectorType])),
      automations: (await readJson<InfrastructureAutomationsResponse>(automationsResponse)).automations.map(
        (automation) => ({
          ...automation,
          instanceName: named(automation.instanceId),
          link: automationLink(bases.get(automation.instanceId)?.baseUrl, automation.externalId),
          age: readingAge(automation.observedAt, now)
        })
      ),
      alerts: alertsResponse.ok ? (await readJson<InfrastructureAlertsResponse>(alertsResponse)).alerts : [],
      rules: rulesResponse.ok
        ? (await readJson<InfrastructureAlertRulesResponse>(rulesResponse)).rules.map((rule) => ({
            ...rule,
            instanceName: named(rule.instanceId)
          }))
        : [],
      customers: customersResponse.ok ? (await readJson<ApiPage<CustomerOption>>(customersResponse)).items : [],
      canOperate: operate,
      loadError: false
    };
  } catch {
    return empty;
  }
}

export default async function InfrastructurePage({
  params,
  searchParams
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  // The flag decides whether the module is deployed at all. With it closed the API serves no such
  // route, the menu shows no entry, and this answers 404 rather than an empty screen over one.
  if (!featureEnabled("infrastructure")) notFound();
  await requireSession(locale);

  const t = getDictionary(locale);
  const labels = getInfrastructureDictionary(locale) as unknown as Record<string, string>;
  const query = await searchParams;

  const now = new Date();
  const showResolved = query.resolved === "1";
  // Which collector the screen is about, straight from the address so a link to one collector
  // opens on that collector. It is read as an opaque identifier and handed on: what it is allowed
  // to be is settled by the fleet the browser already holds, and an unknown one narrows to
  // nothing rather than asking the API about it.
  const collector = query.collector ?? null;
  const data = await load(locale, labels, showResolved, now);

  return (
    <div className="app-shell">
      <AppSidebar locale={locale} labels={t.navigation} />
      <div className="workspace">
        <PageTopbar
          eyebrow={labels.eyebrow!}
          title={labels.title!}
          description={labels.description}
          themeLabel={t.header.theme}
        />
        <main className="compact-main">
          <InfrastructureWorkspace
            overview={data.overview}
            summary={data.summary}
            observedFromAge={readingAge(data.overview?.observedFrom, now)}
            hosts={data.hosts}
            instanceNames={data.instanceNames}
            instanceTypes={data.instanceTypes}
            automations={data.automations}
            alerts={data.alerts}
            rules={data.rules}
            customers={data.customers}
            canOperate={data.canOperate}
            showResolved={showResolved}
            initialCollector={collector}
            labels={labels}
            locale={locale}
            loadError={data.loadError}
          />
        </main>
      </div>
    </div>
  );
}

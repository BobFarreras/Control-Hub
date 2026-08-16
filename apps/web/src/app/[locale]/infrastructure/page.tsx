import { getDictionary, getInfrastructureDictionary, isLocale } from "@control-hub/i18n";
import { notFound } from "next/navigation";
import { AppSidebar } from "@/components/app-sidebar";
import { InfrastructureWorkspace, type AutomationRow, type RuleRow } from "@/components/infrastructure-workspace";
import { PageTopbar } from "@/components/page-topbar";
import { apiFetch, readJson } from "@/lib/api";
import type {
  ConnectorInstance,
  CustomerOption,
  InfrastructureAlert,
  InfrastructureAlertRulesResponse,
  InfrastructureAlertsResponse,
  InfrastructureAutomationsResponse,
  InfrastructureOverview,
  InfrastructureOverviewResponse,
  IntegrationsResponse,
  Page as ApiPage
} from "@/lib/api-types";
import { featureEnabled } from "@/lib/features";
import { readingAge } from "@/lib/infrastructure";
import { automationLink } from "@/lib/infrastructure-link";
import { requireSession } from "@/lib/require-session";

/**
 * The infrastructure screen.
 *
 * Two decisions live here rather than in the component. **The link to a workflow is composed and
 * validated on this side**, out of the base an operator configured on the integration and the
 * workflow id the provider gave us: the infrastructure API deliberately answers with neither, so
 * this is the only place that holds both halves, and the browser receives a link we built or
 * nothing at all. **The age of every reading is computed here too**, against a single instant, so
 * that a row cannot read differently on the server and after hydration, and so that a figure
 * arrives already carrying how old it is.
 *
 * The bases come from the integrations surface, which needs its own permission. Without it there
 * are no links and the names render as text, which is the same outcome as a base nobody
 * configured — not an error, and not a reason for the screen to fail.
 *
 * Specification: `docs/specifications/infrastructure.md`.
 */

type Loaded = {
  overview: InfrastructureOverview | null;
  automations: AutomationRow[];
  alerts: InfrastructureAlert[];
  rules: RuleRow[];
  customers: CustomerOption[];
  canOperate: boolean;
  loadError: boolean;
};

const empty: Loaded = {
  overview: null,
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
function basesOf(integrations: ConnectorInstance[]): Map<string, { name: string; baseUrl: string | null }> {
  return new Map(
    integrations.map((instance) => {
      const baseUrl = instance.config.baseUrl;
      return [instance.id, { name: instance.name, baseUrl: typeof baseUrl === "string" ? baseUrl : null }];
    })
  );
}

async function load(showResolved: boolean, now: Date): Promise<Loaded> {
  try {
    const [
      overviewResponse,
      automationsResponse,
      alertsResponse,
      rulesResponse,
      integrationsResponse,
      customersResponse,
      operate
    ] = await Promise.all([
      apiFetch("/api/v1/infrastructure/overview"),
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

    return {
      overview: (await readJson<InfrastructureOverviewResponse>(overviewResponse)).overview,
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
  const data = await load(showResolved, now);

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
            observedFromAge={readingAge(data.overview?.observedFrom, now)}
            automations={data.automations}
            alerts={data.alerts}
            rules={data.rules}
            customers={data.customers}
            canOperate={data.canOperate}
            showResolved={showResolved}
            labels={labels}
            locale={locale}
            loadError={data.loadError}
          />
        </main>
      </div>
    </div>
  );
}

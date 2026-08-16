import { getDictionary, getIntegrationsDictionary, isLocale } from "@control-hub/i18n";
import { notFound } from "next/navigation";
import { AppSidebar } from "@/components/app-sidebar";
import { IntegrationDetailScreen } from "@/components/integration-detail";
import { PageTopbar } from "@/components/page-topbar";
import { apiFetch, readJson } from "@/lib/api";
import type {
  ConnectorCatalogueEntry,
  ConnectorCatalogueResponse,
  ConnectorCredentialsResponse,
  ConnectorEndpointsResponse,
  ConnectorInstance,
  ConnectorRunsResponse,
  IntegrationDetail
} from "@/lib/api-types";
import { connectorLabel } from "@/lib/connector-labels";
import { featureEnabled } from "@/lib/features";
import { requireSession } from "@/lib/require-session";

/**
 * One integration, with everything that hangs off it.
 *
 * A route rather than the panel it used to be. The listing answers "which of these is on fire";
 * this answers "what is this one, and what has it been doing", and those two questions were
 * sharing a screen and a scrollbar.
 *
 * The identifier is not trusted for anything: it goes to the API, which is tenant-scoped, and an
 * instance belonging to somebody else is simply not found. That is why the 404 below needs no
 * comparison of tenants here.
 *
 * Specification: `docs/specifications/connectors.md`.
 */

/**
 * The three lists that hang off one integration.
 *
 * Endpoints and credentials are absent on an installation without a key ring: the API declares no
 * such route there, and a 404 means "this deployment cannot hold a secret", not "something broke".
 * An empty section says exactly that, which is truer than an error banner would be.
 */
async function loadDetail(instance: ConnectorInstance): Promise<IntegrationDetail> {
  const [endpoints, credentials, runs] = await Promise.all([
    apiFetch(`/api/v1/integrations/${instance.id}/endpoints`),
    apiFetch(`/api/v1/integrations/${instance.id}/credentials`),
    apiFetch(`/api/v1/integrations/${instance.id}/runs?page=1&pageSize=20`)
  ]);
  const runsPage = runs.ok ? await readJson<ConnectorRunsResponse>(runs) : null;
  return {
    instance,
    endpoints: endpoints.ok ? (await readJson<ConnectorEndpointsResponse>(endpoints)).endpoints : [],
    credentials: credentials.ok ? (await readJson<ConnectorCredentialsResponse>(credentials)).credentials : [],
    runs: runsPage?.runs ?? [],
    runsTotal: runsPage?.total ?? 0,
    // The instance was fetched successfully, so it exists: a 404 here is the route missing, not
    // the integration.
    vaultAvailable: endpoints.status !== 404
  };
}

/**
 * The two permissions this screen distinguishes.
 *
 * Managing an integration and holding its secrets are separate grants, so they are read
 * separately: whoever may point an instance at a different host is not thereby allowed to write
 * the token it authenticates with.
 */
async function permissions(): Promise<{ manage: boolean; rotate: boolean }> {
  const response = await apiFetch("/api/v1/me");
  if (!response.ok) return { manage: false, rotate: false };
  const granted = (await readJson<{ context: { permissions: string[] } }>(response)).context.permissions;
  return { manage: granted.includes("integrations:manage"), rotate: granted.includes("credentials:rotate") };
}

async function loadCatalogue(): Promise<ConnectorCatalogueEntry[]> {
  const response = await apiFetch("/api/v1/connectors");
  if (!response.ok) return [];
  return (await readJson<ConnectorCatalogueResponse>(response)).connectors;
}

export default async function IntegrationPage({ params }: { params: Promise<{ locale: string; instanceId: string }> }) {
  const { locale, instanceId } = await params;
  if (!isLocale(locale)) notFound();
  // The flag decides whether the module is deployed at all. Without it the API serves no such
  // route, and a page that rendered a shell over a 404 would be a lie.
  if (!featureEnabled("connectors")) notFound();
  await requireSession(locale);

  const t = getDictionary(locale);
  const labels = getIntegrationsDictionary(locale) as unknown as Record<string, string>;

  const response = await apiFetch(`/api/v1/integrations/${instanceId}`);
  if (!response.ok) notFound();
  const instance = (await readJson<{ integration: ConnectorInstance }>(response)).integration;

  const [detail, granted, catalogue] = await Promise.all([loadDetail(instance), permissions(), loadCatalogue()]);

  return (
    <div className="app-shell">
      <AppSidebar locale={locale} labels={t.navigation} />
      <div className="workspace">
        <PageTopbar
          eyebrow={connectorLabel(labels, instance.connectorType)}
          title={instance.name}
          description={labels.detailDescription}
          themeLabel={t.header.theme}
          back={{ label: t.header.back, fallbackHref: `/${locale}/integrations` }}
        />
        <main className="compact-main">
          <IntegrationDetailScreen
            detail={detail}
            entry={catalogue.find((candidate) => candidate.type === instance.connectorType)}
            canManage={granted.manage}
            canRotate={granted.rotate}
            labels={labels}
            locale={locale}
          />
        </main>
      </div>
    </div>
  );
}

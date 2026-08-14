import { getDictionary, getIntegrationsDictionary, isLocale } from "@control-hub/i18n";
import { notFound } from "next/navigation";
import { AppSidebar } from "@/components/app-sidebar";
import { IntegrationsWorkspace } from "@/components/integrations-workspace";
import { PageTopbar } from "@/components/page-topbar";
import { apiFetch, readJson } from "@/lib/api";
import type {
  ConnectorCatalogueEntry,
  ConnectorCatalogueResponse,
  ConnectorCredentialsResponse,
  ConnectorEndpointsResponse,
  ConnectorInstance,
  ConnectorInstanceStatus,
  ConnectorRunsResponse,
  IntegrationDetail,
  IntegrationsResponse,
  TablePreference,
  TablePreferenceResponse
} from "@/lib/api-types";
import { featureEnabled } from "@/lib/features";
import { requireSession } from "@/lib/require-session";

/**
 * The integrations screen.
 *
 * `GET /api/v1/integrations` answers with every instance of the tenant and no pagination, because
 * an installation has a handful of them and a page parameter would be ceremony over a list that
 * fits in one response. The sorting, the filtering and the slicing therefore happen here rather
 * than in the API — and the moment that list stops fitting, this is the file that has to change,
 * which is where somebody will look.
 *
 * Specification: `docs/specifications/connectors.md`.
 */

const sorts = ["created_desc", "name_asc"] as const;
type IntegrationSort = (typeof sorts)[number];

const statuses: ConnectorInstanceStatus[] = ["draft", "enabled", "disabled", "error"];

const defaultPreference: TablePreference = {
  tableId: "integrations.list",
  columnOrder: [],
  hiddenColumns: [],
  columnWidths: {},
  pageSize: 25
};

async function loadPreference(): Promise<TablePreference> {
  const response = await apiFetch("/api/v1/table-preferences/integrations.list");
  if (!response.ok) return defaultPreference;
  return (await readJson<TablePreferenceResponse>(response)).preference;
}

/**
 * The two permissions this screen distinguishes.
 *
 * Managing an integration and holding its secrets are separate grants, so they are read
 * separately: whoever may point an instance at a different host is not thereby allowed to write
 * the token it authenticates with. Read together in one call because it is one answer.
 */
async function permissions(): Promise<{ manage: boolean; rotate: boolean }> {
  const response = await apiFetch("/api/v1/me");
  if (!response.ok) return { manage: false, rotate: false };
  const granted = (await readJson<{ context: { permissions: string[] } }>(response)).context.permissions;
  return { manage: granted.includes("integrations:manage"), rotate: granted.includes("credentials:rotate") };
}

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
  return {
    instance,
    endpoints: endpoints.ok ? (await readJson<ConnectorEndpointsResponse>(endpoints)).endpoints : [],
    credentials: credentials.ok ? (await readJson<ConnectorCredentialsResponse>(credentials)).credentials : [],
    runs: runs.ok ? (await readJson<ConnectorRunsResponse>(runs)).runs : [],
    // The instance came from the listing, so it exists: a 404 here is the route missing, not the
    // integration.
    vaultAvailable: endpoints.status !== 404
  };
}

async function load(): Promise<{
  integrations: ConnectorInstance[];
  catalogue: ConnectorCatalogueEntry[];
  vault: boolean;
  preference: TablePreference;
  manage: boolean;
  rotate: boolean;
  loadError: boolean;
}> {
  try {
    const [preference, { manage, rotate }, response, catalogueResponse] = await Promise.all([
      loadPreference(),
      permissions(),
      apiFetch("/api/v1/integrations"),
      apiFetch("/api/v1/connectors")
    ]);
    // One read for both: the catalogue says what can be created, and whether this installation can
    // hold a secret for it. A screen needs the second answer before it has any instance to ask about.
    const offered = catalogueResponse.ok
      ? await readJson<ConnectorCatalogueResponse>(catalogueResponse)
      : { connectors: [], vaultAvailable: false };
    const catalogue = offered.connectors;
    const vault = offered.vaultAvailable;
    if (!response.ok) return { integrations: [], catalogue, vault, preference, manage, rotate, loadError: true };
    return {
      integrations: (await readJson<IntegrationsResponse>(response)).integrations,
      catalogue,
      vault,
      preference,
      manage,
      rotate,
      loadError: false
    };
  } catch {
    return {
      integrations: [],
      catalogue: [],
      vault: false,
      preference: defaultPreference,
      manage: false,
      rotate: false,
      loadError: true
    };
  }
}

export default async function IntegrationsPage({
  params,
  searchParams
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  // The flag decides whether the module is deployed at all. Without it the API serves no such
  // route, and a page that renders an empty table over a 404 would be a lie.
  if (!featureEnabled("connectors")) notFound();
  await requireSession(locale);

  const t = getDictionary(locale);
  const labels = getIntegrationsDictionary(locale) as unknown as Record<string, string>;
  const query = await searchParams;

  const sort: IntegrationSort = sorts.includes(query.sort as IntegrationSort)
    ? (query.sort as IntegrationSort)
    : "created_desc";
  const status = statuses.find((candidate) => candidate === query.status);
  const pageSizeFromQuery = [10, 25, 50, 100].includes(Number(query.pageSize)) ? Number(query.pageSize) : null;

  const data = await load();
  const pageSize = (pageSizeFromQuery ?? data.preference.pageSize) as TablePreference["pageSize"];
  const preference = { ...data.preference, pageSize };

  const filtered = data.integrations
    .filter((instance) => !status || instance.status === status)
    .sort((a, b) =>
      sort === "name_asc" ? a.name.localeCompare(b.name, locale) : b.createdAt.localeCompare(a.createdAt)
    );
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const page = Math.min(Math.max(1, Number(query.page) || 1), pages);
  const rows = filtered.slice((page - 1) * pageSize, page * pageSize);

  // The selection is read from the whole list rather than fetched again: it is already here, and a
  // second request would only be a second chance for the two answers to disagree.
  const selected = data.integrations.find((instance) => instance.id === query.selected);
  const detail = selected ? await loadDetail(selected) : null;

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
          <IntegrationsWorkspace
            integrations={rows}
            total={filtered.length}
            page={page}
            preference={preference}
            catalogue={data.catalogue}
            vaultAvailable={data.vault}
            detail={detail}
            canManage={data.manage}
            canRotate={data.rotate}
            labels={labels}
            locale={locale}
            loadError={data.loadError}
            sort={sort}
          />
        </main>
      </div>
    </div>
  );
}

import { getDictionary, getIntegrationsDictionary, isLocale } from "@control-hub/i18n";
import { notFound, redirect } from "next/navigation";
import { AppSidebar } from "@/components/app-sidebar";
import { IntegrationsWorkspace } from "@/components/integrations-workspace";
import { PageTopbar } from "@/components/page-topbar";
import { apiFetch, readJson } from "@/lib/api";
import type {
  ConnectorCatalogueEntry,
  ConnectorCatalogueResponse,
  ConnectorInstance,
  ConnectorInstanceStatus,
  IntegrationsResponse,
  TablePreference,
  TablePreferenceResponse
} from "@/lib/api-types";
import { featureEnabled } from "@/lib/features";
import { readingAge } from "@/lib/infrastructure";
import { selectedInstancePath } from "@/lib/integrations";
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
 * Whether this listing offers anything beyond reading.
 *
 * Only the one permission: creating is all this screen does, and holding a secret is asked about
 * on the integration itself, where the credential form lives.
 */
async function canManage(): Promise<boolean> {
  const response = await apiFetch("/api/v1/me");
  if (!response.ok) return false;
  const granted = (await readJson<{ context: { permissions: string[] } }>(response)).context.permissions;
  return granted.includes("integrations:manage");
}

async function load(): Promise<{
  integrations: ConnectorInstance[];
  catalogue: ConnectorCatalogueEntry[];
  vault: boolean;
  preference: TablePreference;
  manage: boolean;
  loadError: boolean;
}> {
  try {
    const [preference, manage, response, catalogueResponse] = await Promise.all([
      loadPreference(),
      canManage(),
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
    if (!response.ok) return { integrations: [], catalogue, vault, preference, manage, loadError: true };
    return {
      integrations: (await readJson<IntegrationsResponse>(response)).integrations,
      catalogue,
      vault,
      preference,
      manage,
      loadError: false
    };
  } catch {
    return {
      integrations: [],
      catalogue: [],
      vault: false,
      preference: defaultPreference,
      manage: false,
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

  // An integration used to be selected here with `?selected=`, and those links are out in the
  // world. Anything that is not shaped like an identifier is ignored rather than followed.
  const selected = selectedInstancePath(locale, query.selected);
  if (selected) redirect(selected);

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

  // Measured here rather than in the table: "now" on the client is a different instant from "now"
  // on the server, and a row that renders one age and hydrates into another is a mismatch React
  // reports as a bug. Only the rows on screen, because only those are drawn.
  const now = new Date();
  const ages = Object.fromEntries(rows.map((instance) => [instance.id, readingAge(instance.health.checkedAt, now)]));

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
            canManage={data.manage}
            ages={ages}
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

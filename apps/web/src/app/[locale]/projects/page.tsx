import { getDictionary, getProjectsDictionary, isLocale } from "@control-hub/i18n";
import { notFound } from "next/navigation";
import { AppSidebar } from "@/components/app-sidebar";
import { InstantSearch } from "@/components/instant-search";
import { PageTopbar } from "@/components/page-topbar";
import { ProjectsWorkspace } from "@/components/projects-workspace";
import { apiFetch, readJson } from "@/lib/api";
import type {
  CustomerOption,
  Page,
  ProjectsPage,
  ServiceTypesResponse,
  TablePreference,
  TablePreferenceResponse
} from "@/lib/api-types";
import { featureEnabled } from "@/lib/features";
import { requireSession } from "@/lib/require-session";

const sorts = ["created_desc", "created_asc", "due_asc", "name_asc"] as const;
type ProjectSort = (typeof sorts)[number];

const defaultPreference: TablePreference = {
  tableId: "projects.list",
  columnOrder: [],
  hiddenColumns: [],
  columnWidths: {},
  pageSize: 25
};

const emptyPage: ProjectsPage = { items: [], total: 0, page: 1, pageSize: 25 };

async function load(search: URLSearchParams) {
  try {
    const preferenceResponse = await apiFetch("/api/v1/table-preferences/projects.list");
    const preference = preferenceResponse.ok
      ? (await readJson<TablePreferenceResponse>(preferenceResponse)).preference
      : defaultPreference;

    if (!search.has("pageSize")) search.set("pageSize", String(preference.pageSize));
    const [response, customersResponse, serviceTypesResponse] = await Promise.all([
      apiFetch(`/api/v1/projects?${search}`),
      apiFetch("/api/v1/crm/customers?page=1&pageSize=100&sort=name_asc"),
      apiFetch("/api/v1/service-types")
    ]);
    const customers = customersResponse.ok ? (await readJson<Page<CustomerOption>>(customersResponse)).items : [];
    const serviceTypes = serviceTypesResponse.ok
      ? (await readJson<ServiceTypesResponse>(serviceTypesResponse)).serviceTypes
      : [];
    if (!response.ok) return { projects: emptyPage, preference, customers, serviceTypes, loadError: true };
    return { projects: await readJson<ProjectsPage>(response), preference, customers, serviceTypes, loadError: false };
  } catch {
    return { projects: emptyPage, preference: defaultPreference, customers: [], serviceTypes: [], loadError: true };
  }
}

export default async function ProjectsPage({
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
  if (!featureEnabled("projects_and_time")) notFound();
  await requireSession(locale);

  const t = getDictionary(locale);
  const labels = getProjectsDictionary(locale);
  const query = await searchParams;

  const sort: ProjectSort = sorts.includes(query.sort as ProjectSort) ? (query.sort as ProjectSort) : "created_desc";
  const search = new URLSearchParams({ sort });
  if (/^\d+$/.test(query.page ?? "")) search.set("page", query.page!);
  if ([10, 25, 50, 100].includes(Number(query.pageSize))) search.set("pageSize", query.pageSize!);
  if (query.search) search.set("search", query.search.trim().slice(0, 160));
  if (query.status) search.set("status", query.status);
  if (query.customerId) search.set("customerId", query.customerId);

  const data = await load(search);

  return (
    <div className="app-shell">
      <AppSidebar locale={locale} labels={t.navigation} />
      <div className="workspace">
        <PageTopbar
          eyebrow={labels.eyebrow}
          title={labels.title}
          description={labels.description}
          themeLabel={t.header.theme}
          back={{ label: t.header.back, fallbackHref: `/${locale}` }}
          actions={<InstantSearch placeholder={labels.searchPlaceholder} resetParams={["page"]} />}
        />
        <main className="compact-main">
          <ProjectsWorkspace
            projects={data.projects}
            preference={data.preference}
            customers={data.customers}
            serviceTypes={data.serviceTypes}
            loadError={data.loadError}
            labels={labels}
            locale={locale}
            sort={sort}
          />
        </main>
      </div>
    </div>
  );
}

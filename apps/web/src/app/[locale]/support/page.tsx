import { getDictionary, getSupportDictionary, isLocale } from "@control-hub/i18n";
import { notFound } from "next/navigation";
import { AppSidebar } from "@/components/app-sidebar";
import { InstantSearch } from "@/components/instant-search";
import { PageTopbar } from "@/components/page-topbar";
import { SupportInbox } from "@/components/support-inbox";
import { apiFetch, readJson } from "@/lib/api";
import type { CustomerOption, InboxPage, Page, TablePreference, TablePreferenceResponse } from "@/lib/api-types";
import { requireSession } from "@/lib/require-session";

const sorts = ["opened_desc", "opened_asc", "priority_desc", "updated_desc"] as const;
type SupportSort = (typeof sorts)[number];

const defaultPreference: TablePreference = {
  tableId: "support.tickets",
  columnOrder: [],
  hiddenColumns: [],
  columnWidths: {},
  pageSize: 25
};

const emptyPage: InboxPage = { items: [], total: 0, page: 1, pageSize: 25 };

async function load(search: URLSearchParams) {
  try {
    const preferenceResponse = await apiFetch("/api/v1/table-preferences/support.tickets");
    const preference = preferenceResponse.ok
      ? (await readJson<TablePreferenceResponse>(preferenceResponse)).preference
      : defaultPreference;

    if (!search.has("pageSize")) search.set("pageSize", String(preference.pageSize));
    const [response, customersResponse] = await Promise.all([
      apiFetch(`/api/v1/support/tickets?${search}`),
      apiFetch("/api/v1/crm/customers?page=1&pageSize=100&sort=name_asc")
    ]);
    const customers = customersResponse.ok ? (await readJson<Page<CustomerOption>>(customersResponse)).items : [];
    if (!response.ok) return { tickets: emptyPage, preference, customers, loadError: true };
    return { tickets: await readJson<InboxPage>(response), preference, customers, loadError: false };
  } catch {
    return { tickets: emptyPage, preference: defaultPreference, customers: [], loadError: true };
  }
}

export default async function SupportPage({
  params,
  searchParams
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  await requireSession(locale);

  const t = getDictionary(locale);
  const labels = getSupportDictionary(locale);
  const query = await searchParams;

  const sort: SupportSort = sorts.includes(query.sort as SupportSort) ? (query.sort as SupportSort) : "opened_desc";
  const search = new URLSearchParams({ sort });
  if (/^\d+$/.test(query.page ?? "")) search.set("page", query.page!);
  if ([10, 25, 50, 100].includes(Number(query.pageSize))) search.set("pageSize", query.pageSize!);
  if (query.search) search.set("search", query.search.trim().slice(0, 160));
  if (query.status) search.set("status", query.status);
  if (query.priority) search.set("priority", query.priority);

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
          <SupportInbox
            tickets={data.tickets}
            preference={data.preference}
            customers={data.customers}
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

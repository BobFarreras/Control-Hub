import { getCrmDetailDictionary, getDictionary, isLocale } from "@control-hub/i18n";
import { notFound } from "next/navigation";
import { AppSidebar } from "@/components/app-sidebar";
import { CrmWorkspace } from "@/components/crm-workspace";
import { PageTopbar } from "@/components/page-topbar";
import { apiFetch, readJson } from "@/lib/api";
import type { CrmSummary, CustomerRow, LeadRow, Page, TablePreference, TablePreferenceResponse } from "@/lib/api-types";
import { requireSession } from "@/lib/require-session";

const emptySummary: CrmSummary = { leadsByStatus: {}, activeCustomers: 0, openTasks: 0, overdueTasks: 0 };
const defaultPreference = (tableId: string): TablePreference => ({
  tableId,
  columnOrder: [],
  hiddenColumns: [],
  columnWidths: {},
  pageSize: 25
});
type CrmData = {
  leads: Page<LeadRow>;
  customers: Page<CustomerRow>;
  leadPreference: TablePreference;
  customerPreference: TablePreference;
  summary: CrmSummary;
  loadError: boolean;
};
type CrmSort =
  | "updated_desc"
  | "created_asc"
  | "created_desc"
  | "name_asc"
  | "name_desc"
  | "company_asc"
  | "company_desc"
  | "priority_asc"
  | "priority_desc";
type CrmQuery = {
  search: string;
  leadPage: number;
  customerPage: number;
  leadPageSize?: number;
  customerPageSize?: number;
  leadSort: CrmSort;
  customerSort: CrmSort;
  leadStatus?: string;
  leadPriority?: string;
};
async function getCrmData(query: CrmQuery): Promise<CrmData> {
  try {
    const [leadPreferenceResponse, customerPreferenceResponse] = await Promise.all([
      apiFetch("/api/v1/table-preferences/crm.leads"),
      apiFetch("/api/v1/table-preferences/crm.customers")
    ]);
    const leadPreference = leadPreferenceResponse.ok
      ? (await readJson<TablePreferenceResponse>(leadPreferenceResponse)).preference
      : defaultPreference("crm.leads");
    const customerPreference = customerPreferenceResponse.ok
      ? (await readJson<TablePreferenceResponse>(customerPreferenceResponse)).preference
      : defaultPreference("crm.customers");
    const leadQuery = new URLSearchParams({
      page: String(query.leadPage),
      pageSize: String(query.leadPageSize ?? leadPreference.pageSize),
      sort: query.leadSort
    });
    const customerQuery = new URLSearchParams({
      page: String(query.customerPage),
      pageSize: String(query.customerPageSize ?? customerPreference.pageSize),
      sort: query.customerSort
    });
    if (query.search) {
      leadQuery.set("search", query.search);
      customerQuery.set("search", query.search);
    }
    if (query.leadStatus) leadQuery.set("status", query.leadStatus);
    if (query.leadPriority) leadQuery.set("priority", query.leadPriority);
    const [leads, customers, summary] = await Promise.all([
      apiFetch(`/api/v1/crm/leads?${leadQuery}`),
      apiFetch(`/api/v1/crm/customers?${customerQuery}`),
      apiFetch("/api/v1/crm/summary")
    ]);
    if (!leads.ok || !customers.ok || !summary.ok)
      return {
        leads: { items: [], total: 0, page: 1, pageSize: leadPreference.pageSize },
        customers: { items: [], total: 0, page: 1, pageSize: customerPreference.pageSize },
        leadPreference,
        customerPreference,
        summary: emptySummary,
        loadError: true
      };
    return {
      leads: await readJson<Page<LeadRow>>(leads),
      customers: await readJson<Page<CustomerRow>>(customers),
      leadPreference,
      customerPreference,
      summary: await readJson<CrmSummary>(summary),
      loadError: false
    };
  } catch {
    return {
      leads: { items: [], total: 0, page: 1, pageSize: 25 },
      customers: { items: [], total: 0, page: 1, pageSize: 25 },
      leadPreference: defaultPreference("crm.leads"),
      customerPreference: defaultPreference("crm.customers"),
      summary: emptySummary,
      loadError: true
    };
  }
}

export default async function CrmPage({
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
  const labels = { ...t.crm, ...getCrmDetailDictionary(locale) };
  const paramsQuery = await searchParams;
  const integer = (value: string | undefined, fallback: number) =>
    /^\d+$/.test(value ?? "") ? Number(value) : fallback;
  const sorts: CrmSort[] = [
    "updated_desc",
    "created_asc",
    "created_desc",
    "name_asc",
    "name_desc",
    "company_asc",
    "company_desc",
    "priority_asc",
    "priority_desc"
  ];
  const sort = (value: string | undefined): CrmSort =>
    sorts.includes(value as CrmSort) ? (value as CrmSort) : "updated_desc";
  const pageSize = (value: string | undefined) =>
    [10, 25, 50, 100].includes(integer(value, 0)) ? integer(value, 25) : undefined;
  const leadPageSize = pageSize(paramsQuery.leadPageSize);
  const customerPageSize = pageSize(paramsQuery.customerPageSize);
  const leadStatuses = ["new", "contacted", "qualified", "proposal", "won", "lost"];
  const priorities = ["low", "normal", "high", "urgent"];
  const leadStatus =
    paramsQuery.leadStatus && leadStatuses.includes(paramsQuery.leadStatus) ? paramsQuery.leadStatus : undefined;
  const leadPriority =
    paramsQuery.leadPriority && priorities.includes(paramsQuery.leadPriority) ? paramsQuery.leadPriority : undefined;
  const data = await getCrmData({
    search: paramsQuery.search?.trim().slice(0, 160) ?? "",
    leadPage: integer(paramsQuery.leadPage, 1),
    customerPage: integer(paramsQuery.customerPage, 1),
    ...(leadPageSize ? { leadPageSize } : {}),
    ...(customerPageSize ? { customerPageSize } : {}),
    ...(leadStatus ? { leadStatus } : {}),
    ...(leadPriority ? { leadPriority } : {}),
    leadSort: sort(paramsQuery.leadSort),
    customerSort: sort(paramsQuery.customerSort)
  });
  return (
    <div className="app-shell">
      <AppSidebar locale={locale} labels={t.navigation} />
      <div className="workspace">
        <PageTopbar
          eyebrow={t.crm.eyebrow}
          title={t.crm.title}
          description={t.crm.description}
          themeLabel={t.header.theme}
          back={{ label: t.header.back, fallbackHref: `/${locale}` }}
        />
        <main className="crm-main">
          <CrmWorkspace
            {...data}
            leadSort={sort(paramsQuery.leadSort)}
            customerSort={sort(paramsQuery.customerSort)}
            labels={labels}
            locale={locale}
          />
        </main>
      </div>
    </div>
  );
}

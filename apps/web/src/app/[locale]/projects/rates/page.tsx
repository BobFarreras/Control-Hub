import { getDictionary, getRatesDictionary, isLocale } from "@control-hub/i18n";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AppSidebar } from "@/components/app-sidebar";
import { PageTopbar } from "@/components/page-topbar";
import { RatesWorkspace } from "@/components/rates-workspace";
import { apiFetch, readJson } from "@/lib/api";
import type {
  CustomerOption,
  MembersResponse,
  Page,
  ProjectsPage,
  RatesResponse,
  ServiceTypesResponse
} from "@/lib/api-types";
import { featureEnabled } from "@/lib/features";
import { requireSession } from "@/lib/require-session";

/**
 * Everything the screen needs, and nothing it cannot have.
 *
 * A member without `financials:read` gets a 403 from `/api/v1/rates` and lands on the empty state
 * rather than on a screen that renders hourly costs it then hides. The publish forms would fail
 * against `rates:manage` anyway, which is the API's job to enforce and not this page's to guess.
 */
async function load() {
  const [rates, members, customers, projects, serviceTypes] = await Promise.all([
    apiFetch("/api/v1/rates"),
    apiFetch("/api/v1/members"),
    apiFetch("/api/v1/crm/customers?page=1&pageSize=100&sort=name_asc"),
    apiFetch("/api/v1/projects?page=1&pageSize=100&sort=name_asc"),
    apiFetch("/api/v1/service-types")
  ]);

  return {
    rates: rates.ok ? await readJson<RatesResponse>(rates) : { cost: [], billing: [] },
    members: members.ok ? (await readJson<MembersResponse>(members)).members : [],
    customers: customers.ok ? (await readJson<Page<CustomerOption>>(customers)).items : [],
    projects: projects.ok ? (await readJson<ProjectsPage>(projects)).items : [],
    serviceTypes: serviceTypes.ok ? (await readJson<ServiceTypesResponse>(serviceTypes)).serviceTypes : [],
    loadError: !rates.ok
  };
}

export default async function RatesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  if (!featureEnabled("projects_and_time")) notFound();
  await requireSession(locale);

  const t = getDictionary(locale);
  const labels = getRatesDictionary(locale);
  const data = await load();

  return (
    <div className="app-shell">
      <AppSidebar locale={locale} labels={t.navigation} />
      <div className="workspace">
        <PageTopbar
          eyebrow={labels.eyebrow}
          title={labels.title}
          description={labels.description}
          themeLabel={t.header.theme}
          // The append-only rule explains both tables and is the reason they read as a log rather
          // than as settings. Too long to hover over, so it opens on click instead of costing two
          // rows of the page for good.
          help={{
            label: labels.whyLog,
            title: labels.whyLog,
            body: labels.appendOnlyNote,
            closeLabel: t.crm.cancel
          }}
          actions={
            <Link className="secondary-button" href={`/${locale}/projects`}>
              <ArrowLeft size={17} />
              {getDictionary(locale).navigation.projects}
            </Link>
          }
        />
        <main className="compact-main">
          <RatesWorkspace
            cost={data.rates.cost}
            billing={data.rates.billing}
            members={data.members}
            customers={data.customers}
            projects={data.projects}
            serviceTypes={data.serviceTypes}
            loadError={data.loadError}
            labels={labels}
            locale={locale}
          />
        </main>
      </div>
    </div>
  );
}

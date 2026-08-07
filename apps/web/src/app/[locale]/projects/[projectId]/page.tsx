import { getDictionary, getProjectsDictionary, isLocale } from "@control-hub/i18n";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AppSidebar } from "@/components/app-sidebar";
import { PageTopbar } from "@/components/page-topbar";
import { ProjectDetail } from "@/components/project-detail";
import { apiFetch, readJson } from "@/lib/api";
import type {
  Profitability,
  ProfitabilityResponse,
  ProjectDetail as ProjectDetailData,
  ServiceTypesResponse,
  TimeEntriesPage
} from "@/lib/api-types";
import { featureEnabled } from "@/lib/features";
import { requireSession } from "@/lib/require-session";

/**
 * The financial block is left out by the server, not hidden by the client.
 *
 * A member without `financials:read` gets a 403 from the profitability route, and the numbers
 * simply never reach the page. Rendering them and hiding them with CSS would put an hourly cost
 * in the HTML of somebody who is not allowed to know it.
 */
async function loadProject(projectId: string) {
  const [detailResponse, entriesResponse, profitabilityResponse, serviceTypesResponse] = await Promise.all([
    apiFetch(`/api/v1/projects/${projectId}`),
    apiFetch(`/api/v1/time-entries?projectId=${projectId}&pageSize=100&sort=spent_desc`),
    apiFetch(`/api/v1/projects/${projectId}/profitability`),
    apiFetch("/api/v1/service-types")
  ]);
  if (detailResponse.status === 404) notFound();
  if (!detailResponse.ok) throw new Error("PROJECT_LOAD_ERROR");

  const entries = entriesResponse.ok
    ? await readJson<TimeEntriesPage>(entriesResponse)
    : { items: [], total: 0, page: 1, pageSize: 25 as const };
  const profitability: Profitability | null = profitabilityResponse.ok
    ? (await readJson<ProfitabilityResponse>(profitabilityResponse)).profitability
    : null;

  const serviceTypes = serviceTypesResponse.ok
    ? (await readJson<ServiceTypesResponse>(serviceTypesResponse)).serviceTypes
    : [];

  return { detail: await readJson<ProjectDetailData>(detailResponse), entries, profitability, serviceTypes };
}

export default async function ProjectPage({ params }: { params: Promise<{ locale: string; projectId: string }> }) {
  const { locale, projectId } = await params;
  if (!isLocale(locale) || !/^[0-9a-f-]{36}$/i.test(projectId)) notFound();
  if (!featureEnabled("projects_and_time")) notFound();
  await requireSession(locale);

  const t = getDictionary(locale);
  const labels = getProjectsDictionary(locale);
  const { detail, entries, profitability, serviceTypes } = await loadProject(projectId);

  return (
    <div className="app-shell">
      <AppSidebar locale={locale} labels={t.navigation} />
      <div className="workspace">
        <PageTopbar
          eyebrow={labels.eyebrow}
          title={detail.project.name}
          description={detail.project.customerName}
          themeLabel={t.header.theme}
          actions={
            <Link className="secondary-button" href={`/${locale}/projects`}>
              <ArrowLeft size={17} />
              {labels.backToProjects}
            </Link>
          }
        />
        <main className="compact-main">
          <ProjectDetail
            detail={detail}
            entries={entries.items}
            profitability={profitability}
            serviceTypes={serviceTypes}
            labels={labels}
            locale={locale}
          />
        </main>
      </div>
    </div>
  );
}

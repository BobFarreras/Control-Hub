import { getDictionary, getExpenseDictionary, getMetricHelpDictionary, isLocale } from "@control-hub/i18n";
import { notFound } from "next/navigation";
import { AppSidebar } from "@/components/app-sidebar";
import { CompanySubscriptionsWorkspace } from "@/components/company-subscriptions-workspace";
import { PageTopbar } from "@/components/page-topbar";
import { apiFetch, readJson } from "@/lib/api";
import type { CompanySubscription, CompanySubscriptionsResponse } from "@/lib/api-types";
import { requireSession } from "@/lib/require-session";

type ExpensesData = { subscriptions: CompanySubscription[]; loadError: boolean; renderedAt: number };

async function load(): Promise<ExpensesData> {
  // Captured with the data, not while rendering, so the server markup and the first client
  // render compare renewal dates against the same instant.
  const renderedAt = Date.now();
  try {
    const response = await apiFetch("/api/v1/company-subscriptions");
    if (!response.ok) return { subscriptions: [], loadError: true, renderedAt };
    const payload = await readJson<CompanySubscriptionsResponse>(response);
    return { subscriptions: payload.subscriptions, loadError: false, renderedAt };
  } catch {
    return { subscriptions: [], loadError: true, renderedAt };
  }
}
export default async function CompanySubscriptionsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  await requireSession(locale);
  const t = getDictionary(locale);
  const labels = { ...getExpenseDictionary(locale), ...getMetricHelpDictionary(locale) };
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
        />
        <main className="compact-main">
          <CompanySubscriptionsWorkspace {...data} labels={labels} locale={locale} />
        </main>
      </div>
    </div>
  );
}

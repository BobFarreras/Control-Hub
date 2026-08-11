import {
  getCrmDetailDictionary,
  getDictionary,
  getExpenseDictionary,
  getMetricHelpDictionary,
  isLocale
} from "@control-hub/i18n";
import { notFound } from "next/navigation";
import { AppSidebar } from "@/components/app-sidebar";
import { CompanySubscriptionsWorkspace } from "@/components/company-subscriptions-workspace";
import { PageTopbar } from "@/components/page-topbar";
import { loadCompanySubscriptions, type CompanySubscriptionQuery } from "@/lib/company-subscriptions-data";
import { requireSession } from "@/lib/require-session";

export default async function CompanySubscriptionsPage({
  params,
  searchParams
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<CompanySubscriptionQuery>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  await requireSession(locale);
  const t = getDictionary(locale);
  const labels = {
    ...t.crm,
    ...getCrmDetailDictionary(locale),
    ...getExpenseDictionary(locale),
    ...getMetricHelpDictionary(locale)
  };
  const data = await loadCompanySubscriptions(await searchParams);
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
        />
        <main className="compact-main">
          <CompanySubscriptionsWorkspace {...data} labels={labels} locale={locale} />
        </main>
      </div>
    </div>
  );
}

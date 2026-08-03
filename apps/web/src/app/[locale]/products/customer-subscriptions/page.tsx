import { notFound } from "next/navigation";
import { getCommerceDictionary, getDictionary, getMetricHelpDictionary, isLocale } from "@control-hub/i18n";
import { AppSidebar } from "@/components/app-sidebar";
import { CommerceWorkspace } from "@/components/commerce-workspace";
import { PageTopbar } from "@/components/page-topbar";
import { getCommerceData } from "@/lib/commerce-data";
import { requireSession } from "@/lib/require-session";

export default async function CustomerSubscriptionsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  await requireSession(locale);
  const t = getDictionary(locale);
  const labels = { ...getCommerceDictionary(locale), ...getMetricHelpDictionary(locale) };
  const data = await getCommerceData();
  return (
    <div className="app-shell">
      <AppSidebar locale={locale} labels={t.navigation} />
      <div className="workspace">
        <PageTopbar
          eyebrow={labels.eyebrow}
          title={t.navigation.customerSubscriptions}
          description={labels.description}
          themeLabel={t.header.theme}
        />
        <main className="compact-main">
          <CommerceWorkspace {...data} labels={labels} locale={locale} view="subscriptions" />
        </main>
      </div>
    </div>
  );
}

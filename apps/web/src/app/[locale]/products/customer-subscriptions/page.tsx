import { getCommerceDictionary, getDictionary, isLocale } from "@control-hub/i18n";
import { notFound } from "next/navigation";
import { AppSidebar } from "@/components/app-sidebar";
import { CustomerServicesWorkspace } from "@/components/customer-services-workspace";
import { PageTopbar } from "@/components/page-topbar";
import { getCustomerServicesData, type CustomerServiceSearch } from "@/lib/customer-services-data";
import { requireSession } from "@/lib/require-session";

export default async function CustomerSubscriptionsPage({
  params,
  searchParams
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<CustomerServiceSearch>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  await requireSession(locale);
  const t = getDictionary(locale);
  const labels = getCommerceDictionary(locale);
  const filters = await searchParams;
  const data = await getCustomerServicesData(filters);
  return (
    <div className="app-shell">
      <AppSidebar locale={locale} labels={t.navigation} />
      <div className="workspace">
        <PageTopbar
          eyebrow={labels.eyebrow}
          title={labels.customerServices}
          description={labels.customerServicesDescription}
          themeLabel={t.header.theme}
          back={{ label: t.header.back, fallbackHref: `/${locale}/products` }}
        />
        <main className="compact-main">
          <CustomerServicesWorkspace {...data} labels={labels} locale={locale} />
        </main>
      </div>
    </div>
  );
}

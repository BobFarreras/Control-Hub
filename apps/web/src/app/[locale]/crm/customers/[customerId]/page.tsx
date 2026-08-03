import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getCrmDetailDictionary, getDictionary, isLocale } from "@control-hub/i18n";
import { CustomerDetail } from "@/components/customer-detail";
import { AppSidebar } from "@/components/app-sidebar";
import { PageTopbar } from "@/components/page-topbar";
import { apiFetch } from "@/lib/api";
import { requireSession } from "@/lib/require-session";

async function loadCustomer(customerId: string) {
  const response = await apiFetch(`/api/v1/crm/customers/${customerId}`);
  if (response.status === 404) notFound();
  if (!response.ok) throw new Error("CRM_LOAD_ERROR");
  return (await response.json()).customer;
}

export default async function CustomerPage({ params }: { params: Promise<{ locale: string; customerId: string }> }) {
  const { locale, customerId } = await params;
  if (!isLocale(locale) || !/^[0-9a-f-]{36}$/i.test(customerId)) notFound();
  await requireSession(locale);
  const customer = await loadCustomer(customerId);
  const common = getDictionary(locale);
  const labels = { ...common.crm, ...getCrmDetailDictionary(locale) };
  return (
    <div className="app-shell">
      <AppSidebar locale={locale} labels={common.navigation} />
      <div className="workspace">
        <PageTopbar
          eyebrow={common.crm.customers}
          title={customer.displayName}
          description={customer.billingEmail ?? customer.phone ?? "--"}
          themeLabel={common.header.theme}
          actions={
            <>
              <span className="state state-active">{customer.status}</span>
              <Link className="secondary-button" href={`/${locale}/crm`}>
                <ArrowLeft size={17} />
                {labels.back}
              </Link>
            </>
          }
        />
        <main className="customer-page compact-main">
          <CustomerDetail customer={customer} labels={labels} locale={locale} />
        </main>
      </div>
    </div>
  );
}

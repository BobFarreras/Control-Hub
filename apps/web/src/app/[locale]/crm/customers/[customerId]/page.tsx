import { ArrowLeft, Building2 } from "lucide-react";
import { cookies } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getCrmDetailDictionary, getDictionary, isLocale } from "@control-hub/i18n";
import { CustomerDetail } from "@/components/customer-detail";
import { requireSession } from "@/lib/require-session";

async function loadCustomer(customerId: string) { const store = await cookies(); const cookie = store.getAll().map(({ name, value }) => `${name}=${value}`).join("; "); const api = process.env.API_INTERNAL_URL ?? "http://127.0.0.1:4000"; const response = await fetch(`${api}/api/v1/crm/customers/${customerId}`, { headers: { cookie }, cache: "no-store" }); if (response.status === 404) notFound(); if (!response.ok) throw new Error("CRM_LOAD_ERROR"); return (await response.json()).customer; }

export default async function CustomerPage({ params }: { params: Promise<{ locale: string; customerId: string }> }) {
  const { locale, customerId } = await params; if (!isLocale(locale) || !/^[0-9a-f-]{36}$/i.test(customerId)) notFound(); await requireSession(locale); const customer = await loadCustomer(customerId); const common = getDictionary(locale); const labels = { ...common.crm, ...getCrmDetailDictionary(locale) };
  return <main className="customer-page"><Link className="text-link back-link" href={`/${locale}/crm`}><ArrowLeft size={17} />{labels.back}</Link><header className="customer-header"><span className="customer-avatar"><Building2 size={24} /></span><div><p>{common.crm.customers}</p><h1>{customer.displayName}</h1><span>{customer.billingEmail ?? customer.phone ?? "--"}</span></div><span className="state state-active">{customer.status}</span></header><CustomerDetail customer={customer} labels={labels} locale={locale} /></main>;
}

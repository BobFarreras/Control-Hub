import { notFound } from "next/navigation";
import { getDictionary, getExpenseDictionary, getMetricHelpDictionary, isLocale } from "@control-hub/i18n";
import { AppSidebar } from "@/components/app-sidebar";
import { CompanySubscriptionsWorkspace } from "@/components/company-subscriptions-workspace";
import { PageTopbar } from "@/components/page-topbar";
import { apiFetch } from "@/lib/api";
import { requireSession } from "@/lib/require-session";

async function load() { try { const response = await apiFetch("/api/v1/company-subscriptions"); if (!response.ok) return { subscriptions: [], loadError: true }; return { subscriptions: (await response.json()).subscriptions, loadError: false }; } catch { return { subscriptions: [], loadError: true }; } }
export default async function CompanySubscriptionsPage({ params }: { params: Promise<{ locale: string }> }) { const { locale } = await params; if (!isLocale(locale)) notFound(); await requireSession(locale); const t = getDictionary(locale); const labels = { ...getExpenseDictionary(locale), ...getMetricHelpDictionary(locale) }; const data = await load(); return <div className="app-shell"><AppSidebar locale={locale} labels={t.navigation} /><div className="workspace"><PageTopbar eyebrow={labels.eyebrow} title={labels.title} description={labels.description} themeLabel={t.header.theme} /><main className="compact-main"><CompanySubscriptionsWorkspace {...data} labels={labels} locale={locale} /></main></div></div>; }

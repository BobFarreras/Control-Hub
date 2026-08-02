import { Bell, Boxes, CircleDollarSign, CloudCog, Command, Headphones, LayoutDashboard, Package, Settings, Users } from "lucide-react";
import { cookies } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getCrmDetailDictionary, getDictionary, isLocale } from "@control-hub/i18n";
import { CrmWorkspace } from "@/components/crm-workspace";
import { ThemeToggle } from "@/components/theme-toggle";
import { requireSession } from "@/lib/require-session";

const emptySummary = { leadsByStatus: {}, activeCustomers: 0, openTasks: 0, overdueTasks: 0 };
async function getCrmData(search: string) {
  const cookieStore = await cookies(); const cookie = cookieStore.getAll().map(({ name, value }) => `${name}=${value}`).join("; "); const api = process.env.API_INTERNAL_URL ?? "http://127.0.0.1:4000";
  try {
    const query = new URLSearchParams({ pageSize: "100" }); if (search) query.set("search", search);
    const headers = { cookie }; const options = { headers, cache: "no-store" as const };
    const [leads, customers, summary] = await Promise.all([fetch(`${api}/api/v1/crm/leads?${query}`, options), fetch(`${api}/api/v1/crm/customers?${query}`, options), fetch(`${api}/api/v1/crm/summary`, options)]);
    if (!leads.ok || !customers.ok || !summary.ok) return { leads: [], customers: [], summary: emptySummary, loadError: true };
    return { leads: (await leads.json()).items, customers: (await customers.json()).items, summary: await summary.json(), loadError: false };
  } catch { return { leads: [], customers: [], summary: emptySummary, loadError: true }; }
}

export default async function CrmPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ search?: string }> }) {
  const { locale } = await params; if (!isLocale(locale)) notFound(); await requireSession(locale);
  const t = getDictionary(locale); const labels = { ...t.crm, ...getCrmDetailDictionary(locale) }; const query = await searchParams; const data = await getCrmData(query.search?.trim().slice(0, 160) ?? "");
  const nav = [[t.navigation.dashboard, LayoutDashboard, `/${locale}`], [t.navigation.customers, Users, `/${locale}/crm`], [t.navigation.products, Package, `/${locale}/commerce`], [t.navigation.subscriptions, CircleDollarSign, `/${locale}/commerce`], [t.navigation.support, Headphones, "#"], [t.navigation.infrastructure, CloudCog, "#"], [t.navigation.integrations, Boxes, "#"], [t.navigation.settings, Settings, `/${locale}/security`]] as const;
  return <div className="app-shell"><aside className="sidebar"><div className="brand"><span className="brand-mark"><Command size={22} /></span><span><strong>Control Hub</strong><small>BUSINESS OPERATIONS</small></span></div><nav aria-label={t.navigation.label}>{nav.map(([label, Icon, href], index) => <Link className={index === 1 ? "nav-item active" : "nav-item"} href={href} key={label}><Icon size={19} /><span>{label}</span></Link>)}</nav></aside><div className="workspace"><header className="topbar"><div /><div className="top-actions"><button className="icon-button" aria-label="Notifications"><Bell size={18} /></button><ThemeToggle label={t.header.theme} /></div></header><main><section className="page-heading"><div><p>{t.crm.eyebrow}</p><h1>{t.crm.title}</h1><span>{t.crm.description}</span></div></section><CrmWorkspace {...data} labels={labels} locale={locale} /></main></div></div>;
}

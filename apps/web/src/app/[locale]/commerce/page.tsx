import { Bell, Boxes, CircleDollarSign, CloudCog, Command, Headphones, LayoutDashboard, Package, Settings, Users } from "lucide-react";
import { cookies } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getCommerceDictionary, getDictionary, isLocale } from "@control-hub/i18n";
import { CommerceWorkspace } from "@/components/commerce-workspace";
import { ThemeToggle } from "@/components/theme-toggle";
import { requireSession } from "@/lib/require-session";

const empty = { catalog: { products: [], versions: [], plans: [], prices: [] }, subscriptions: [], metrics: [], alerts: [], customers: [], loadError: true };
async function getCommerceData() {
  const cookieStore = await cookies(); const cookie = cookieStore.getAll().map(({ name, value }) => `${name}=${value}`).join("; "); const api = process.env.API_INTERNAL_URL ?? "http://127.0.0.1:4000"; const options = { headers: { cookie }, cache: "no-store" as const };
  try {
    const responses = await Promise.all([fetch(`${api}/api/v1/commerce/catalog`, options), fetch(`${api}/api/v1/commerce/subscriptions`, options), fetch(`${api}/api/v1/commerce/financial-summary`, options), fetch(`${api}/api/v1/commerce/renewal-alerts`, options), fetch(`${api}/api/v1/crm/customers?page=1&pageSize=100&sort=name_asc`, options)]);
    if (responses.some((response) => !response.ok)) return empty;
    const [catalog, subscriptions, metrics, alerts, customers] = await Promise.all(responses.map((response) => response.json()));
    return { catalog, subscriptions: subscriptions.subscriptions, metrics: metrics.metrics, alerts: alerts.alerts, customers: customers.items, loadError: false };
  } catch { return empty; }
}

export default async function CommercePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params; if (!isLocale(locale)) notFound(); await requireSession(locale); const t = getDictionary(locale); const labels = getCommerceDictionary(locale); const data = await getCommerceData();
  const nav = [[t.navigation.dashboard, LayoutDashboard, `/${locale}`], [t.navigation.customers, Users, `/${locale}/crm`], [t.navigation.products, Package, `/${locale}/commerce`], [t.navigation.subscriptions, CircleDollarSign, `/${locale}/commerce`], [t.navigation.support, Headphones, "#"], [t.navigation.infrastructure, CloudCog, "#"], [t.navigation.integrations, Boxes, "#"], [t.navigation.settings, Settings, `/${locale}/security`]] as const;
  return <div className="app-shell"><aside className="sidebar"><div className="brand"><span className="brand-mark"><Command size={22} /></span><span><strong>Control Hub</strong><small>BUSINESS OPERATIONS</small></span></div><nav aria-label={t.navigation.label}>{nav.map(([label, Icon, href], index) => <Link className={index === 2 || index === 3 ? "nav-item active" : "nav-item"} href={href} key={`${label}-${index}`}><Icon size={19} /><span>{label}</span></Link>)}</nav></aside><div className="workspace"><header className="topbar"><div /><div className="top-actions"><button className="icon-button" aria-label="Notifications"><Bell size={18} /></button><ThemeToggle label={t.header.theme} /></div></header><main><section className="page-heading"><div><p>{labels.eyebrow}</p><h1>{labels.title}</h1><span>{labels.description}</span></div></section><CommerceWorkspace {...data} labels={labels} locale={locale} /></main></div></div>;
}

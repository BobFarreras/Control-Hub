import { Activity, Bell, Boxes, Building2, CircleDollarSign, CloudCog, Command, Gauge, Headphones, LayoutDashboard, Package, Search, Settings, ShieldCheck, TicketCheck, Users } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDictionary, isLocale, locales } from "@control-hub/i18n";
import { ThemeToggle } from "@/components/theme-toggle";
import { requireSession } from "@/lib/require-session";

export function generateStaticParams() { return locales.map((locale) => ({ locale })); }

export default async function DashboardPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: localeParam } = await params;
  if (!isLocale(localeParam)) notFound();
  await requireSession(localeParam);
  const t = getDictionary(localeParam);
  const nav = [
    [t.navigation.dashboard, LayoutDashboard], [t.navigation.customers, Users], [t.navigation.products, Package],
    [t.navigation.subscriptions, CircleDollarSign], [t.navigation.support, Headphones], [t.navigation.infrastructure, CloudCog],
    [t.navigation.integrations, Boxes], [t.navigation.settings, Settings]
  ] as const;
  const metrics = [
    [t.dashboard.revenue, "--", Activity], [t.dashboard.customers, "--", Building2],
    [t.dashboard.incidents, "0", TicketCheck], [t.dashboard.automations, "--", Command]
  ] as const;

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark"><Command size={22} /></span><span><strong>Control Hub</strong><small>BUSINESS OPERATIONS</small></span></div>
      <nav aria-label={t.navigation.label}>{nav.map(([label, Icon], index) => <Link className={index === 0 ? "nav-item active" : "nav-item"} href={index === 1 ? `/${localeParam}/crm` : index === nav.length - 1 ? `/${localeParam}/security` : "#"} key={label}><Icon size={19} /><span>{label}</span></Link>)}</nav>
      <div className="sidebar-footer"><ShieldCheck size={18} /><span>{t.dashboard.ready}</span></div>
    </aside>
    <div className="workspace">
      <header className="topbar">
        <label className="search"><Search size={18} /><span className="sr-only">{t.header.search}</span><input placeholder={t.header.search} /></label>
        <div className="top-actions"><span className="health"><i />{t.header.healthy}</span><div className="locale-switch" aria-label={t.header.language}>{locales.map((locale) => <Link className={locale === localeParam ? "selected" : ""} href={`/${locale}`} key={locale}>{locale.toUpperCase()}</Link>)}</div><button className="icon-button" aria-label="Notifications" title="Notifications"><Bell size={18} /></button><ThemeToggle label={t.header.theme} /></div>
      </header>
      <main>
        <section className="page-heading"><div><p>{t.dashboard.eyebrow}</p><h1>{t.dashboard.title}</h1><span>{t.dashboard.description}</span></div><div className="status-badge"><Gauge size={18} /><span>{t.dashboard.ready}</span></div></section>
        <section className="metric-grid" aria-label="Metrics">{metrics.map(([label, value, Icon]) => <article className="metric" key={label}><div className="metric-icon"><Icon size={19} /></div><span>{label}</span><strong>{value}</strong><small>--</small></article>)}</section>
        <section className="dashboard-grid">
          <article className="health-panel"><div className="panel-heading"><div><p>CONTROL HUB</p><h2>{t.dashboard.companyHealth}</h2></div><span className="live"><i /> LIVE</span></div><div className="radar" aria-hidden="true"><div className="radar-ring ring-one" /><div className="radar-ring ring-two" /><div className="radar-core"><ShieldCheck size={26} /></div></div><p className="empty-copy">{t.dashboard.noData}</p></article>
          <section className="activity-panel"><div className="panel-heading"><div><p>SYSTEM</p><h2>{t.dashboard.activity}</h2></div><Activity size={20} /></div><div className="activity-row"><span className="activity-icon"><ShieldCheck size={18} /></span><div><strong>{t.dashboard.ready}</strong><small>Repository, CI, security and architecture</small></div><time>NOW</time></div><div className="activity-row muted"><span className="activity-icon"><Boxes size={18} /></span><div><strong>{t.navigation.integrations}</strong><small>{t.dashboard.noData}</small></div><time>--</time></div></section>
        </section>
      </main>
    </div>
  </div>;
}

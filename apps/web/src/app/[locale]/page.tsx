import { Activity, Boxes, Building2, Command, ShieldCheck, TicketCheck } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDictionary, isLocale, locales } from "@control-hub/i18n";
import { AppSidebar } from "@/components/app-sidebar";
import { PageTopbar } from "@/components/page-topbar";
import { requireSession } from "@/lib/require-session";

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export default async function DashboardPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: localeParam } = await params;
  if (!isLocale(localeParam)) notFound();
  await requireSession(localeParam);
  const t = getDictionary(localeParam);
  const metrics = [
    [t.dashboard.revenue, "--", Activity],
    [t.dashboard.customers, "--", Building2],
    [t.dashboard.incidents, "0", TicketCheck],
    [t.dashboard.automations, "--", Command]
  ] as const;

  return (
    <div className="app-shell">
      <AppSidebar locale={localeParam} labels={t.navigation} ready={t.dashboard.ready} />
      <div className="workspace">
        <PageTopbar
          eyebrow={t.dashboard.eyebrow}
          title={t.dashboard.title}
          description={t.dashboard.description}
          themeLabel={t.header.theme}
          actions={
            <>
              <span className="health">
                <i />
                {t.header.healthy}
              </span>
              <div className="locale-switch" aria-label={t.header.language}>
                {locales.map((locale) => (
                  <Link className={locale === localeParam ? "selected" : ""} href={`/${locale}`} key={locale}>
                    {locale.toUpperCase()}
                  </Link>
                ))}
              </div>
            </>
          }
        />
        <main className="compact-main">
          <section className="dashboard-metrics" aria-label="Metrics">
            {metrics.map(([label, value, Icon]) => (
              <article key={label}>
                <div className="metric-icon">
                  <Icon size={17} />
                </div>
                <span>{label}</span>
                <strong>{value}</strong>
              </article>
            ))}
          </section>
          <section className="dashboard-grid">
            <article className="health-panel">
              <div className="panel-heading">
                <div>
                  <p>CONTROL HUB</p>
                  <h2>{t.dashboard.companyHealth}</h2>
                </div>
                <span className="live">
                  <i /> LIVE
                </span>
              </div>
              <div className="radar" aria-hidden="true">
                <div className="radar-ring ring-one" />
                <div className="radar-ring ring-two" />
                <div className="radar-core">
                  <ShieldCheck size={26} />
                </div>
              </div>
              <p className="empty-copy">{t.dashboard.noData}</p>
            </article>
            <section className="activity-panel">
              <div className="panel-heading">
                <div>
                  <p>SYSTEM</p>
                  <h2>{t.dashboard.activity}</h2>
                </div>
                <Activity size={20} />
              </div>
              <div className="activity-row">
                <span className="activity-icon">
                  <ShieldCheck size={18} />
                </span>
                <div>
                  <strong>{t.dashboard.ready}</strong>
                  <small>Repository, CI, security and architecture</small>
                </div>
                <time>NOW</time>
              </div>
              <div className="activity-row muted">
                <span className="activity-icon">
                  <Boxes size={18} />
                </span>
                <div>
                  <strong>{t.navigation.integrations}</strong>
                  <small>{t.dashboard.noData}</small>
                </div>
                <time>--</time>
              </div>
            </section>
          </section>
        </main>
      </div>
    </div>
  );
}

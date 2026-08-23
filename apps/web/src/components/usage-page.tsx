import { getDictionary, getUsageDictionary, isLocale } from "@control-hub/i18n";
import { notFound } from "next/navigation";
import { AppSidebar } from "@/components/app-sidebar";
import { PageTopbar } from "@/components/page-topbar";
import { UsageWorkspace } from "@/components/usage-workspace";
import { featureEnabled } from "@/lib/features";
import { requireSession } from "@/lib/require-session";
import { loadUsage } from "@/lib/usage-data";

export async function UsagePage({ locale, mode }: { locale: string; mode: "overview" | "costs" | "budgets" }) {
  if (!isLocale(locale) || !featureEnabled("usage_costs")) notFound();
  await requireSession(locale);
  const t = getDictionary(locale);
  const labels = getUsageDictionary(locale);
  const tableId = mode === "overview" ? "usage.events" : mode === "costs" ? "usage.costs" : "usage.budgets";
  const data = await loadUsage(tableId);
  return (
    <div className="app-shell">
      <AppSidebar locale={locale} labels={t.navigation} />
      <div className="workspace">
        <PageTopbar
          eyebrow={labels.eyebrow}
          title={labels[`${mode}Title`]}
          description={labels[`${mode}Description`]}
          themeLabel={t.header.theme}
        />
        <main className="compact-main">
          <UsageWorkspace mode={mode} locale={locale} labels={labels} {...data} />
        </main>
      </div>
    </div>
  );
}

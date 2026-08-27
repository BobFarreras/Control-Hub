"use client";

import { getDictionary, getMcpDictionary, isLocale } from "@control-hub/i18n";
import { useParams } from "next/navigation";
import { AppSidebar } from "@/components/app-sidebar";
import { PageTopbar } from "@/components/page-topbar";
import { McpAgents } from "./mcp-agents";

/**
 * The agents screen, on its own route rather than as a third of the security page.
 *
 * Connecting an assistant and enrolling a second factor are separate jobs done by the same person
 * on different days, and stacking them made the security page a place where you scroll past what
 * you did not come for. This screen draws nothing at all when the API says the surface is not
 * mounted or not this reader's to administer -- the decision is `McpAgents`'s, taken from the
 * first listing, so the empty state here is genuinely empty rather than a page saying "no".
 */
export default function McpPage() {
  const localeParam = String(useParams().locale);
  const locale = isLocale(localeParam) ? localeParam : "ca";
  const t = getDictionary(locale);
  const words = getMcpDictionary(locale);

  return (
    <div className="app-shell">
      <AppSidebar locale={locale} labels={t.navigation} />
      <div className="workspace">
        <PageTopbar
          eyebrow="CONTROL HUB"
          title={words.pageTitle}
          description={words.pageDescription}
          themeLabel={t.header.theme}
          back={{ label: t.header.back, fallbackHref: `/${locale}` }}
        />
        <main className="security-page">
          <section className="security-grid">
            <McpAgents locale={locale} />
          </section>
        </main>
      </div>
    </div>
  );
}

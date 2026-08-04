import { getDictionary, getSupportDictionary, isLocale } from "@control-hub/i18n";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AppSidebar } from "@/components/app-sidebar";
import { PageTopbar } from "@/components/page-topbar";
import { TicketDetail } from "@/components/ticket-detail";
import { apiFetch, readJson } from "@/lib/api";
import type { TicketDetail as TicketDetailData } from "@/lib/api-types";
import { requireSession } from "@/lib/require-session";

async function loadTicket(ticketId: string): Promise<TicketDetailData> {
  const response = await apiFetch(`/api/v1/support/tickets/${ticketId}`);
  if (response.status === 404) notFound();
  if (!response.ok) throw new Error("SUPPORT_LOAD_ERROR");
  return readJson<TicketDetailData>(response);
}

export default async function TicketPage({ params }: { params: Promise<{ locale: string; ticketId: string }> }) {
  const { locale, ticketId } = await params;
  if (!isLocale(locale) || !/^[0-9a-f-]{36}$/i.test(ticketId)) notFound();
  await requireSession(locale);

  const t = getDictionary(locale);
  const labels = getSupportDictionary(locale);
  const detail = await loadTicket(ticketId);

  return (
    <div className="app-shell">
      <AppSidebar locale={locale} labels={t.navigation} />
      <div className="workspace">
        <PageTopbar
          eyebrow={labels.eyebrow}
          title={`#${detail.ticket.ticketNumber}`}
          description={detail.ticket.subject}
          themeLabel={t.header.theme}
          actions={
            <Link className="secondary-button" href={`/${locale}/support`}>
              <ArrowLeft size={17} />
              {labels.backToInbox}
            </Link>
          }
        />
        <main className="compact-main">
          <TicketDetail detail={detail} labels={labels} locale={locale} />
        </main>
      </div>
    </div>
  );
}

import { getDictionary, getSupportDictionary, isLocale } from "@control-hub/i18n";
import { notFound } from "next/navigation";
import { AppSidebar } from "@/components/app-sidebar";
import { PageTopbar } from "@/components/page-topbar";
import { TicketDetail } from "@/components/ticket-detail";
import { apiFetch, loadFailure, readJson } from "@/lib/api";
import type {
  ConnectorCatalogueResponse,
  IntegrationsResponse,
  TicketDetail as TicketDetailData
} from "@/lib/api-types";
import { requireSession } from "@/lib/require-session";

async function loadTicket(ticketId: string): Promise<TicketDetailData> {
  const response = await apiFetch(`/api/v1/support/tickets/${ticketId}`);
  if (response.status === 404) notFound();
  if (!response.ok) throw await loadFailure("SUPPORT_LOAD_ERROR", response);
  return readJson<TicketDetailData>(response);
}

async function loadOutboundMail() {
  const [instancesResponse, catalogueResponse] = await Promise.all([
    apiFetch("/api/v1/integrations"),
    apiFetch("/api/v1/integrations/catalogue")
  ]);
  if (!instancesResponse.ok || !catalogueResponse.ok) return [];
  const [{ integrations }, catalogue] = await Promise.all([
    readJson<IntegrationsResponse>(instancesResponse),
    readJson<ConnectorCatalogueResponse>(catalogueResponse)
  ]);
  const outboundTypes = new Set(
    catalogue.connectors.filter((entry) => entry.capabilities.actions?.includes("send_mail")).map((entry) => entry.type)
  );
  return integrations
    .filter((instance) => instance.status === "enabled" && outboundTypes.has(instance.connectorType))
    .map((instance) => ({ id: instance.id, name: instance.name }));
}

export default async function TicketPage({ params }: { params: Promise<{ locale: string; ticketId: string }> }) {
  const { locale, ticketId } = await params;
  if (!isLocale(locale) || !/^[0-9a-f-]{36}$/i.test(ticketId)) notFound();
  await requireSession(locale);

  const t = getDictionary(locale);
  const labels = getSupportDictionary(locale);
  const [detail, outboundMail] = await Promise.all([loadTicket(ticketId), loadOutboundMail()]);

  return (
    <div className="app-shell">
      <AppSidebar locale={locale} labels={t.navigation} />
      <div className="workspace">
        <PageTopbar
          eyebrow={labels.eyebrow}
          title={`#${detail.ticket.ticketNumber}`}
          description={detail.ticket.subject}
          themeLabel={t.header.theme}
          back={{ label: t.header.back, fallbackHref: `/${locale}/support` }}
        />
        <main className="compact-main">
          <TicketDetail detail={detail} labels={labels} locale={locale} outboundMail={outboundMail} />
        </main>
      </div>
    </div>
  );
}

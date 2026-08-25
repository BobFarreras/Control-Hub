import { getDictionary, getSupportMailboxDictionary, isLocale } from "@control-hub/i18n";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AppSidebar } from "@/components/app-sidebar";
import { InstantSearch } from "@/components/instant-search";
import { PageTopbar } from "@/components/page-topbar";
import { SupportMailbox } from "@/components/support-mailbox";
import { apiFetch, readJson } from "@/lib/api";
import type { CustomerOption, InboundMessagePage, MailboxTicketOption, Page } from "@/lib/api-types";
import { requireSession } from "@/lib/require-session";

export default async function MailPage({
  params,
  searchParams
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ status?: string; search?: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  await requireSession(locale);
  const query = await searchParams;
  const status = ["pending", "classified", "discarded"].includes(query.status ?? "") ? query.status! : "pending";
  const search = new URLSearchParams({ status, pageSize: "100" });
  if (query.search) search.set("search", query.search.slice(0, 160));
  const [mailResponse, customersResponse, ticketsResponse] = await Promise.all([
    apiFetch(`/api/v1/support/mailbox?${search}`),
    apiFetch("/api/v1/crm/customers?page=1&pageSize=100&sort=name_asc"),
    apiFetch("/api/v1/support/mailbox/tickets")
  ]);
  const t = getDictionary(locale);
  const labels = getSupportMailboxDictionary(locale);
  const mail = mailResponse.ok
    ? await readJson<InboundMessagePage>(mailResponse)
    : { items: [], total: 0, page: 1, pageSize: 25 };
  const customers = customersResponse.ok ? (await readJson<Page<CustomerOption>>(customersResponse)).items : [];
  const tickets = ticketsResponse.ok
    ? (await readJson<{ tickets: MailboxTicketOption[] }>(ticketsResponse)).tickets
    : [];
  return (
    <div className="app-shell">
      <AppSidebar locale={locale} labels={t.navigation} />
      <div className="workspace">
        <PageTopbar
          eyebrow={labels.eyebrow}
          title={labels.title}
          description={labels.description}
          themeLabel={t.header.theme}
          back={{ label: t.header.back, fallbackHref: `/${locale}/support` }}
          actions={<InstantSearch placeholder={labels.search} resetParams={["page"]} />}
        />
        <main className="compact-main">
          <nav className="mailbox-tabs" aria-label={labels.title}>
            {(["pending", "classified", "discarded"] as const).map((value) => (
              <Link
                className={status === value ? "active" : ""}
                href={`/${locale}/support/mail?status=${value}`}
                key={value}
              >
                {labels[value]}
              </Link>
            ))}
          </nav>
          {!mailResponse.ok && (
            <p className="form-error" role="alert">
              {labels.loadError}
            </p>
          )}
          <SupportMailbox
            messages={mail.items}
            customers={customers}
            tickets={tickets}
            labels={labels}
            locale={locale}
          />
        </main>
      </div>
    </div>
  );
}

import { getAttendanceDictionary, getDictionary, isLocale } from "@control-hub/i18n";
import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AppSidebar } from "@/components/app-sidebar";
import { AttendanceRecord } from "@/components/attendance-record";
import { PageTopbar } from "@/components/page-topbar";
import { apiFetch, readJson } from "@/lib/api";
import type { AttendanceMonth } from "@/lib/api-types";
import { featureEnabled } from "@/lib/features";
import { requireSession } from "@/lib/require-session";

const emptyMonth: AttendanceMonth = { membershipId: "", days: [], sessions: [], totalMinutes: 0, events: [] };

/**
 * The first and last day of a month, as the local days the API compares against.
 *
 * Built from the parts rather than from an instant, because a month boundary turned into UTC
 * lands in the previous month for anybody east of Greenwich, and this record is counted in local
 * days from end to end.
 */
function monthRange(value: string | undefined): { from: string; to: string; month: string } {
  const now = new Date();
  const matched = /^(\d{4})-(\d{2})$/.exec(value ?? "");
  const year = matched ? Number(matched[1]) : now.getFullYear();
  const month = matched ? Number(matched[2]) : now.getMonth() + 1;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    from: `${year}-${pad(month)}-01`,
    to: `${year}-${pad(month)}-${pad(lastDay)}`,
    month: `${year}-${pad(month)}`
  };
}

/** The month before or after this one, as `YYYY-MM`, carried across a year boundary. */
function shiftMonth(month: string, by: number): string {
  const [year, index] = month.split("-").map(Number);
  const moved = new Date(Date.UTC(year!, index! - 1 + by, 1));
  return `${moved.getUTCFullYear()}-${String(moved.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthName(month: string, locale: string): string {
  const [year, index] = month.split("-").map(Number);
  // Midday, so the label cannot slip into the previous month in a zone behind UTC.
  return new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(
    new Date(Date.UTC(year!, index! - 1, 1, 12))
  );
}

export default async function AttendancePage({
  params,
  searchParams
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  // The flag decides whether the module is deployed at all. Without it the API serves no such
  // route, and a screen rendering an empty month over a 404 would be a lie.
  if (!featureEnabled("attendance")) notFound();
  await requireSession(locale);

  const t = getDictionary(locale);
  const labels = getAttendanceDictionary(locale);
  const range = monthRange((await searchParams).month);

  let month = emptyMonth;
  try {
    const response = await apiFetch(`/api/v1/attendance/summary?from=${range.from}&to=${range.to}`);
    if (response.ok) month = await readJson<AttendanceMonth>(response);
  } catch {
    // Left empty rather than failing the page: the record is read far more often than it is
    // written, and a screen that says nothing is better than one that will not open.
  }

  return (
    <div className="app-shell">
      <AppSidebar locale={locale} labels={t.navigation} />
      <div className="workspace">
        <PageTopbar
          eyebrow={labels.eyebrow}
          title={labels.title}
          description={labels.description}
          themeLabel={t.header.theme}
          help={{
            label: labels.help,
            title: labels.help,
            body: labels.helpBody,
            closeLabel: labels.cancel
          }}
          /*
            Links rather than buttons, so a month can be shared, bookmarked and opened in a new
            tab. The accountancy asks for "March" far more often than for "this month".
          */
          actions={
            <nav className="month-nav" aria-label={labels.title}>
              <Link className="secondary-button" href={`/${locale}/attendance?month=${shiftMonth(range.month, -1)}`}>
                <ChevronLeft size={16} aria-hidden="true" />
                {labels.monthPrevious}
              </Link>
              <strong className="month-current">{monthName(range.month, locale)}</strong>
              <Link className="secondary-button" href={`/${locale}/attendance?month=${shiftMonth(range.month, 1)}`}>
                {labels.monthNext}
                <ChevronRight size={16} aria-hidden="true" />
              </Link>
            </nav>
          }
        />
        <main className="compact-main">
          <AttendanceRecord month={month} labels={labels} locale={locale} />
        </main>
      </div>
    </div>
  );
}

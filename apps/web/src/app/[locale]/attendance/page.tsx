import { getAttendanceDictionary, getDictionary, isLocale } from "@control-hub/i18n";
import { notFound } from "next/navigation";
import { AppSidebar } from "@/components/app-sidebar";
import { AttendanceRecord } from "@/components/attendance-record";
import { PageTopbar } from "@/components/page-topbar";
import { apiFetch, readJson } from "@/lib/api";
import type { AttendanceMonth } from "@/lib/api-types";
import { featureEnabled } from "@/lib/features";
import { formatHours } from "@/lib/format";
import { requireSession } from "@/lib/require-session";
import { monthRange } from "./month-range";

const emptyMonth: AttendanceMonth = {
  membershipId: "",
  memberName: "",
  days: [],
  sessions: [],
  totalMinutes: 0,
  events: []
};

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
  const query = await searchParams;
  const range = monthRange(query.month);
  const view = query.view === "records" || query.view === "table" ? "records" : "calendar";

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
          actions={
            <div className="attendance-topbar-total">
              <span>{labels.total}</span>
              <strong>{formatHours(month.totalMinutes)}</strong>
            </div>
          }
        />
        <main className="compact-main">
          <AttendanceRecord month={month} labels={labels} locale={locale} range={range} view={view} />
        </main>
      </div>
    </div>
  );
}

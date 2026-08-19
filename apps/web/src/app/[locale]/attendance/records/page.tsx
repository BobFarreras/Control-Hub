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
import { monthRange } from "../month-range";

const emptyMonth: AttendanceMonth = {
  membershipId: "",
  memberName: "",
  days: [],
  sessions: [],
  totalMinutes: 0,
  events: []
};

export default async function AttendanceRecordsPage({
  params,
  searchParams
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
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
    // The stable empty state is more useful than turning a read-only report into a fatal page.
  }

  return (
    <div className="app-shell">
      <AppSidebar locale={locale} labels={t.navigation} />
      <div className="workspace">
        <PageTopbar
          eyebrow={labels.eyebrow}
          title={labels.recordsTitle}
          description={labels.recordsDescription}
          themeLabel={t.header.theme}
          back={{ label: t.header.back, fallbackHref: `/${locale}/attendance` }}
          actions={
            <div className="attendance-topbar-total">
              <span>{labels.total}</span>
              <strong>{formatHours(month.totalMinutes)}</strong>
            </div>
          }
        />
        <main className="compact-main">
          <AttendanceRecord month={month} labels={labels} locale={locale} range={range} view="records" />
        </main>
      </div>
    </div>
  );
}

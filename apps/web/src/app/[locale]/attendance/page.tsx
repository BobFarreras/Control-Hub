import { getAttendanceDictionary, getDictionary, isLocale } from "@control-hub/i18n";
import { notFound } from "next/navigation";
import { AppSidebar } from "@/components/app-sidebar";
import { AttendanceOverview } from "@/components/attendance-overview";
import { PageTopbar } from "@/components/page-topbar";
import { apiFetch, readJson } from "@/lib/api";
import type { AttendanceAbsence, AttendanceHoliday, AttendanceMonth, AttendanceVacation } from "@/lib/api-types";
import { featureEnabled } from "@/lib/features";
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

export default async function AttendancePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  if (!featureEnabled("attendance")) notFound();
  await requireSession(locale);
  const t = getDictionary(locale);
  const labels = getAttendanceDictionary(locale);
  const range = monthRange(undefined);
  let month = emptyMonth;
  let holidays: AttendanceHoliday[] = [];
  let vacations: AttendanceVacation[] = [];
  let absences: AttendanceAbsence[] = [];

  try {
    const summary = await apiFetch(`/api/v1/attendance/summary?from=${range.from}&to=${range.to}`);
    if (summary.ok) month = await readJson<AttendanceMonth>(summary);
    if (month.membershipId) {
      const memberRange = `from=${range.from}&to=${range.to}&membershipId=${month.membershipId}`;
      const [holidayResponse, vacationResponse, absenceResponse] = await Promise.all([
        apiFetch(`/api/v1/attendance/holidays?from=${range.from}&to=${range.to}`),
        apiFetch(`/api/v1/attendance/vacations?${memberRange}`),
        apiFetch(`/api/v1/attendance/absences?${memberRange}`)
      ]);
      if (holidayResponse.ok) holidays = (await readJson<{ holidays: AttendanceHoliday[] }>(holidayResponse)).holidays;
      if (vacationResponse.ok)
        vacations = (await readJson<{ vacations: AttendanceVacation[] }>(vacationResponse)).vacations;
      if (absenceResponse.ok) absences = (await readJson<{ absences: AttendanceAbsence[] }>(absenceResponse)).absences;
    }
  } catch {
    // The overview keeps stable empty states when a read model is temporarily unavailable.
  }

  const today = new Date().toLocaleDateString("en-CA");
  return (
    <div className="app-shell">
      <AppSidebar locale={locale} labels={t.navigation} />
      <div className="workspace">
        <PageTopbar
          eyebrow={labels.eyebrow}
          title={labels.overviewTitle}
          description={labels.overviewDescription}
          themeLabel={t.header.theme}
          back={{ label: t.header.back, fallbackHref: `/${locale}` }}
          showClock={false}
        />
        <main className="compact-main">
          <AttendanceOverview
            month={month}
            holidays={holidays}
            vacations={vacations}
            absences={absences}
            labels={labels}
            locale={locale}
            today={today}
          />
        </main>
      </div>
    </div>
  );
}

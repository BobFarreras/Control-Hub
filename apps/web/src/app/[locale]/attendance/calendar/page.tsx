import { getAttendanceDictionary, getDictionary, isLocale } from "@control-hub/i18n";
import { notFound } from "next/navigation";
import { AppSidebar } from "@/components/app-sidebar";
import { AttendanceYearCalendar } from "@/components/attendance-year-calendar";
import { PageTopbar } from "@/components/page-topbar";
import { apiFetch, readJson } from "@/lib/api";
import type { AttendanceAbsence, AttendanceHoliday, AttendanceMonth, AttendanceVacation } from "@/lib/api-types";
import { featureEnabled } from "@/lib/features";
import { requireSession } from "@/lib/require-session";
import { attendanceYear, yearRange } from "../year-range";

const emptyMonth: AttendanceMonth = {
  membershipId: "",
  memberName: "",
  days: [],
  sessions: [],
  totalMinutes: 0,
  events: []
};

export default async function AttendanceCalendarPage({
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
  const range = yearRange(attendanceYear((await searchParams).year));
  let month = emptyMonth;
  let holidays: AttendanceHoliday[] = [];
  let vacations: AttendanceVacation[] = [];
  let absences: AttendanceAbsence[] = [];

  try {
    const response = await apiFetch(`/api/v1/attendance/summary?from=${range.from}&to=${range.to}`);
    if (response.ok) month = await readJson<AttendanceMonth>(response);
    if (month.membershipId) {
      const query = `from=${range.from}&to=${range.to}&membershipId=${month.membershipId}`;
      const [holidayResponse, vacationResponse, absenceResponse] = await Promise.all([
        apiFetch(`/api/v1/attendance/holidays?from=${range.from}&to=${range.to}`),
        apiFetch(`/api/v1/attendance/vacations?${query}`),
        apiFetch(`/api/v1/attendance/absences?${query}`)
      ]);
      if (holidayResponse.ok) holidays = (await readJson<{ holidays: AttendanceHoliday[] }>(holidayResponse)).holidays;
      if (vacationResponse.ok)
        vacations = (await readJson<{ vacations: AttendanceVacation[] }>(vacationResponse)).vacations;
      if (absenceResponse.ok) absences = (await readJson<{ absences: AttendanceAbsence[] }>(absenceResponse)).absences;
    }
  } catch {
    // Each collection has an explicit empty state; no stale or fabricated calendar data is shown.
  }

  return (
    <div className="app-shell">
      <AppSidebar locale={locale} labels={t.navigation} />
      <div className="workspace">
        <PageTopbar
          eyebrow={labels.eyebrow}
          title={labels.calendarTitle}
          description={labels.calendarDescription}
          themeLabel={t.header.theme}
          back={{ label: t.header.back, fallbackHref: `/${locale}/attendance` }}
        />
        <main className="compact-main">
          <AttendanceYearCalendar
            year={range.year}
            month={month}
            holidays={holidays}
            vacations={vacations}
            absences={absences}
            labels={labels}
            locale={locale}
          />
        </main>
      </div>
    </div>
  );
}

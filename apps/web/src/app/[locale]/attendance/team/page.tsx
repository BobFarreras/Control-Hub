import { getAttendanceDictionary, getDictionary, isLocale } from "@control-hub/i18n";
import { notFound } from "next/navigation";
import { AppSidebar } from "@/components/app-sidebar";
import { AttendancePendingRequests } from "@/components/attendance-pending-requests";
import { AttendanceTeam } from "@/components/attendance-team";
import { PageTopbar } from "@/components/page-topbar";
import { apiFetch, readJson } from "@/lib/api";
import type { AttendanceTeamResponse, AttendanceTeamRow, AttendanceVacation, AttendanceAbsence } from "@/lib/api-types";
import { featureEnabled } from "@/lib/features";
import { requireSession } from "@/lib/require-session";
import { monthRange } from "../month-range";

/**
 * Everybody's hours, for the export the accountancy reads and the reconciliation the owner does.
 *
 * The two live on one screen because they are the same table with two more columns, and because
 * the question "how many hours did we work" and "how many did we bill" are only useful next to
 * each other. They are never added together.
 */
export default async function AttendanceTeamPage({
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
  const query = `from=${range.from}&to=${range.to}`;

  /**
   * The reconciliation is asked for first because it is the same rows with the money on them.
   * Somebody who manages the record but may not see cost gets the plain table instead: the
   * figures never reach their browser, rather than reaching it and being hidden.
   */
  let rows: AttendanceTeamRow[] = [];
  let reconciled = false;
  let pendingVacations: AttendanceVacation[] = [];
  let pendingAbsences: AttendanceAbsence[] = [];

  try {
    const withCost = await apiFetch(`/api/v1/attendance/reconciliation?${query}`);
    if (withCost.ok) {
      rows = (await readJson<AttendanceTeamResponse>(withCost)).members;
      reconciled = true;
    } else {
      const plain = await apiFetch(`/api/v1/attendance?${query}`);
      // A 403 here means this person may not read anybody else's record. Not found is the honest
      // answer: for them this screen does not exist.
      if (plain.status === 403) notFound();
      if (plain.ok) rows = (await readJson<AttendanceTeamResponse>(plain)).members;
    }
  } catch {
    // Left empty rather than failing the page, as everywhere else in the product.
  }

  // Fetch pending requests for admins
  try {
    const [vacRes, absRes] = await Promise.all([
      apiFetch(`/api/v1/attendance/vacations?${query}`),
      apiFetch(`/api/v1/attendance/absences?${query}`)
    ]);
    if (vacRes.ok) {
      const data = await readJson<{ vacations: AttendanceVacation[] }>(vacRes);
      pendingVacations = data.vacations.filter((v) => v.status === "pending");
    }
    if (absRes.ok) {
      const data = await readJson<{ absences: AttendanceAbsence[] }>(absRes);
      pendingAbsences = data.absences.filter((absence) => absence.status === "pending");
    }
  } catch {
    // Non-critical: pending requests are a convenience, not a requirement.
  }

  const memberNames = new Map(rows.map((r) => [r.membershipId, r.memberName]));

  return (
    <div className="app-shell">
      <AppSidebar locale={locale} labels={t.navigation} />
      <div className="workspace">
        <PageTopbar
          eyebrow={labels.eyebrow}
          title={labels.teamTitle}
          description={labels.teamDescription}
          themeLabel={t.header.theme}
          back={{ label: t.header.back, fallbackHref: `/${locale}/attendance` }}
        />
        <main className="compact-main">
          <AttendancePendingRequests
            vacations={pendingVacations}
            absences={pendingAbsences}
            memberNames={memberNames}
            labels={labels}
            locale={locale}
          />
          <AttendanceTeam rows={rows} range={range} reconciled={reconciled} labels={labels} locale={locale} />
        </main>
      </div>
    </div>
  );
}

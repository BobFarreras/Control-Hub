"use client";

import { Check, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useToast } from "@/components/toast";
import type { AttendanceVacation, AttendanceAbsence } from "@/lib/api-types";

type Labels = Record<string, string>;

export function AttendancePendingRequests({
  vacations,
  absences,
  memberNames,
  labels: t,
  locale
}: {
  vacations: AttendanceVacation[];
  absences: AttendanceAbsence[];
  memberNames: Map<string, string>;
  labels: Labels;
  locale: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  const dateFmt = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" });

  async function approveVacation(id: string) {
    setBusy(true);
    const res = await fetch("/api/v1/attendance/vacations", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ vacationId: id, status: "approved" })
    });
    setBusy(false);
    if (!res.ok) return toast("error", t.failed!);
    toast("success", t.vacationApproved!);
    router.refresh();
  }

  async function rejectVacation(id: string) {
    setBusy(true);
    const res = await fetch("/api/v1/attendance/vacations", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ vacationId: id, status: "rejected" })
    });
    setBusy(false);
    if (!res.ok) return toast("error", t.failed!);
    toast("success", t.vacationRejected!);
    router.refresh();
  }

  async function deleteAbsence(id: string) {
    if (!confirm(t.confirmCancel!)) return;
    setBusy(true);
    const res = await fetch(`/api/v1/attendance/absences/${id}`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) return toast("error", t.failed!);
    toast("success", t.absenceCancelled!);
    router.refresh();
  }

  if (vacations.length === 0 && absences.length === 0) return null;

  return (
    <section className="project-panel" aria-label={t.pendingRequests}>
      <h3>{t.pendingRequests}</h3>
      <div className="crm-table-wrap inside-panel">
        <table className="crm-table">
          <thead>
            <tr>
              <th>{t.person}</th>
              <th>{t.type}</th>
              <th>{t.from}</th>
              <th>{t.to}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {vacations.map((v) => (
              <tr key={v.id}>
                <td>{memberNames.get(v.membershipId) ?? v.membershipId}</td>
                <td>{t.vacation}</td>
                <td>{dateFmt.format(new Date(v.startDate + "T12:00:00"))}</td>
                <td>{dateFmt.format(new Date(v.endDate + "T12:00:00"))}</td>
                <td className="pending-actions">
                  <button
                    className="icon-button"
                    disabled={busy}
                    onClick={() => void approveVacation(v.id)}
                    aria-label={t.approve}
                  >
                    <Check size={16} />
                  </button>
                  <button
                    className="icon-button"
                    disabled={busy}
                    onClick={() => void rejectVacation(v.id)}
                    aria-label={t.reject}
                  >
                    <X size={16} />
                  </button>
                </td>
              </tr>
            ))}
            {absences.map((a) => (
              <tr key={a.id}>
                <td>{memberNames.get(a.membershipId) ?? a.membershipId}</td>
                <td>{t.absence}</td>
                <td>{dateFmt.format(new Date(a.startDate + "T12:00:00"))}</td>
                <td>{dateFmt.format(new Date(a.endDate + "T12:00:00"))}</td>
                <td className="pending-actions">
                  <button
                    className="icon-button"
                    disabled={busy}
                    onClick={() => void deleteAbsence(a.id)}
                    aria-label={t.cancel}
                  >
                    <X size={16} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

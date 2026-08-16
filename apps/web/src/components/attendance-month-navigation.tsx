import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";

const shiftMonth = (month: string, by: number) => {
  const [year, index] = month.split("-").map(Number);
  const moved = new Date(Date.UTC(year!, index! - 1 + by, 1));
  return `${moved.getUTCFullYear()}-${String(moved.getUTCMonth() + 1).padStart(2, "0")}`;
};

export function AttendanceMonthNavigation({
  month,
  locale,
  href,
  previousLabel,
  nextLabel
}: {
  month: string;
  locale: string;
  href: (month: string) => string;
  previousLabel: string;
  nextLabel: string;
}) {
  const [year, index] = month.split("-").map(Number);
  const label = new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(
    new Date(Date.UTC(year!, index! - 1, 1, 12))
  );
  return (
    <nav className="attendance-month-control" aria-label={label}>
      <Link className="attendance-month-arrow" href={href(shiftMonth(month, -1))} aria-label={previousLabel}>
        <ChevronLeft size={16} aria-hidden="true" />
      </Link>
      <strong>{label}</strong>
      <Link className="attendance-month-arrow" href={href(shiftMonth(month, 1))} aria-label={nextLabel}>
        <ChevronRight size={16} aria-hidden="true" />
      </Link>
    </nav>
  );
}

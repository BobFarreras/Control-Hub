import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { MetricHelp } from "@/components/metric-help";

/**
 * One figure, read at a glance.
 *
 * The value uses the mono face so a column of figures lines up digit by digit, which is what
 * makes a set of them scannable rather than four numbers in a row. `tone` is for a value that
 * means something on its own, such as a negative margin; it is applied alongside a sign or a
 * word, never as the only difference.
 */
export function MetricTile({
  label,
  value,
  help,
  icon: Icon,
  tone,
  footnote
}: {
  label: string;
  value: ReactNode;
  // `| undefined` on every optional prop: the repository compiles with
  // `exactOptionalPropertyTypes`, so a caller spreading a maybe-absent value would not type without it.
  help?: string | undefined;
  icon?: LucideIcon | undefined;
  tone?: "positive" | "negative" | undefined;
  footnote?: ReactNode | undefined;
}) {
  return (
    <article className="metric-tile">
      <header>
        {Icon && <Icon size={15} aria-hidden="true" />}
        {help ? <MetricHelp label={label} description={help} /> : <span>{label}</span>}
      </header>
      <strong className={tone ? `metric-value ${tone}` : "metric-value"}>{value}</strong>
      {footnote && <small>{footnote}</small>}
    </article>
  );
}

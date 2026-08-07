import { Ban, CircleCheck, CircleDashed, CircleDot, PackageCheck, PauseCircle, type LucideIcon } from "lucide-react";

/**
 * The visual tone a state carries. Never the only carrier: every pill also shows an icon and the
 * word, so the meaning survives a greyscale screen, a printout and anyone who cannot separate red
 * from green. `DESIGN_SYSTEM.md` requires it and it is the easiest rule in the document to break
 * by accident.
 */
export type StatusTone = "neutral" | "active" | "warning" | "done" | "closed" | "danger";

const icons: Record<StatusTone, LucideIcon> = {
  neutral: CircleDashed,
  active: CircleDot,
  warning: PauseCircle,
  done: PackageCheck,
  closed: CircleCheck,
  danger: Ban
};

export function StatusPill({ tone, label }: { tone: StatusTone; label: string }) {
  const Icon = icons[tone];
  return (
    <span className={`status-pill tone-${tone}`}>
      <Icon size={14} aria-hidden="true" />
      {label}
    </span>
  );
}

/** The tone of each project status, in one place so the listing and the page cannot disagree. */
export const projectStatusTone: Record<string, StatusTone> = {
  draft: "neutral",
  active: "active",
  on_hold: "warning",
  delivered: "done",
  closed: "closed",
  canceled: "danger"
};

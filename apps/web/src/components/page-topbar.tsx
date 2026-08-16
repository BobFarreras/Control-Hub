import { Bell } from "lucide-react";
import { ClockButton } from "@/components/clock-button";
import { HelpDialog } from "@/components/help";
import { NavigationBackButton } from "@/components/navigation-back-button";
import { ThemeToggle } from "@/components/theme-toggle";

export function PageTopbar({
  eyebrow,
  title,
  description,
  themeLabel,
  actions,
  help,
  back
}: {
  eyebrow: string;
  title: string;
  description?: string | undefined;
  themeLabel: string;
  actions?: React.ReactNode;
  back?: { label: string; fallbackHref: string } | undefined;
  /**
   * An explanation of how the screen behaves, behind a `?` beside the title.
   *
   * A paragraph is too long to hover over and too valuable to delete, so it opens in a dialog on
   * click rather than living permanently in the layout where it would cost two rows of the page.
   */
  help?: { label: string; title: string; body: string; closeLabel: string } | undefined;
}) {
  return (
    <header className="topbar">
      {back ? <NavigationBackButton {...back} /> : <NavigationBackButton label="" fallbackHref="/" hidden />}
      <div className="topbar-page-title">
        <p>{eyebrow}</p>
        <div>
          <h1>{title}</h1>
          {help && <HelpDialog {...help} />}
          {description && <span>{description}</span>}
        </div>
      </div>
      <div className="top-actions">
        {actions}
        {/*
          Here rather than on each page: clocking in has to be reachable from wherever somebody
          happens to be, and a control that only exists on one screen is one people forget. It
          renders nothing at all while the `attendance` flag is off, and nothing while the state
          is unknown, so no page has to know it exists.
        */}
        <ClockButton />
        <button className="icon-button" aria-label="Notifications" title="Notifications">
          <Bell size={18} />
        </button>
        <ThemeToggle label={themeLabel} />
      </div>
    </header>
  );
}

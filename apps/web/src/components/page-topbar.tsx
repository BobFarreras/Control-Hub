import { Bell } from "lucide-react";
import { ClockButton } from "@/components/clock-button";
import { HelpDialog } from "@/components/help";
import { NavigationBackButton } from "@/components/navigation-back-button";
import { ThemeToggle } from "@/components/theme-toggle";
import { UpdateBanner } from "@/components/update-banner";

export function PageTopbar({
  eyebrow,
  title,
  description,
  themeLabel,
  actions,
  help,
  back,
  showClock = true
}: {
  eyebrow: string;
  title: string;
  description?: string | undefined;
  themeLabel: string;
  actions?: React.ReactNode;
  back?: { label: string; fallbackHref: string } | undefined;
  showClock?: boolean | undefined;
  /**
   * An explanation of how the screen behaves, behind a `?` beside the title.
   *
   * A paragraph is too long to hover over and too valuable to delete, so it opens in a dialog on
   * click rather than living permanently in the layout where it would cost two rows of the page.
   */
  help?: { label: string; title: string; body: string; closeLabel: string } | undefined;
}) {
  return (
    <>
      {/*
        Above the topbar of every screen rather than on the settings page, because a notice you
        have to go and look for is one nobody looks for. It renders nothing at all when there is
        no update, when nobody has checked, and for anybody who is not Owner or Administrator --
        the API decides that last one, not this -- so no page has to know it exists.
      */}
      <UpdateBanner />
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
          {showClock && <ClockButton />}
          <button className="icon-button" aria-label="Notifications" title="Notifications">
            <Bell size={18} />
          </button>
          <ThemeToggle label={themeLabel} />
        </div>
      </header>
    </>
  );
}

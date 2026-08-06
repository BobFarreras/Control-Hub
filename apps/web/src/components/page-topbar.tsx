import { Bell } from "lucide-react";
import { HelpDialog } from "@/components/help";
import { ThemeToggle } from "@/components/theme-toggle";

export function PageTopbar({
  eyebrow,
  title,
  description,
  themeLabel,
  actions,
  help
}: {
  eyebrow: string;
  title: string;
  description?: string | undefined;
  themeLabel: string;
  actions?: React.ReactNode;
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
        <button className="icon-button" aria-label="Notifications" title="Notifications">
          <Bell size={18} />
        </button>
        <ThemeToggle label={themeLabel} />
      </div>
    </header>
  );
}

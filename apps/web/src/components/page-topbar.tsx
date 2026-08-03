import { Bell } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";

export function PageTopbar({ eyebrow, title, description, themeLabel, actions }: { eyebrow: string; title: string; description?: string | undefined; themeLabel: string; actions?: React.ReactNode }) {
  return <header className="topbar"><div className="topbar-page-title"><p>{eyebrow}</p><div><h1>{title}</h1>{description && <span>{description}</span>}</div></div><div className="top-actions">{actions}<button className="icon-button" aria-label="Notifications" title="Notifications"><Bell size={18} /></button><ThemeToggle label={themeLabel} /></div></header>;
}

"use client";

import {
  Boxes,
  ChevronDown,
  Clock,
  CloudCog,
  Command,
  FolderKanban,
  Headphones,
  LayoutDashboard,
  Package,
  ReceiptText,
  Settings,
  Users
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useFeature } from "@/components/feature-provider";

type Labels = {
  label: string;
  dashboard: string;
  customers: string;
  products: string;
  expenses: string;
  catalog: string;
  customerSubscriptions: string;
  companySubscriptions: string;
  projects: string;
  support: string;
  attendance: string;
  infrastructure: string;
  integrations: string;
  settings: string;
};

export function AppSidebar({ locale, labels, ready }: { locale: string; labels: Labels; ready?: string }) {
  const pathname = usePathname();
  // Resolved on the server by the root layout: a menu entry leading to a route the API does not
  // serve is worse than no entry at all, and the sidebar cannot read the environment itself.
  const projectsEnabled = useFeature("projects_and_time");
  const attendanceEnabled = useFeature("attendance");
  const item = (href: string, label: string, Icon?: typeof Package, exact = false) => (
    <Link
      className={
        pathname === href || (!exact && href !== `/${locale}` && pathname.startsWith(`${href}/`))
          ? "nav-item active"
          : "nav-item"
      }
      href={href}
    >
      {Icon && <Icon size={19} />}
      <span>{label}</span>
    </Link>
  );
  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-mark">
          <Command size={22} />
        </span>
        <span>
          <strong>Control Hub</strong>
          <small>BUSINESS OPERATIONS</small>
        </span>
      </div>
      <nav aria-label={labels.label}>
        {item(`/${locale}`, labels.dashboard, LayoutDashboard)}
        {item(`/${locale}/crm`, labels.customers, Users)}
        <details className="nav-group" open={pathname.startsWith(`/${locale}/products`)}>
          <summary>
            <Package size={19} />
            <span>{labels.products}</span>
            <ChevronDown size={15} />
          </summary>
          <div>
            {item(`/${locale}/products`, labels.catalog, undefined, true)}
            {item(`/${locale}/products/customer-subscriptions`, labels.customerSubscriptions)}
          </div>
        </details>
        <details className="nav-group" open={pathname.startsWith(`/${locale}/expenses`)}>
          <summary>
            <ReceiptText size={19} />
            <span>{labels.expenses}</span>
            <ChevronDown size={15} />
          </summary>
          <div>{item(`/${locale}/expenses/subscriptions`, labels.companySubscriptions)}</div>
        </details>
        {projectsEnabled && item(`/${locale}/projects`, labels.projects, FolderKanban)}
        {item(`/${locale}/support`, labels.support, Headphones)}
        {attendanceEnabled && item(`/${locale}/attendance`, labels.attendance, Clock)}
        {item("#", labels.infrastructure, CloudCog)}
        {item("#", labels.integrations, Boxes)}
        {item(`/${locale}/security`, labels.settings, Settings)}
      </nav>
      {ready && (
        <div className="sidebar-footer">
          <Command size={18} />
          <span>{ready}</span>
        </div>
      )}
    </aside>
  );
}

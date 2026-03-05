"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

interface SidebarItem {
  label: string;
  href: string;
}

interface SidebarSection {
  title: string;
  items: SidebarItem[];
}

const SIDEBAR_SECTIONS: SidebarSection[] = [
  {
    title: "Dashboard",
    items: [
      { label: "Executive Overview", href: "/dashboard" },
    ],
  },
  {
    title: "Catalog",
    items: [
      { label: "Products", href: "/catalog/products" },
      { label: "Categories", href: "/catalog/categories" },
      { label: "Attributes", href: "/catalog/attributes" },
      { label: "Media", href: "/catalog/media" },
    ],
  },
  {
    title: "Channels",
    items: [
      { label: "Overview", href: "/channels" },
      { label: "Connectors", href: "/channels/connectors" },
      { label: "Mappings", href: "/channels/mappings" },
      { label: "Submissions", href: "/channels/submissions" },
      { label: "Health", href: "/channels/health" },
    ],
  },
  {
    title: "Operations",
    items: [
      { label: "Imports", href: "/operations/imports" },
      { label: "Bulk Edit", href: "/operations/bulk-edit" },
      { label: "Jobs", href: "/operations/jobs" },
      { label: "Repair Center", href: "/operations/repair" },
    ],
  },
  {
    title: "Quality",
    items: [
      { label: "Issue Inbox", href: "/quality/issues" },
      { label: "Validation", href: "/quality/validation" },
      { label: "Rejection Insights", href: "/rejection" },
      { label: "Completeness", href: "/quality/completeness" },
      { label: "Approval Queue", href: "/quality/approvals" },
    ],
  },
  {
    title: "Admin",
    items: [
      { label: "Workspace Settings", href: "/admin/workspace" },
      { label: "Plan & Usage", href: "/admin/plan" },
      { label: "Users & Roles", href: "/admin/users" },
      { label: "Connector Access", href: "/admin/connectors" },
      { label: "Privacy", href: "/admin/privacy" },
      { label: "Audit Logs", href: "/admin/audit" },
    ],
  },
  {
    title: "Labs / Internal",
    items: [
      { label: "Developer", href: "/internal/developer" },
      { label: "AI Lab", href: "/ai" },
      { label: "DAM", href: "/media" },
      { label: "ONDC", href: "/ondc" },
    ],
  },
];

function isItemActive(pathname: string, item: SidebarItem): boolean {
  if (item.href === "/") {
    return pathname === "/";
  }
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

interface AppSidebarProps {
  showInternal?: boolean;
}

export function AppSidebar({ showInternal = false }: AppSidebarProps) {
  const pathname = usePathname();
  const sections = showInternal
    ? SIDEBAR_SECTIONS
    : SIDEBAR_SECTIONS.filter((section) => section.title !== "Labs / Internal");

  return (
    <aside className="sticky top-20 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="mb-2 px-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        Workspace
      </div>
      <div className="space-y-4">
        {sections.map((section) => (
          <section key={section.title}>
            <h2 className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              {section.title}
            </h2>
            <ul className="space-y-1">
              {section.items.map((item) => {
                const active = isItemActive(pathname, item);
                return (
                  <li key={`${section.title}:${item.label}:${item.href}`}>
                    <Link
                      href={item.href}
                      className={cn(
                        "block rounded-md px-2 py-2 text-sm font-medium transition",
                        active
                          ? "bg-slate-900 text-white"
                          : "text-slate-700 hover:bg-slate-100 hover:text-slate-900",
                      )}
                    >
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </aside>
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

interface SidebarItem {
  label: string;
  href: string;
}

interface SidebarSection {
  title: string;
  items: SidebarItem[];
  badgeKey?: "quality" | "operations";
}

interface SidebarBadgeSummary {
  quality: number;
  operations: number;
}

const SIDEBAR_SECTIONS: SidebarSection[] = [
  {
    title: "Dashboard",
    items: [
      { label: "Overview", href: "/dashboard" },
    ],
  },
  {
    title: "Products",
    items: [
      { label: "Product Workbench", href: "/catalog/products" },
    ],
  },
  {
    title: "Catalog",
    items: [
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
    title: "Quality",
    badgeKey: "quality",
    items: [
      { label: "Issue Inbox", href: "/quality/issues" },
      { label: "Validation", href: "/quality/validation" },
      { label: "Rejection Insights", href: "/rejection" },
      { label: "Completeness", href: "/quality/completeness" },
      { label: "Approval Queue", href: "/quality/approvals" },
    ],
  },
  {
    title: "Operations",
    badgeKey: "operations",
    items: [
      { label: "Imports", href: "/operations/imports" },
      { label: "Bulk Edit", href: "/operations/bulk-edit" },
      { label: "Jobs", href: "/operations/jobs" },
      { label: "Repair Center", href: "/operations/repair" },
    ],
  },
  {
    title: "Settings",
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
  const [badges, setBadges] = useState<SidebarBadgeSummary>({ quality: 0, operations: 0 });
  const sections = showInternal
    ? SIDEBAR_SECTIONS
    : SIDEBAR_SECTIONS.filter((section) => section.title !== "Labs / Internal");

  useEffect(() => {
    const controller = new AbortController();

    async function loadBadges() {
      try {
        const response = await fetch("/api/navigation/summary", {
          method: "GET",
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) {
          return;
        }
        const next = (await response.json()) as Partial<SidebarBadgeSummary>;
        setBadges({
          quality: Number(next.quality ?? 0),
          operations: Number(next.operations ?? 0),
        });
      } catch {
        // Keep the base sidebar usable even if the badge summary is unavailable.
      }
    }

    void loadBadges();
    return () => controller.abort();
  }, [pathname]);

  return (
    <aside className="sticky top-20 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="mb-2 px-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        Workspace
      </div>
      <div className="space-y-4">
        {sections.map((section) => (
          <section key={section.title}>
            <div className="flex items-center justify-between gap-2 px-2 pb-1">
              <h2 className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{section.title}</h2>
              {section.badgeKey && badges[section.badgeKey] > 0 ? (
                <span
                  className={cn(
                    "rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
                    section.badgeKey === "quality"
                      ? "bg-red-50 text-red-700"
                      : "bg-amber-50 text-amber-700",
                  )}
                >
                  {badges[section.badgeKey]}
                </span>
              ) : null}
            </div>
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

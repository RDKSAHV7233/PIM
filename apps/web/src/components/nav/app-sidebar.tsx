"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { AppRole } from "@/lib/api";
import { canViewAdminNavigationItem, type AdminNavigationAudience } from "@/lib/admin-navigation";
import { cn } from "@/lib/utils";

interface SidebarItem {
  label: string;
  href: string;
  icon: SidebarIconName;
  visibility?: AdminNavigationAudience;
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

type SidebarIconName =
  | "home"
  | "box"
  | "folder"
  | "sliders"
  | "image"
  | "grid"
  | "plug"
  | "branch"
  | "send"
  | "pulse"
  | "alert"
  | "check"
  | "chart"
  | "pie"
  | "clipboard"
  | "upload"
  | "spark"
  | "clock"
  | "wrench"
  | "building"
  | "gauge"
  | "users"
  | "shield"
  | "key"
  | "webhook"
  | "lock"
  | "receipt"
  | "code"
  | "flask"
  | "database"
  | "globe"
  | "tag";

function SidebarIcon({ name, className }: { name: SidebarIconName; className?: string }) {
  const props = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className: cn("h-4 w-4 shrink-0", className),
    "aria-hidden": true,
  };

  switch (name) {
    case "home":
      return <svg {...props}><path d="M3 11.5 12 4l9 7.5" /><path d="M5.5 10.5V20h13V10.5" /></svg>;
    case "box":
      return <svg {...props}><path d="M12 3 4.5 7 12 11l7.5-4L12 3Z" /><path d="M4.5 7v10L12 21l7.5-4V7" /><path d="M12 11v10" /></svg>;
    case "folder":
      return <svg {...props}><path d="M3.5 7.5h6l2 2h9v8.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2V7.5Z" /></svg>;
    case "sliders":
      return <svg {...props}><path d="M4 6h16" /><path d="M4 12h16" /><path d="M4 18h16" /><circle cx="9" cy="6" r="2" /><circle cx="15" cy="12" r="2" /><circle cx="11" cy="18" r="2" /></svg>;
    case "image":
      return <svg {...props}><rect x="3.5" y="4.5" width="17" height="15" rx="2" /><circle cx="9" cy="10" r="1.5" /><path d="m6.5 17 4-4 3 3 2.5-2.5 2 3.5" /></svg>;
    case "grid":
      return <svg {...props}><rect x="4" y="4" width="6.5" height="6.5" rx="1" /><rect x="13.5" y="4" width="6.5" height="6.5" rx="1" /><rect x="4" y="13.5" width="6.5" height="6.5" rx="1" /><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1" /></svg>;
    case "plug":
      return <svg {...props}><path d="M9 7V4" /><path d="M15 7V4" /><path d="M7 9h10v2a5 5 0 0 1-5 5 5 5 0 0 1-5-5V9Z" /><path d="M12 16v4" /></svg>;
    case "branch":
      return <svg {...props}><circle cx="6" cy="6" r="2" /><circle cx="18" cy="6" r="2" /><circle cx="18" cy="18" r="2" /><path d="M8 6h6a4 4 0 0 1 4 4v6" /></svg>;
    case "send":
      return <svg {...props}><path d="M4 20 20 12 4 4l3 8-3 8Z" /><path d="M7 12h8" /></svg>;
    case "pulse":
      return <svg {...props}><path d="M3 12h4l2-4 4 8 2-4h6" /></svg>;
    case "alert":
      return <svg {...props}><path d="M12 4 3.5 19h17L12 4Z" /><path d="M12 9v4" /><path d="M12 16h.01" /></svg>;
    case "check":
      return <svg {...props}><path d="m5 12 4 4 10-10" /></svg>;
    case "chart":
      return <svg {...props}><path d="M5 19V9" /><path d="M12 19V5" /><path d="M19 19v-7" /></svg>;
    case "pie":
      return <svg {...props}><path d="M12 3v9h9" /><path d="M20.5 13A8.5 8.5 0 1 1 11 3.1" /></svg>;
    case "clipboard":
      return <svg {...props}><rect x="6" y="5" width="12" height="15" rx="2" /><path d="M9 5.5h6" /><path d="m9.5 13 2 2 3-4" /></svg>;
    case "upload":
      return <svg {...props}><path d="M12 16V5" /><path d="m7.5 9.5 4.5-4.5 4.5 4.5" /><path d="M5 19.5h14" /></svg>;
    case "spark":
      return <svg {...props}><path d="m12 3 1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8L12 3Z" /></svg>;
    case "clock":
      return <svg {...props}><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></svg>;
    case "wrench":
      return <svg {...props}><path d="M14.5 6.5a3 3 0 0 0 3.7 3.7l-8.8 8.8a2 2 0 1 1-2.8-2.8l8.8-8.8a3 3 0 0 0 3.7-3.7l-2 2-2.6-2.6 2-2Z" /></svg>;
    case "building":
      return <svg {...props}><path d="M5 20V6l7-2v16" /><path d="M12 20V9l7-2v13" /><path d="M8 9h1" /><path d="M8 12h1" /><path d="M15 12h1" /><path d="M15 15h1" /></svg>;
    case "gauge":
      return <svg {...props}><path d="M5 16a7 7 0 0 1 14 0" /><path d="M12 13.5 16 9.5" /><path d="M6 16h12" /></svg>;
    case "users":
      return <svg {...props}><circle cx="9" cy="9" r="3" /><circle cx="17" cy="10" r="2.5" /><path d="M4.5 19a4.5 4.5 0 0 1 9 0" /><path d="M14.5 19a3.5 3.5 0 0 1 5 0" /></svg>;
    case "shield":
      return <svg {...props}><path d="M12 4 6 6.5V11c0 4 2.6 7.2 6 8.5 3.4-1.3 6-4.5 6-8.5V6.5L12 4Z" /></svg>;
    case "key":
      return <svg {...props}><circle cx="8.5" cy="12" r="3.5" /><path d="M12 12h8" /><path d="M17 12v2.5" /><path d="M19 12v1.5" /></svg>;
    case "webhook":
      return <svg {...props}><path d="M9 7.5a4.5 4.5 0 1 1 4.2 6" /><path d="M15 16.5A4.5 4.5 0 1 1 10.8 10" /><path d="M12 12h.01" /></svg>;
    case "lock":
      return <svg {...props}><rect x="5.5" y="11" width="13" height="9" rx="2" /><path d="M8 11V8.5a4 4 0 0 1 8 0V11" /></svg>;
    case "receipt":
      return <svg {...props}><path d="M7 4.5h10v15l-2-1.5-2 1.5-2-1.5-2 1.5-2-1.5-2 1.5v-15Z" /><path d="M9 9h6" /><path d="M9 13h6" /></svg>;
    case "code":
      return <svg {...props}><path d="m9 8-4 4 4 4" /><path d="m15 8 4 4-4 4" /><path d="m13 5-2 14" /></svg>;
    case "flask":
      return <svg {...props}><path d="M10 4h4" /><path d="M10 4v4l-4.5 7.5A2.5 2.5 0 0 0 7.7 19h8.6a2.5 2.5 0 0 0 2.2-3.5L14 8V4" /><path d="M9 13h6" /></svg>;
    case "database":
      return <svg {...props}><ellipse cx="12" cy="6.5" rx="6.5" ry="2.5" /><path d="M5.5 6.5v5c0 1.4 2.9 2.5 6.5 2.5s6.5-1.1 6.5-2.5v-5" /><path d="M5.5 11.5v5c0 1.4 2.9 2.5 6.5 2.5s6.5-1.1 6.5-2.5v-5" /></svg>;
    case "globe":
      return <svg {...props}><circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17" /><path d="M12 3.5a13 13 0 0 1 0 17" /><path d="M12 3.5a13 13 0 0 0 0 17" /></svg>;
    case "tag":
      return <svg {...props}><path d="M3 7a2 2 0 0 1 2-2h8l8 7-8 7H5a2 2 0 0 1-2-2Z" /><circle cx="7.5" cy="9.5" r="1.2" /></svg>;
  }
}

const SIDEBAR_SECTIONS: SidebarSection[] = [
  {
    title: "Workspace",
    items: [
      { label: "Dashboard", href: "/dashboard", icon: "home" },
    ],
  },
  {
    title: "Catalog",
    items: [
      { label: "Products", href: "/catalog/products", icon: "box" },
      { label: "Categories", href: "/catalog/categories", icon: "folder", visibility: "admin" },
      { label: "Attributes", href: "/catalog/attributes", icon: "sliders", visibility: "admin" },
      { label: "Media", href: "/catalog/media", icon: "image" },
    ],
  },
  {
    title: "Connections",
    items: [
      { label: "Overview", href: "/channels", icon: "grid" },
      { label: "Connections", href: "/channels/connectors", icon: "plug" },
      { label: "Mappings", href: "/channels/mappings", icon: "branch", visibility: "channel_manager_plus" },
      { label: "Issues", href: "/channels/health", icon: "pulse" },
      { label: "Submission Log", href: "/channels/submissions", icon: "send" },
      { label: "Governance", href: "/admin/connectors", icon: "shield", visibility: "connector_admin_plus" },
      { label: "Pipeline", href: "/admin/connectors/pipeline", icon: "flask", visibility: "system_admin_gated" },
    ],
  },
  {
    title: "Quality",
    badgeKey: "quality",
    items: [
      { label: "Issue Inbox", href: "/quality/issues", icon: "alert" },
      { label: "Validation", href: "/quality/validation", icon: "check" },
      { label: "Rejection Insights", href: "/rejection", icon: "chart" },
      { label: "Completeness", href: "/quality/completeness", icon: "pie" },
      { label: "Approval Queue", href: "/quality/approvals", icon: "clipboard", visibility: "approval_decider" },
    ],
  },
  {
    title: "Operate",
    badgeKey: "operations",
    items: [
      { label: "Imports", href: "/operations/imports", icon: "upload", visibility: "editor_plus" },
      { label: "Bulk Edit", href: "/operations/bulk-edit", icon: "spark", visibility: "editor_plus" },
      { label: "Jobs", href: "/operations/jobs", icon: "clock", visibility: "editor_plus" },
      { label: "Repair Center", href: "/operations/repair", icon: "wrench", visibility: "editor_plus" },
    ],
  },
  {
    title: "Settings",
    items: [
      { label: "Plan & Usage", href: "/admin/plan", icon: "gauge", visibility: "editor_plus" },
      { label: "Pricing", href: "/settings/pricing", icon: "tag", visibility: "editor_plus" },
      { label: "Users & Roles", href: "/admin/users", icon: "users", visibility: "system_admin_gated" },
      { label: "API Keys", href: "/admin/api-keys", icon: "key", visibility: "system_admin_gated" },
      { label: "Auth Policy", href: "/admin/auth-policy", icon: "shield", visibility: "system_admin_gated" },
      { label: "Outbound Webhooks", href: "/admin/webhooks", icon: "webhook", visibility: "system_admin_gated" },
      { label: "Account Security", href: "/settings/security", icon: "shield" },
      { label: "Privacy", href: "/admin/privacy", icon: "lock" },
      { label: "Audit Logs", href: "/admin/audit", icon: "receipt", visibility: "system_admin_gated" },
    ],
  },
];

const INTERNAL_SECTION: SidebarSection = {
  title: "Internal",
  items: [
    { label: "Developer", href: "/internal/developer", icon: "code" },
    { label: "AI Lab", href: "/ai", icon: "flask" },
    { label: "DAM", href: "/media", icon: "database" },
    { label: "ONDC", href: "/ondc", icon: "globe" },
  ],
};

function isItemActive(pathname: string, item: SidebarItem): boolean {
  if (item.href === "/") {
    return pathname === "/";
  }
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

interface AppSidebarProps {
  actorRole: AppRole;
  adminBoundaryRoles?: string[];
  showInternal?: boolean;
}

export function AppSidebar({ actorRole, adminBoundaryRoles = [], showInternal = false }: AppSidebarProps) {
  const pathname = usePathname();
  const [badges, setBadges] = useState<SidebarBadgeSummary>({ quality: 0, operations: 0 });
  // Memoize so SIDEBAR_SECTIONS is not re-filtered on every pathname change or badge update.
  const sections = useMemo(
    () =>
      (showInternal ? [...SIDEBAR_SECTIONS, INTERNAL_SECTION] : SIDEBAR_SECTIONS)
        .map((section) => ({
          ...section,
          items: section.items.filter((item) =>
            canViewAdminNavigationItem(actorRole, item.visibility, adminBoundaryRoles),
          ),
        }))
        .filter((section) => section.items.length > 0),
    [actorRole, adminBoundaryRoles, showInternal],
  );

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
                        "flex items-center gap-2 rounded-md px-2 py-2 text-sm font-medium transition",
                        active
                          ? "bg-accent text-white"
                          : "text-slate-700 hover:bg-slate-100 hover:text-slate-900",
                      )}
                    >
                      <SidebarIcon name={item.icon} />
                      <span>{item.label}</span>
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

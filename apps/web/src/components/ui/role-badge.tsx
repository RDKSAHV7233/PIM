"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { AppRole } from "@/lib/api";
import { canViewAdminNavigationItem } from "@/lib/admin-navigation";

const roleConfig: Record<AppRole, { label: string; bg: string; text: string; border: string }> = {
  admin:           { label: "Admin",           bg: "#f0fdf4", text: "#166534", border: "#bbf7d0" },
  editor:          { label: "Editor",          bg: "#eff6ff", text: "#1e40af", border: "#bfdbfe" },
  reviewer: { label: "Reviewer", bg: "#fff7ed", text: "#9a3412", border: "#fdba74" },
  viewer:          { label: "Viewer",          bg: "#fafafa", text: "#6b7280", border: "#e5e7eb" },
};

interface RoleBadgeProps {
  role: AppRole;
}

export function RoleBadge({ role }: RoleBadgeProps) {
  const current = roleConfig[role];
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const pathname = usePathname();

  useEffect(() => {
    function onMouseDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    window.addEventListener("mousedown", onMouseDown);
    return () => window.removeEventListener("mousedown", onMouseDown);
  }, []);

  const description =
    role === "admin"
      ? "Full access to all product, channel, connector, and workspace operations"
      : role === "editor"
        ? "Edit catalog, import products, manage categories and attributes"
        : role === "reviewer"
          ? "Read catalog and submission data, add comments"
          : "Read-only access to catalog and reporting";
  const canManageRoles = canViewAdminNavigationItem(role, "editor_plus");
  const manageRolesHref = pathname === "/admin/users" ? "#workspace-users" : "/admin/users#workspace-users";

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium"
        style={{
          backgroundColor: current.bg,
          borderColor: current.border,
          color: current.text,
        }}
      >
        Role: {current.label}
      </button>
      {open ? (
        <div className="absolute right-0 top-[calc(100%+8px)] z-50 w-72 rounded-md border border-slate-200 bg-white p-3 text-sm text-slate-700 shadow-lg">
          <p className="font-semibold text-slate-900">{current.label}</p>
          <p className="mt-1">{description}</p>
          {canManageRoles ? (
            <Link
              href={manageRolesHref}
              className="mt-2 inline-flex text-sm font-medium text-blue-700 hover:underline"
              onClick={() => setOpen(false)}
            >
              Manage team roles {"->"}
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

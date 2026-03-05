"use client";

import type { AppRole } from "@/lib/api";

const roleConfig: Record<AppRole, { label: string; bg: string; text: string; border: string }> = {
  admin: { label: "Admin", bg: "#f0fdf4", text: "#166534", border: "#bbf7d0" },
  editor: { label: "Editor", bg: "#eff6ff", text: "#1e40af", border: "#bfdbfe" },
  viewer: { label: "Viewer", bg: "#fafafa", text: "#6b7280", border: "#e5e7eb" },
};

const roleOrder: AppRole[] = ["admin", "editor", "viewer"];

interface RoleBadgeProps {
  role: AppRole;
}

export function RoleBadge({ role }: RoleBadgeProps) {
  const current = roleConfig[role];
  const alternateRoles = roleOrder
    .filter((entry) => entry !== role)
    .map((entry) => roleConfig[entry].label)
    .join(" / ");

  return (
    <div
      className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium"
      style={{
        backgroundColor: current.bg,
        borderColor: current.border,
        color: current.text,
      }}
      title={`Active role from JWT claims. Available roles: ${alternateRoles}`}
    >
      {current.label}
    </div>
  );
}


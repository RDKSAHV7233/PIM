"use client";

import { useSearchParams } from "next/navigation";

type AppRole = "admin" | "editor" | "viewer";

const roleConfig: Record<
  AppRole,
  { label: string; bg: string; text: string; border: string }
> = {
  admin: { label: "Admin", bg: "#f0fdf4", text: "#166534", border: "#bbf7d0" },
  editor: { label: "Editor", bg: "#eff6ff", text: "#1e40af", border: "#bfdbfe" },
  viewer: { label: "Read Only", bg: "#fafafa", text: "#6b7280", border: "#e5e7eb" },
};

function normalizeRole(value: string | null): AppRole {
  if (value === "editor" || value === "viewer") {
    return value;
  }
  return "admin";
}

export function RoleBadge() {
  const params = useSearchParams();
  const role = normalizeRole(params.get("role"));
  const config = roleConfig[role];

  return (
    <span
      className="inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium"
      style={{
        backgroundColor: config.bg,
        borderColor: config.border,
        color: config.text,
      }}
    >
      {config.label}
    </span>
  );
}

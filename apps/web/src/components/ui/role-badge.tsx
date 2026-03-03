"use client";

import { useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

type AppRole = "admin" | "editor" | "viewer";

const roleConfig: Record<AppRole, { label: string; bg: string; text: string; border: string }> = {
  admin: { label: "Admin", bg: "#f0fdf4", text: "#166534", border: "#bbf7d0" },
  editor: { label: "Editor", bg: "#eff6ff", text: "#1e40af", border: "#bfdbfe" },
  viewer: { label: "Viewer", bg: "#fafafa", text: "#6b7280", border: "#e5e7eb" },
};

const roleOrder: AppRole[] = ["admin", "editor", "viewer"];

function normalizeRole(value: string | null): AppRole {
  if (value === "editor" || value === "viewer") {
    return value;
  }
  return "admin";
}

export function RoleBadge() {
  const [open, setOpen] = useState(false);
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const role = normalizeRole(params.get("role"));
  const current = roleConfig[role];

  const allParams = useMemo(() => new URLSearchParams(params.toString()), [params]);

  function switchRole(nextRole: AppRole) {
    const next = new URLSearchParams(allParams.toString());
    next.set("role", nextRole);
    const query = next.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
    setOpen(false);
  }

  return (
    <div className="relative">
      <button
        type="button"
        className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium"
        style={{
          backgroundColor: current.bg,
          borderColor: current.border,
          color: current.text,
        }}
        onClick={() => setOpen((value) => !value)}
      >
        {current.label}
        <span aria-hidden="true">▾</span>
      </button>
      {open ? (
        <div className="absolute right-0 z-10 mt-2 w-36 rounded-md border border-slate-200 bg-white p-1 shadow-lg">
          {roleOrder.map((nextRole) => (
            <button
              key={nextRole}
              type="button"
              onClick={() => switchRole(nextRole)}
              className="flex w-full items-center rounded px-2 py-2 text-left text-sm text-slate-700 hover:bg-slate-100"
            >
              {roleConfig[nextRole].label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}



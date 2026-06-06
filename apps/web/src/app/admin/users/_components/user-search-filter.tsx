"use client";

import { useMemo, useState } from "react";
import { DataGrid } from "@/components/ui/data-grid";
import type { Column } from "@/components/ui/data-grid";
import type { WorkspaceUser } from "@/lib/api";

interface UserSearchFilterProps {
  users: WorkspaceUser[];
  columns: Column<WorkspaceUser>[];
  currentUserId: string;
  availableRoles: readonly string[];
}

export function UserSearchFilter({ users, columns, currentUserId: _currentUserId, availableRoles }: UserSearchFilterProps) {
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("all");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users.filter((u) => {
      const matchesSearch = !q || u.userId.toLowerCase().includes(q);
      const matchesRole = roleFilter === "all" || u.role === roleFilter;
      return matchesSearch && matchesRole;
    });
  }, [users, search, roleFilter]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
            aria-hidden
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by user ID…"
            aria-label="Search users"
            className="w-full rounded-md border border-slate-200 bg-white py-2 pl-8 pr-3 text-sm placeholder:text-slate-400 focus:border-slate-500 focus:outline-none"
          />
        </div>
        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
          aria-label="Filter by role"
          className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
        >
          <option value="all">All roles</option>
          {availableRoles.map((r) => (
            <option key={r} value={r}>
              {r.charAt(0).toUpperCase() + r.slice(1)}
            </option>
          ))}
        </select>
        <span className="text-xs text-slate-500">
          {filtered.length} of {users.length}
        </span>
      </div>

      <DataGrid
        columns={columns}
        rows={filtered}
        getRowKey={(u) => u.id}
        caption="Workspace Users"
        emptyState={
          search || roleFilter !== "all" ? (
            <p className="text-sm text-slate-500">
              No users match the current filters.{" "}
              <button
                type="button"
                onClick={() => { setSearch(""); setRoleFilter("all"); }}
                className="text-blue-600 underline"
              >
                Clear filters
              </button>
            </p>
          ) : (
            <p className="text-sm text-slate-600">No users yet. Invite the first user above.</p>
          )
        }
      />
    </div>
  );
}

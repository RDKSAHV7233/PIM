"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { DataGrid } from "@/components/ui/data-grid";
import type { Column } from "@/components/ui/data-grid";
import type { WorkspaceUser } from "@/lib/api";

const SEARCH_DEBOUNCE_MS = 300;

interface UserSearchFilterProps {
  /** The current page's rows, already filtered/paginated server-side — not the full roster. */
  users: WorkspaceUser[];
  columns: Column<WorkspaceUser>[];
  currentUserId: string;
  availableRoles: readonly string[];
  /** Current filter values, as reflected in the URL (server-provided, so SSR and client agree). */
  search: string;
  role: string;
  /**
   * Named `userStatus` (not `status`) both as the prop and the URL query key:
   * this page already uses `?status=user-created` etc. for post-action flash
   * messages (see admin-users-page-content.tsx), a completely different thing
   * from "active/inactive/locked". Reusing `status` here would silently
   * collide with that banner logic.
   */
  userStatus: string;
  /** Cursor for the next page, if the current page isn't the last one. */
  nextCursor: string | null;
  /** Whether a `cursor` param is currently set — i.e. we're past page 1. */
  onLaterPage: boolean;
}

export function UserSearchFilter({
  users,
  columns,
  currentUserId: _currentUserId,
  availableRoles,
  search,
  role,
  userStatus,
  nextCursor,
  onLaterPage,
}: UserSearchFilterProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [searchInput, setSearchInput] = useState(search);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep the input in sync when the URL's own `search` value changes from
  // outside this component (back/forward navigation, a shared link, Clear).
  useEffect(() => {
    setSearchInput(search);
  }, [search]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, []);

  function pushFilters(next: { search?: string; role?: string; userStatus?: string }) {
    // useSearchParams() (not window.location.search) is the only value guaranteed
    // to be current at render time — see products-tab.tsx's PIM#596 note on why
    // reading window.location here can capture a stale pre-navigation snapshot.
    const params = new URLSearchParams(searchParams.toString());
    const nextSearch = next.search ?? search;
    const nextRole = next.role ?? role;
    const nextUserStatus = next.userStatus ?? userStatus;

    if (nextSearch) {
      params.set("search", nextSearch);
    } else {
      params.delete("search");
    }
    if (nextRole) {
      params.set("role", nextRole);
    } else {
      params.delete("role");
    }
    if (nextUserStatus) {
      params.set("userStatus", nextUserStatus);
    } else {
      params.delete("userStatus");
    }
    // Any filter change starts back at page 1 — a cursor from the old,
    // differently-filtered result set doesn't mean anything under new filters.
    params.delete("cursor");

    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  }

  function handleSearchInputChange(value: string) {
    setSearchInput(value);
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    debounceRef.current = setTimeout(() => {
      pushFilters({ search: value });
    }, SEARCH_DEBOUNCE_MS);
  }

  function goToNextPage() {
    if (!nextCursor) {
      return;
    }
    const params = new URLSearchParams(searchParams.toString());
    params.set("cursor", nextCursor);
    router.push(`${pathname}?${params.toString()}`);
  }

  function goToFirstPage() {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("cursor");
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  }

  function clearFilters() {
    setSearchInput("");
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    const params = new URLSearchParams(searchParams.toString());
    params.delete("search");
    params.delete("role");
    params.delete("userStatus");
    params.delete("cursor");
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  }

  const hasActiveFilters = Boolean(search || role || userStatus);

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
            value={searchInput}
            onChange={(e) => handleSearchInputChange(e.target.value)}
            placeholder="Search by user ID…"
            aria-label="Search users"
            className="w-full rounded-md border border-slate-200 bg-white py-2 pl-8 pr-3 text-sm placeholder:text-slate-400 focus:border-slate-500 focus:outline-none"
          />
        </div>
        <select
          value={userStatus}
          onChange={(e) => pushFilters({ userStatus: e.target.value })}
          aria-label="Filter by status"
          className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
        >
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="locked">Locked</option>
        </select>
        <select
          value={role}
          onChange={(e) => pushFilters({ role: e.target.value })}
          aria-label="Filter by role"
          className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
        >
          <option value="">All roles</option>
          {availableRoles.map((r) => (
            <option key={r} value={r}>
              {r.charAt(0).toUpperCase() + r.slice(1)}
            </option>
          ))}
        </select>
        <span className="text-xs text-slate-500">
          {users.length} on this page
        </span>
      </div>

      <DataGrid
        columns={columns}
        rows={users}
        getRowKey={(u) => u.id}
        caption="Workspace Users"
        emptyState={
          hasActiveFilters ? (
            <p className="text-sm text-slate-500">
              No users match the current filters.{" "}
              <button type="button" onClick={clearFilters} className="text-blue-600 underline">
                Clear filters
              </button>
            </p>
          ) : (
            <p className="text-sm text-slate-600">No users yet. Invite the first user above.</p>
          )
        }
      />

      {nextCursor || onLaterPage ? (
        <div className="flex items-center justify-between gap-2 pt-1">
          <button
            type="button"
            onClick={goToFirstPage}
            disabled={!onLaterPage}
            className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            ← First page
          </button>
          <button
            type="button"
            onClick={goToNextPage}
            disabled={!nextCursor}
            className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Next page →
          </button>
        </div>
      ) : null}
    </div>
  );
}

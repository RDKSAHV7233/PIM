"use client";

import Link from "@/components/ui/app-link";
import { useState } from "react";
import {
  createAccessScopeAssignmentAction,
  createWorkspaceUserAction,
  deleteAccessScopeAssignmentAction,
  deactivateWorkspaceUserAction,
  lockWorkspaceUserAction,
  unlockWorkspaceUserAction,
  updateWorkspaceUserRoleAction,
} from "@/app/admin/users/actions";
import { AccessScopeForm } from "./access-scope-form";
import { UserSearchFilter } from "./user-search-filter";
import { Card, CardTitle } from "@/components/ui/card";
import { DataGrid } from "@/components/ui/data-grid";
import { InlineAlert } from "@/components/ui/inline-alert";
import { KpiCard } from "@/components/ui/kpi-card";
import { PageHeader } from "@/components/ui/page-header";
import { StatusChip } from "@/components/ui/status-chip";
import type {
  ConnectorPermission,
  RoleCapabilitiesResponse,
  TenantAuthPolicy,
  WorkspaceUser,
  AccessScopeAssignment,
} from "@/lib/api";

/** Alias kept for readability within this component. */
type RoleCapabilityMatrix = RoleCapabilitiesResponse;

interface BillingUsage {
  profile: { tenantKey: string };
  users: { current: number; limit: number };
}

interface AdminUsersPageContentProps {
  query: Record<string, string | undefined>;
  currentUserId: string;
  canManageUsers: boolean;
  usage: BillingUsage;
  connectorPermissions: ConnectorPermission[];
  workspaceUsers: WorkspaceUser[];
  workspaceUsersNextCursor: string | null;
  accessScopeAssignments: AccessScopeAssignment[];
  capabilities: RoleCapabilityMatrix;
  authPolicy: TenantAuthPolicy | null;
  authPolicyUnavailable: boolean;
  byPrincipalType: Record<string, number>;
  activeUsers: number;
  lockedUsers: number;
  adminUsers: number;
  mfaEnrolledCount: number;
  mfaUnenrolledCount: number;
  atUserLimit: boolean;
  lookupUserId: string;
  lookupResult: WorkspaceUser | null | undefined;
}

const ROLE_INVITE_DESCRIPTIONS: Record<string, string> = {
  admin: "Admin — full governance, users, API keys, and connector management",
  editor: "Editor — manage catalog, imports, and product data",
  publisher: "Publisher — queue and manage channel exports",
  approver: "Approver — record approval decisions on submissions",
  channel_manager: "Channel Manager — manage channel-level settings and submissions",
  connector_admin: "Connector Admin — install and configure connector integrations",
  reviewer: "Reviewer — read-only catalog; comment on submissions and review queue",
  viewer: "Viewer — read-only access to catalog and reporting",
};

const MINIMUM_TIER_BY_ROLE: Record<string, string> = {
  admin: "Starter", editor: "Starter", viewer: "Starter",
  publisher: "Growth", approver: "Growth", reviewer: "Growth",
  channel_manager: "Enterprise", connector_admin: "Enterprise",
};

function describeRole(role: string): string {
  return ROLE_INVITE_DESCRIPTIONS[role] ?? role;
}

function minimumTierLabel(role: string): string {
  return MINIMUM_TIER_BY_ROLE[role] ?? "Enterprise";
}

function toneForCapability(value: string) {
  if (value === "write") return "success" as const;
  if (value === "approve") return "info" as const;
  return "neutral" as const;
}

function getUserStatus(user: { isActive: boolean; isLocked: boolean }) {
  if (!user.isActive) return { label: "inactive", tone: "neutral" as const };
  if (user.isLocked) return { label: "locked", tone: "danger" as const };
  return { label: "active", tone: "success" as const };
}

function formatDateTime(value: string | null) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  return parsed.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
}

function resolveInviteFieldErrors(message: string) {
  const normalized = message.toLowerCase();
  return {
    userId: normalized.includes("user id"),
    role: normalized.includes("role"),
    password: normalized.includes("password"),
  };
}

export function AdminUsersPageContent({
  query,
  currentUserId,
  canManageUsers,
  usage,
  connectorPermissions,
  workspaceUsers,
  workspaceUsersNextCursor,
  accessScopeAssignments,
  capabilities,
  authPolicy,
  authPolicyUnavailable,
  byPrincipalType,
  activeUsers,
  lockedUsers,
  adminUsers,
  mfaEnrolledCount,
  mfaUnenrolledCount,
  atUserLimit,
  lookupUserId,
  lookupResult,
}: AdminUsersPageContentProps) {
  const status = String(query.status ?? "").trim();
  const errorMessage = String(query.message ?? "").trim();
  // Deliberately client-side state rather than reading query.showInvite directly:
  // toggling this used to go through a <Link> that re-navigated the whole page,
  // which re-streams the entire RSC payload on every open/close. That re-stream
  // intermittently got stuck mid-reveal (a Next.js streaming-placeholder race —
  // see F-016), permanently hiding the invite form. Local state sidesteps that
  // by never triggering a fresh navigation for a simple show/hide toggle; the
  // initial value still honors a deep-linked ?showInvite=true for shareable URLs.
  const [showInvite, setShowInvite] = useState(
    () => String(query.showInvite ?? "").trim() === "true",
  );
  const confirmDeactivateUserId = String(query.confirmDeactivate ?? "").trim();
  const inviteFieldErrors = resolveInviteFieldErrors(errorMessage);
  const hasAuthPolicy = authPolicy !== null && !authPolicyUnavailable;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Users & Roles"
        description="Manage workspace access while keeping the role model and connector overrides visible in one place."
        breadcrumb={
          <>
            <Link href="/dashboard" className="hover:underline">Dashboard</Link>{" / "}<Link href="/admin" className="hover:underline">Admin</Link>{" / "}<span className="font-semibold text-slate-700">Users & Roles</span>
          </>
        }
        actions={
          <>
            {canManageUsers ? (
              atUserLimit && !showInvite ? (
                <span
                  title={`User limit reached (${usage.users.current}/${usage.users.limit}). Review your plan to invite more users.`}
                  className="cursor-not-allowed rounded-md bg-slate-300 px-3 py-2 text-sm font-medium text-slate-500 select-none"
                >
                  Invite User
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    const next = !showInvite;
                    setShowInvite(next);
                    // Keep the URL shareable/deep-linkable without triggering a
                    // Next.js navigation (see the note above showInvite's useState).
                    const url = next ? "/admin/users?showInvite=true" : "/admin/users";
                    window.history.replaceState(window.history.state, "", url);
                  }}
                  className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
                >
                  {showInvite ? "Close Invite" : "Invite User"}
                </button>
              )
            ) : null}
            <Link
              href="/admin/connectors"
              className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Connector Access
            </Link>
          </>
        }
      />

      {atUserLimit && !showInvite ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-900">
          <span className="font-semibold">User limit reached</span> — your plan allows{" "}
          {usage.users.limit} user{usage.users.limit === 1 ? "" : "s"} and {usage.users.current}{" "}
          {usage.users.current === 1 ? "is" : "are"} currently active.{" "}
          <Link href="/admin/plan" className="underline hover:no-underline">
            Review your plan
          </Link>{" "}
          to invite more users.
        </div>
      ) : null}
      {status === "user-error" ? (
        <InlineAlert tone="error" message={errorMessage || "Unable to update workspace user."} />
      ) : null}
      {status === "user-created" ? <InlineAlert tone="success" message="Workspace user invited." /> : null}
      {status === "role-updated" ? <InlineAlert tone="success" message="Workspace user role updated." /> : null}
      {status === "user-locked" ? <InlineAlert tone="success" message="Workspace user locked." /> : null}
      {status === "user-unlocked" ? <InlineAlert tone="success" message="Workspace user unlocked." /> : null}
      {status === "user-deactivated" ? <InlineAlert tone="success" message="Workspace user deactivated." /> : null}
      {status === "scope-created" ? <InlineAlert tone="success" message="Delegated access scope assigned." /> : null}
      {status === "scope-deleted" ? <InlineAlert tone="success" message="Delegated access scope removed." /> : null}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
        <KpiCard label="User Limit" value={`${usage.users.current}/${usage.users.limit}`} />
        <KpiCard label="Role Profiles" value={capabilities.matrix.length} />
        <KpiCard label="Connector Overrides" value={connectorPermissions.length} tone="info" />
        <KpiCard
          label="User Principals"
          value={byPrincipalType.user ?? 0}
          helper={`Role principals: ${byPrincipalType.role ?? 0}`}
        />
        <KpiCard label="Delegated Scopes" value={accessScopeAssignments.length} tone="info" />
        <KpiCard
          label="MFA Enrolled"
          value={`${mfaEnrolledCount}/${activeUsers}`}
          tone={
            hasAuthPolicy && authPolicy.mfaRequired && mfaUnenrolledCount > 0
              ? "danger"
              : hasAuthPolicy && mfaEnrolledCount === activeUsers && activeUsers > 0
              ? "success"
              : authPolicyUnavailable
              ? "warning"
              : "default"
          }
          helper={
            authPolicyUnavailable
              ? "Workspace auth policy unavailable"
              : hasAuthPolicy && authPolicy.mfaRequired
              ? "MFA required"
              : "MFA optional"
          }
        />
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Card>
          <CardTitle>Governance Snapshot</CardTitle>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Active Users</p>
              <p className="mt-2 text-2xl font-semibold text-slate-900">{activeUsers}</p>
              <p className="mt-1 text-sm text-slate-600">Operators who can still sign in and work in this tenant.</p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Locked Users</p>
              <p className="mt-2 text-2xl font-semibold text-slate-900">{lockedUsers}</p>
              <p className="mt-1 text-sm text-slate-600">Temporary access holds that still need follow-up or unlock decisions.</p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Admin Coverage</p>
              <p className="mt-2 text-2xl font-semibold text-slate-900">{adminUsers}</p>
              <p className="mt-1 text-sm text-slate-600">Keep at least two active admins so governance never depends on one person.</p>
            </div>
          </div>
        </Card>

        <Card>
          <CardTitle>Operator Model</CardTitle>
          <div className="space-y-2 text-sm text-slate-600">
            <p>Use roles for broad platform permissions and delegated scopes for precise business boundaries.</p>
            <p>Connector overrides should stay exceptional so the default role model remains understandable during audits and buyer reviews.</p>
          </div>
        </Card>
      </section>

      <Card>
        <CardTitle>Access Review Checklist</CardTitle>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <p className="text-sm font-semibold text-slate-900">Confirm ownership</p>
            <p className="mt-1 text-sm text-slate-600">
              Keep at least two active admins and verify that each editor or reviewer still owns a real operating workflow.
            </p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <p className="text-sm font-semibold text-slate-900">Constrain exceptions</p>
            <p className="mt-1 text-sm text-slate-600">
              Use delegated scopes and connector overrides only where business boundaries require them, then review those exceptions regularly.
            </p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <p className="text-sm font-semibold text-slate-900">Retire stale access</p>
            <p className="mt-1 text-sm text-slate-600">
              Lock or deactivate accounts when staffing changes, temporary access ends, or credentials no longer map to a live operator.
            </p>
          </div>
        </div>
        <p className="mt-3 text-xs text-slate-500">
          Run this review before major catalog launches, connector cutovers, or buyer-facing governance walkthroughs.
        </p>
      </Card>

      {!canManageUsers ? (
        <Card>
          <CardTitle>Workspace Access Management</CardTitle>
          <p className="mt-2 text-sm text-slate-600">
            Admin role is required to invite users, change roles, or change account access state. You can still review
            workspace users, the role matrix, and connector overrides below.
          </p>
        </Card>
      ) : null}

      {canManageUsers && showInvite ? (
        <Card>
          <CardTitle>Invite User</CardTitle>
          <p className="mt-2 text-sm text-slate-600">
            Add a workspace user with editor or viewer access. Admin promotion stays explicit after the user exists.
          </p>
          <form action={createWorkspaceUserAction} className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1.4fr)_180px_220px_auto] md:items-end">
            <input type="hidden" name="errorRedirectTo" value="/admin/users?showInvite=true" />
            <label className="grid gap-1 text-sm">
              <span className="font-medium text-slate-700">User ID</span>
              <input
                type="text"
                name="userId"
                id="admin-user-id"
                placeholder="name@example.com"
                className="rounded-md border border-slate-300 px-3 py-2"
                required
                aria-required="true"
                aria-invalid={status === "user-error" && inviteFieldErrors.userId ? "true" : undefined}
                aria-describedby={status === "user-error" && inviteFieldErrors.userId ? "workspace-user-id-error" : undefined}
              />
              {status === "user-error" && inviteFieldErrors.userId ? (
                <p id="workspace-user-id-error" className="text-xs text-red-700">{errorMessage}</p>
              ) : null}
            </label>
            <label className="grid gap-1 text-sm">
              <span className="font-medium text-slate-700">Role</span>
              <select
                name="role"
                id="admin-user-role"
                defaultValue="viewer"
                className="rounded-md border border-slate-300 px-3 py-2"
                aria-required="true"
                aria-invalid={status === "user-error" && inviteFieldErrors.role ? "true" : undefined}
                aria-describedby={status === "user-error" && inviteFieldErrors.role ? "workspace-user-role-error" : undefined}
              >
                {capabilities.availableRoles.map((role) => (
                  <option key={role} value={role}>{describeRole(role)}</option>
                ))}
              </select>
              {status === "user-error" && inviteFieldErrors.role ? (
                <p id="workspace-user-role-error" className="text-xs text-red-700">{errorMessage}</p>
              ) : null}
            </label>
            <label className="grid gap-1 text-sm">
              <span className="font-medium text-slate-700">Initial Password</span>
              <input
                type="password"
                name="password"
                id="admin-user-password"
                autoComplete="new-password"
                minLength={8}
                maxLength={72}
                className="rounded-md border border-slate-300 px-3 py-2"
                required
                aria-required="true"
                aria-invalid={status === "user-error" && inviteFieldErrors.password ? "true" : undefined}
                aria-describedby={status === "user-error" && inviteFieldErrors.password ? "workspace-user-password-error" : undefined}
              />
              {status === "user-error" && inviteFieldErrors.password ? (
                <p id="workspace-user-password-error" className="text-xs text-red-700">{errorMessage}</p>
              ) : null}
            </label>
            <button
              type="submit"
              className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
            >
              Create User
            </button>
          </form>
        </Card>
      ) : null}

      <Card>
        <CardTitle>Find User by Exact Email</CardTitle>
        <p className="mt-2 text-sm text-slate-600">
          The roster below only shows the 1,000 most recently created identities — in a workspace with more than
          that, an older user (including this tenant&apos;s own founding admin) can be completely invisible there.
          This looks the user up directly, no matter how many newer rows exist.
        </p>
        <form action="/admin/users" method="GET" className="mt-3 flex flex-wrap items-end gap-2">
          <label className="grid gap-1 text-sm">
            <span className="font-medium text-slate-700">Exact user ID / email</span>
            <input
              type="text"
              name="lookupUserId"
              defaultValue={lookupUserId}
              placeholder="name@example.com"
              className="min-w-[260px] rounded-md border border-slate-300 px-3 py-2"
            />
          </label>
          <button
            type="submit"
            className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
          >
            Find user
          </button>
          {lookupUserId ? (
            <Link href="/admin/users" className="text-sm text-blue-600 underline">
              Clear
            </Link>
          ) : null}
        </form>

        {lookupUserId && lookupResult === null ? (
          <p className="mt-3 text-sm text-slate-600">
            No user found with the exact ID <span className="font-medium text-slate-900">{lookupUserId}</span>. This
            is an exact match only — check spelling, or the account may not exist in this workspace.
          </p>
        ) : null}

        {lookupUserId && lookupResult ? (
          (() => {
            const user = lookupResult;
            const isSelf = user.userId === currentUserId;
            const isOutOfTier = !capabilities.availableRoles.includes(user.role as never);
            const editOptions = capabilities.availableRoles.includes(user.role as never)
              ? capabilities.availableRoles
              : [...capabilities.availableRoles, user.role];
            const statusChip = getUserStatus(user);
            return (
              <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-slate-900">{user.userId}</p>
                    <p className="text-xs text-slate-500">Created {formatDateTime(user.createdAt)}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusChip label={statusChip.label} tone={statusChip.tone} />
                    <StatusChip
                      label={user.mfaEnrolled ? "mfa enrolled" : "mfa none"}
                      tone={user.mfaEnrolled ? "success" : "neutral"}
                    />
                  </div>
                </div>
                {canManageUsers ? (
                  <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-slate-200 pt-3">
                    <form action={updateWorkspaceUserRoleAction} className="flex items-center gap-2">
                      <input type="hidden" name="userId" value={user.userId} />
                      <select
                        name="role"
                        defaultValue={user.role}
                        className="rounded-md border border-slate-300 px-2 py-2 text-sm"
                        disabled={isSelf}
                      >
                        {editOptions.map((r) => {
                          const locked = !capabilities.availableRoles.includes(r as never);
                          return (
                            <option key={r} value={r} disabled={locked}>
                              {locked ? `${r} (Requires ${minimumTierLabel(r)} plan)` : r}
                            </option>
                          );
                        })}
                      </select>
                      <button
                        type="submit"
                        className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                        disabled={isSelf}
                      >
                        Save role
                      </button>
                    </form>
                    {isOutOfTier ? (
                      <span className="inline-flex w-fit rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                        Requires {minimumTierLabel(user.role)} plan
                      </span>
                    ) : null}
                    {user.isLocked ? (
                      <form action={unlockWorkspaceUserAction}>
                        <input type="hidden" name="userId" value={user.userId} />
                        <button
                          type="submit"
                          className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                        >
                          Unlock
                        </button>
                      </form>
                    ) : (
                      <form action={lockWorkspaceUserAction} className="flex items-center gap-1.5">
                        <input type="hidden" name="userId" value={user.userId} />
                        <select
                          name="durationMinutes"
                          defaultValue="60"
                          disabled={isSelf || !user.isActive}
                          aria-label="Lock duration"
                          className="rounded-md border border-amber-300 px-2 py-1.5 text-sm text-amber-800 disabled:opacity-60"
                        >
                          <option value="60">60m</option>
                          <option value="240">4h</option>
                          <option value="1440">24h</option>
                          <option value="10080">7d</option>
                        </select>
                        <button
                          type="submit"
                          className="rounded-md border border-amber-300 px-3 py-1.5 text-sm font-medium text-amber-800 hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-60"
                          disabled={isSelf || !user.isActive}
                        >
                          Lock
                        </button>
                      </form>
                    )}
                    {confirmDeactivateUserId === user.userId ? (
                      <form action={deactivateWorkspaceUserAction} className="flex flex-col gap-2">
                        <input type="hidden" name="userId" value={user.userId} />
                        <p className="text-xs text-rose-700">Type user ID to confirm:</p>
                        <input
                          type="text"
                          name="confirmUserId"
                          placeholder={user.userId}
                          className="rounded-md border border-rose-300 px-2 py-1 text-xs"
                          required
                          aria-label="Confirm User ID"
                        />
                        <button
                          type="submit"
                          className="rounded-md border border-rose-300 bg-rose-50 px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-100"
                        >
                          Confirm deactivate
                        </button>
                      </form>
                    ) : (
                      <Link
                        href={isSelf || !user.isActive ? "#" : `/admin/users?lookupUserId=${encodeURIComponent(user.userId)}&confirmDeactivate=${encodeURIComponent(user.userId)}`}
                        aria-disabled={isSelf || !user.isActive}
                        className="rounded-md border border-rose-300 px-3 py-2 text-sm font-medium text-rose-700 hover:bg-rose-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-60"
                      >
                        Deactivate
                      </Link>
                    )}
                  </div>
                ) : (
                  <p className="mt-3 border-t border-slate-200 pt-3 text-xs text-slate-500">Read-only</p>
                )}
              </div>
            );
          })()
        ) : null}
      </Card>

      <Card id="workspace-users" className="scroll-mt-24">
        <CardTitle>Workspace Users</CardTitle>
        <p className="mt-2 text-sm text-slate-600">
          Review tenant access, role ownership, and account state in one queue before making lifecycle changes.
        </p>
        <div className="mt-2">
          <UserSearchFilter
            users={workspaceUsers}
            search={String(query.search ?? "").trim()}
            role={String(query.role ?? "").trim()}
            userStatus={String(query.userStatus ?? "").trim()}
            nextCursor={workspaceUsersNextCursor}
            onLaterPage={Boolean(String(query.cursor ?? "").trim())}
            currentUserId={currentUserId}
            availableRoles={capabilities.availableRoles}
            columns={[
              {
                key: "userId",
                header: "User ID",
                render: (user) => (
                  <div className="space-y-1">
                    <p className="font-medium text-slate-900">{user.userId}</p>
                    <p className="text-xs text-slate-500">Created {formatDateTime(user.createdAt)}</p>
                  </div>
                ),
              },
              {
                key: "role",
                header: "Role",
                render: (user) => {
                  const isSelf = user.userId === currentUserId;
                  const isOutOfTier = !capabilities.availableRoles.includes(user.role as never);
                  const editOptions = capabilities.availableRoles.includes(user.role as never)
                    ? capabilities.availableRoles
                    : [...capabilities.availableRoles, user.role];
                  return canManageUsers ? (
                    <div className="flex flex-col gap-1">
                      <form action={updateWorkspaceUserRoleAction} className="flex items-center gap-2">
                        <input type="hidden" name="userId" value={user.userId} />
                        <select
                          name="role"
                          defaultValue={user.role}
                          className="rounded-md border border-slate-300 px-2 py-2 text-sm"
                          disabled={isSelf}
                        >
                          {editOptions.map((r) => {
                            const locked = !capabilities.availableRoles.includes(r as never);
                            return (
                              <option key={r} value={r} disabled={locked}>
                                {locked ? `${r} (Requires ${minimumTierLabel(r)} plan)` : r}
                              </option>
                            );
                          })}
                        </select>
                        <button
                          type="submit"
                          className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                          disabled={isSelf}
                        >
                          Save
                        </button>
                      </form>
                      {isOutOfTier ? (
                        <span className="inline-flex w-fit rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                          Requires {minimumTierLabel(user.role)} plan
                        </span>
                      ) : null}
                    </div>
                  ) : (
                    <div className="flex flex-col gap-1">
                      <StatusChip label={user.role} tone="info" />
                      {isOutOfTier ? (
                        <span className="inline-flex w-fit rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                          Requires {minimumTierLabel(user.role)} plan
                        </span>
                      ) : null}
                    </div>
                  );
                },
              },
              {
                key: "status",
                header: "Status",
                render: (user) => {
                  const statusChip = getUserStatus(user);
                  return <StatusChip label={statusChip.label} tone={statusChip.tone} />;
                },
              },
              {
                key: "mfa",
                header: "MFA",
                render: (user) => (
                  <StatusChip
                    label={user.mfaEnrolled ? "enrolled" : "none"}
                    tone={user.mfaEnrolled ? "success" : "neutral"}
                  />
                ),
              },
              {
                key: "lastSignInAt",
                header: "Last seen",
                mobileHide: true,
                render: (user) => (
                  <span className="text-xs text-slate-600">
                    {(user as { lastSignInAt?: string | null }).lastSignInAt ? formatDateTime((user as { lastSignInAt?: string | null }).lastSignInAt ?? null) : "—"}
                  </span>
                ),
              },
              {
                key: "lockedUntil",
                header: "Locked Until",
                mobileHide: true,
                cellClassName: "text-slate-600",
                render: (user) => formatDateTime(user.lockedUntil),
              },
              {
                key: "actions",
                header: "Actions",
                render: (user) => {
                  const isSelf = user.userId === currentUserId;
                  return canManageUsers ? (
                    <div className="flex flex-wrap gap-2">
                      {user.isLocked ? (
                        <form action={unlockWorkspaceUserAction}>
                          <input type="hidden" name="userId" value={user.userId} />
                          <button
                            type="submit"
                            className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                          >
                            Unlock
                          </button>
                        </form>
                      ) : (
                        <form action={lockWorkspaceUserAction} className="flex items-center gap-1.5">
                          <input type="hidden" name="userId" value={user.userId} />
                          <select
                            name="durationMinutes"
                            defaultValue="60"
                            disabled={isSelf || !user.isActive}
                            aria-label="Lock duration"
                            className="rounded-md border border-amber-300 px-2 py-1.5 text-sm text-amber-800 disabled:opacity-60"
                          >
                            <option value="60">60m</option>
                            <option value="240">4h</option>
                            <option value="1440">24h</option>
                            <option value="10080">7d</option>
                          </select>
                          <button
                            type="submit"
                            className="rounded-md border border-amber-300 px-3 py-1.5 text-sm font-medium text-amber-800 hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-60"
                            disabled={isSelf || !user.isActive}
                          >
                            Lock
                          </button>
                        </form>
                      )}
                      {confirmDeactivateUserId === user.userId ? (
                        <form action={deactivateWorkspaceUserAction} className="flex flex-col gap-2">
                          <input type="hidden" name="userId" value={user.userId} />
                          <p className="text-xs text-rose-700">Type user ID to confirm:</p>
                          <input
                            type="text"
                            name="confirmUserId"
                            placeholder={user.userId}
                            className="rounded-md border border-rose-300 px-2 py-1 text-xs"
                            required
                            aria-label="Confirm User ID"
                          />
                          <div className="flex gap-2">
                            <button
                              type="submit"
                              className="rounded-md border border-rose-300 bg-rose-50 px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-100"
                            >
                              Confirm
                            </button>
                            <Link
                              href="/admin/users"
                              className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
                            >
                              Cancel
                            </Link>
                          </div>
                        </form>
                      ) : (
                        <Link
                          href={isSelf || !user.isActive ? "#" : `/admin/users?confirmDeactivate=${encodeURIComponent(user.userId)}`}
                          aria-disabled={isSelf || !user.isActive}
                          className="rounded-md border border-rose-300 px-3 py-2 text-sm font-medium text-rose-700 hover:bg-rose-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-60"
                        >
                          Deactivate
                        </Link>
                      )}
                    </div>
                  ) : (
                    <span className="text-xs text-slate-500">Read-only</span>
                  );
                },
              },
            ]}
          />
        </div>
      </Card>

      <Card>
        <CardTitle>Delegated Access Scopes</CardTitle>
        <p className="mt-2 text-sm text-slate-600">
          Admin-only delegated scope assignments constrain non-admin access by category, brand, channel, and connector account.
        </p>
        {canManageUsers ? <AccessScopeForm /> : null}
        <div className="mt-3">
          <DataGrid
            columns={[
              {
                key: "subject",
                header: "Subject",
                render: (assignment) => (
                  <div className="space-y-1">
                    <p className="font-medium text-slate-900">{assignment.subjectId}</p>
                    <p className="text-xs text-slate-500">{assignment.subjectType}</p>
                  </div>
                ),
              },
              { key: "scopeType", header: "Scope" },
              {
                key: "value",
                header: "Value",
                cellClassName: "text-slate-600",
                render: (assignment) =>
                  assignment.categoryPath ?? assignment.connectorAccountAlias ?? assignment.scopeValue ?? assignment.categoryId ?? assignment.connectorInstallationId ?? "-",
              },
              {
                key: "scopeActions",
                header: "Actions",
                cellClassName: "text-slate-600",
                render: (assignment) => (assignment.actions.length > 0 ? assignment.actions.join(", ") : "all"),
              },
              {
                key: "updatedAt",
                header: "Updated",
                cellClassName: "text-slate-600",
                render: (assignment) => formatDateTime(assignment.updatedAt),
              },
              {
                key: "admin",
                header: "Admin",
                render: (assignment) =>
                  canManageUsers ? (
                    <form action={deleteAccessScopeAssignmentAction}>
                      <input type="hidden" name="assignmentId" value={assignment.id} />
                      <button type="submit" className="rounded-md border border-rose-300 px-3 py-2 text-sm font-medium text-rose-700 hover:bg-rose-50">
                        Remove
                      </button>
                    </form>
                  ) : (
                    <span className="text-xs text-slate-500">Read-only</span>
                  ),
              },
            ]}
            rows={accessScopeAssignments}
            getRowKey={(assignment) => assignment.id}
            caption="Delegated Access Scopes"
            emptyState={<p className="text-sm text-slate-600">No delegated access assignments are configured.</p>}
          />
        </div>
      </Card>

      <Card>
        <CardTitle>Roles available on your plan</CardTitle>
        <p className="mt-2 text-sm text-slate-600">
          Your <strong>{capabilities.planTier ?? "—"}</strong> plan includes {(capabilities.availableRoles ?? []).length} role{(capabilities.availableRoles ?? []).length !== 1 ? "s" : ""}. Roles marked Requires upgrade are assigned to existing users but cannot be granted to new users on this plan.
        </p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {(capabilities.availableRoles ?? []).map((role) => (
            <div key={role} className="rounded-md border border-slate-200 px-3 py-2">
              <div className="text-sm font-medium text-slate-900">{role.charAt(0).toUpperCase() + role.slice(1)}</div>
              <div className="mt-0.5 text-xs text-slate-500">{describeRole(role)}</div>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <CardTitle>Role Matrix</CardTitle>
        <p className="mt-2 text-sm text-slate-600">
          Use this matrix as the default policy baseline, then keep exceptions visible through delegated scopes and connector overrides.
        </p>
        <div className="mt-2">
          <DataGrid
            columns={[
              { key: "role", header: "Role", cellClassName: "font-medium text-slate-900" },
              {
                key: "catalog",
                header: "Catalog",
                render: (entry) => <StatusChip label={entry.catalog} tone={toneForCapability(entry.catalog)} />,
              },
              {
                key: "channels",
                header: "Channels",
                render: (entry) => <StatusChip label={entry.channels} tone={toneForCapability(entry.channels)} />,
              },
              {
                key: "ops",
                header: "Operations",
                render: (entry) => <StatusChip label={entry.ops} tone={toneForCapability(entry.ops)} />,
              },
              {
                key: "quality",
                header: "Quality",
                render: (entry) => <StatusChip label={entry.quality} tone={toneForCapability(entry.quality)} />,
              },
              {
                key: "admin",
                header: "Admin",
                render: (entry) => (
                  <StatusChip
                    label={entry.admin}
                    tone={entry.admin === "full" ? "info" : entry.admin === "none" ? "neutral" : "warning"}
                  />
                ),
              },
            ]}
            rows={[...capabilities.matrix]}
            getRowKey={(entry) => entry.role}
            caption="Role Matrix"
          />
        </div>
      </Card>

      <Card>
        <CardTitle>MFA Policy</CardTitle>
        {authPolicyUnavailable || !authPolicy ? (
          <div className="mt-2 space-y-3">
            <InlineAlert
              tone="warning"
              title="Auth policy temporarily unavailable"
              message="We could not load the workspace auth policy, so this page will not guess whether MFA is required or optional right now."
            />
            <p className="text-sm text-slate-600">
              MFA enrollment counts still come from live workspace users, but enforcement posture is hidden until the
              policy read succeeds.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link
                href="/admin/users"
                className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
              >
                Retry users page
              </Link>
              <Link
                href="/admin/auth-policy"
                className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Manage Auth Policy
              </Link>
            </div>
          </div>
        ) : (
          <>
            <p className="mt-2 text-sm text-slate-600">
              MFA is currently{" "}
              <span className={`font-semibold ${authPolicy.mfaRequired ? "text-emerald-700" : "text-slate-600"}`}>
                {authPolicy.mfaRequired ? "required" : "optional"}
              </span>
              {" "}for this workspace.{" "}
              {mfaUnenrolledCount > 0 && authPolicy.mfaRequired
                ? `${mfaUnenrolledCount} active user${mfaUnenrolledCount === 1 ? " has" : "s have"} not yet enrolled.`
                : mfaEnrolledCount === activeUsers && activeUsers > 0
                ? "All active users are enrolled."
                : null}
            </p>
            <div className="mt-3">
              <Link
                href="/admin/auth-policy"
                className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Manage Auth Policy
              </Link>
            </div>
          </>
        )}
      </Card>

      <Card>
        <CardTitle>Connector Permission Overrides</CardTitle>
        <p className="mt-2 text-sm text-slate-600">
          Connector overrides are the exception layer for machine or role-specific access. Review them alongside user roles so connector governance stays auditable.
        </p>
        <div className="mt-2">
          <DataGrid
            columns={[
              { key: "principalId", header: "Principal", cellClassName: "font-medium text-slate-900" },
              { key: "principalType", header: "Type", mobileHide: true },
              { key: "connectorSlug", header: "Connector" },
              { key: "action", header: "Action" },
              { key: "accountAlias", header: "Alias", mobileHide: true },
              {
                key: "updatedAt",
                header: "Updated",
                mobileHide: true,
                cellClassName: "text-xs",
                render: (permission) => new Date(permission.updatedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
              },
            ]}
            rows={connectorPermissions}
            getRowKey={(permission) => permission.id}
            caption="Connector Permission Overrides"
            emptyState={<p className="text-sm text-slate-600">No connector-specific overrides are configured.</p>}
          />
        </div>
        <Link href="/admin/connectors" className="mt-3 inline-flex text-sm font-medium text-blue-700 hover:underline">
          Manage Overrides
        </Link>
      </Card>
    </div>
  );
}

import Link from "next/link";
import { redirect } from "next/navigation";
import {
  createAccessScopeAssignmentAction,
  createWorkspaceUserAction,
  deleteAccessScopeAssignmentAction,
  deactivateWorkspaceUserAction,
  lockWorkspaceUserAction,
  unlockWorkspaceUserAction,
  updateWorkspaceUserRoleAction,
} from "@/app/admin/users/actions";
import { Card, CardTitle } from "@/components/ui/card";
import { DataGrid } from "@/components/ui/data-grid";
import { InlineAlert } from "@/components/ui/inline-alert";
import { KpiCard } from "@/components/ui/kpi-card";
import { PageHeader } from "@/components/ui/page-header";
import { StatusChip } from "@/components/ui/status-chip";
import {
  ApiHttpError,
  getAccessScopeAssignments,
  getCachedBillingUsage,
  getConnectorPermissions,
  getWorkspaceUsers,
} from "@/lib/api";
import { buildLoginRedirect } from "@/lib/auth-redirect";
import { getServerSession, getServerSessionClaims } from "@/lib/server-session";

export const dynamic = "force-dynamic";

interface AdminUsersPageProps {
  searchParams: Promise<Record<string, string | undefined>>;
}

const rolePermissions = [
  { role: "Admin", catalog: "write", channels: "write", ops: "write", quality: "write", admin: "full" },
  { role: "Editor", catalog: "write", channels: "write", ops: "write", quality: "write", admin: "limited" },
  { role: "Reviewer", catalog: "read", channels: "read", ops: "read", quality: "approve", admin: "none" },
  { role: "Viewer", catalog: "read", channels: "read", ops: "read", quality: "read", admin: "none" },
];

const pilotRoleAlignment = [
  {
    persona: "Product admin",
    currentModel: "Admin",
    pilotHandling: "Workspace governance, catalog write, operations write, connector governance, users, API keys, webhooks, and audit logs.",
  },
  {
    persona: "System admin",
    currentModel: "Admin plus internal operator routes outside this customer shell",
    pilotHandling: "Customer shell keeps internal/developer routes hidden; full system-admin split remains future scope.",
  },
  {
    persona: "Editor",
    currentModel: "Editor",
    pilotHandling: "Catalog, import, bulk edit, connector setup, and quality triage write access without machine credential or audit-log administration.",
  },
  {
    persona: "Reviewer",
    currentModel: "Reviewer",
    pilotHandling: "Read-only catalog and operations review with explicit approval/rejection authority.",
  },
  {
    persona: "Vendor",
    currentModel: "Viewer plus delegated access scopes",
    pilotHandling: "Read-only frontend access; vendor-specific scoped write journeys remain future scope.",
  },
  {
    persona: "Category manager",
    currentModel: "Editor or reviewer plus delegated category/brand scopes",
    pilotHandling: "Scope assignments are visible here; dedicated category-manager navigation remains future scope.",
  },
  {
    persona: "API/client operations",
    currentModel: "Admin-issued API key with assigned role",
    pilotHandling: "Machine-principal access is managed from API Keys; scoped machine-principal UX remains future scope.",
  },
];

function toneForCapability(value: string) {
  if (value === "write") {
    return "success" as const;
  }
  if (value === "approve") {
    return "info" as const;
  }
  return "neutral" as const;
}

function getUserStatus(user: { isActive: boolean; isLocked: boolean }) {
  if (!user.isActive) {
    return { label: "inactive", tone: "neutral" as const };
  }
  if (user.isLocked) {
    return { label: "locked", tone: "danger" as const };
  }
  return { label: "active", tone: "success" as const };
}

function formatDateTime(value: string | null) {
  if (!value) {
    return "-";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "-";
  }
  return parsed.toLocaleString();
}

function resolveInviteFieldErrors(message: string) {
  const normalized = message.toLowerCase();
  return {
    userId: normalized.includes("user id"),
    role: normalized.includes("role"),
  };
}

export default async function AdminUsersPage({ searchParams }: AdminUsersPageProps) {
  const query = await searchParams;
  const { authHeader, actorRole } = await getServerSession();
  const claims = await getServerSessionClaims();
  const currentUserId = String(claims?.sub ?? "").trim().toLowerCase();
  const status = String(query.status ?? "").trim();
  const errorMessage = String(query.message ?? "").trim();
  const showInvite = String(query.showInvite ?? "").trim() === "true";
  const confirmDeactivateUserId = String(query.confirmDeactivate ?? "").trim();
  const canManageUsers = actorRole === "admin";
  const inviteFieldErrors = resolveInviteFieldErrors(errorMessage);

  try {
    const [usage, connectorPermissions, workspaceUsers, accessScopeAssignments] = await Promise.all([
      getCachedBillingUsage(actorRole, authHeader),
      getConnectorPermissions(undefined, { role: actorRole, authHeader }),
      getWorkspaceUsers({ role: actorRole, authHeader }),
      getAccessScopeAssignments({ role: actorRole, authHeader }),
    ]);

    const byPrincipalType = connectorPermissions.reduce<Record<string, number>>((acc, item) => {
      acc[item.principalType] = (acc[item.principalType] ?? 0) + 1;
      return acc;
    }, {});
    const activeUsers = workspaceUsers.filter((user) => user.isActive).length;
    const lockedUsers = workspaceUsers.filter((user) => user.isLocked && user.isActive).length;
    const adminUsers = workspaceUsers.filter((user) => user.role === "admin" && user.isActive).length;
    const atUserLimit = usage.users.current >= usage.users.limit;

    return (
      <div className="space-y-5">
        <PageHeader
          title="Users & Roles"
          description="Manage workspace access while keeping the role model and connector overrides visible in one place."
          breadcrumb={
            <>
              Dashboard / Admin / <span className="font-semibold text-slate-700">Users & Roles</span>
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
                  <Link
                    href={showInvite ? "/admin/users" : "/admin/users?showInvite=true"}
                    className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
                  >
                    {showInvite ? "Close Invite" : "Invite User"}
                  </Link>
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

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <KpiCard label="User Limit" value={`${usage.users.current}/${usage.users.limit}`} />
          <KpiCard label="Role Profiles" value={rolePermissions.length} />
          <KpiCard label="Connector Overrides" value={connectorPermissions.length} tone="info" />
          <KpiCard
            label="User Principals"
            value={byPrincipalType.user ?? 0}
            helper={`Role principals: ${byPrincipalType.role ?? 0}`}
          />
          <KpiCard label="Delegated Scopes" value={accessScopeAssignments.length} tone="info" />
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
            <form action={createWorkspaceUserAction} className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1.5fr)_220px_auto] md:items-end">
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
                  <option value="admin">Admin — full governance, users, API keys, and connector management</option>
                  <option value="editor">Editor — manage catalog, imports, and product data</option>
                  <option value="reviewer">Reviewer — read-only catalog with approval authority</option>
                  <option value="viewer">Viewer — read-only access to catalog and reporting</option>
                </select>
                {status === "user-error" && inviteFieldErrors.role ? (
                  <p id="workspace-user-role-error" className="text-xs text-red-700">{errorMessage}</p>
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

        <Card id="workspace-users" className="scroll-mt-24">
          <CardTitle>Workspace Users</CardTitle>
          <p className="mt-2 text-sm text-slate-600">
            Review tenant access, role ownership, and account state in one queue before making lifecycle changes.
          </p>
          <div className="mt-2">
            <DataGrid
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
                    return canManageUsers ? (
                      <form action={updateWorkspaceUserRoleAction} className="flex items-center gap-2">
                        <input type="hidden" name="userId" value={user.userId} />
                        <select
                          name="role"
                          defaultValue={user.role}
                          className="rounded-md border border-slate-300 px-2 py-2 text-sm"
                          disabled={isSelf}
                        >
                          <option value="admin">Admin</option>
                          <option value="editor">Editor</option>
                          <option value="reviewer">Reviewer</option>
                          <option value="viewer">Viewer</option>
                        </select>
                        <button
                          type="submit"
                          className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                          disabled={isSelf}
                        >
                          Save
                        </button>
                      </form>
                    ) : (
                      <StatusChip label={user.role} tone="info" />
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
                      {user.lastSignInAt ? formatDateTime(user.lastSignInAt) : "—"}
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
                          <form action={lockWorkspaceUserAction}>
                            <input type="hidden" name="userId" value={user.userId} />
                            <input type="hidden" name="durationMinutes" value="60" />
                            <button
                              type="submit"
                              className="rounded-md border border-amber-300 px-3 py-2 text-sm font-medium text-amber-800 hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-60"
                              disabled={isSelf || !user.isActive}
                            >
                              Lock 60m
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
              rows={workspaceUsers}
              getRowKey={(user) => user.id}
              caption="Workspace Users"
              emptyState={<p className="text-sm text-slate-600">No users yet. Invite the first user above.</p>}
            />
          </div>
        </Card>

        <Card>
          <CardTitle>Delegated Access Scopes</CardTitle>
          <p className="mt-2 text-sm text-slate-600">
            Admin-only delegated scope assignments constrain non-admin access by category, brand, channel, and connector account.
          </p>
          {canManageUsers ? (
            <form action={createAccessScopeAssignmentAction} className="mt-4 grid gap-3 md:grid-cols-6">
              <label className="grid gap-1 text-sm">
                <span className="font-medium text-slate-700">Subject Type</span>
                <select name="subjectType" defaultValue="user" className="rounded-md border border-slate-300 px-3 py-2">
                  <option value="user">User</option>
                  <option value="role">Role</option>
                </select>
              </label>
              <label className="grid gap-1 text-sm">
                <span className="font-medium text-slate-700">Subject ID</span>
                <input type="text" name="subjectId" placeholder="user@example.com or editor" className="rounded-md border border-slate-300 px-3 py-2" required />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="font-medium text-slate-700">Scope Type</span>
                <select name="scopeType" defaultValue="category" className="rounded-md border border-slate-300 px-3 py-2">
                  <option value="category">Category</option>
                  <option value="brand">Brand</option>
                  <option value="channel">Channel</option>
                  <option value="connector_account">Connector Account</option>
                </select>
              </label>
              <label className="grid gap-1 text-sm">
                <span className="font-medium text-slate-700">Category ID</span>
                <input type="text" name="categoryId" placeholder="Category scope" className="rounded-md border border-slate-300 px-3 py-2" />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="font-medium text-slate-700">Scope Value</span>
                <input type="text" name="scopeValue" placeholder="Brand or channel" className="rounded-md border border-slate-300 px-3 py-2" />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="font-medium text-slate-700">Connector Installation</span>
                <input type="text" name="connectorInstallationId" placeholder="Connector account scope" className="rounded-md border border-slate-300 px-3 py-2" />
              </label>
              <label className="grid gap-1 text-sm md:col-span-5">
                <span className="font-medium text-slate-700">Actions</span>
                <input
                  type="text"
                  name="actions"
                  placeholder="Comma-separated action list, or leave blank for all scoped actions"
                  className="rounded-md border border-slate-300 px-3 py-2"
                />
              </label>
              <div className="md:col-span-1 md:flex md:items-end">
                <button type="submit" className="w-full rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800">
                  Assign Scope
                </button>
              </div>
            </form>
          ) : null}
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
                {
                  key: "scopeType",
                  header: "Scope",
                },
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
          <CardTitle>Pilot Role Alignment</CardTitle>
          <p className="mt-2 text-sm text-slate-600">
            The web app currently uses four first-class roles. Enterprise persona names are handled through those roles
            plus delegated access scopes until dedicated vendor, category-manager, and system-admin shells are released.
          </p>
          <div className="mt-3">
            <DataGrid
              columns={[
                { key: "persona", header: "Enterprise Persona", cellClassName: "font-medium text-slate-900" },
                { key: "currentModel", header: "Current Web Model", cellClassName: "text-slate-700" },
                { key: "pilotHandling", header: "Pilot Handling", cellClassName: "text-slate-600" },
              ]}
              rows={pilotRoleAlignment}
              getRowKey={(entry) => entry.persona}
              caption="Pilot Role Alignment"
            />
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
              rows={rolePermissions}
              getRowKey={(entry) => entry.role}
              caption="Role Matrix"
            />
          </div>
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
                  render: (permission) => new Date(permission.updatedAt).toLocaleString(),
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
  } catch (error: unknown) {
    if (error instanceof ApiHttpError && (error.status === 401 || error.status === 403)) {
      redirect(buildLoginRedirect("/admin/users", error));
    }
    throw error;
  }
}

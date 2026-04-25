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
import { KpiCard } from "@/components/ui/kpi-card";
import { PageHeader } from "@/components/ui/page-header";
import { StatusChip } from "@/components/ui/status-chip";
import {
  ApiHttpError,
  getAccessScopeAssignments,
  getBillingUsage,
  getConnectorPermissions,
  getWorkspaceUsers,
} from "@/lib/api";
import { buildLoginRedirect } from "@/lib/auth-redirect";
import { getServerAuthHeader } from "@/lib/server-auth";
import { getServerActorRole, getServerSessionClaims } from "@/lib/server-session";

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

function toneForCapability(value: string) {
  if (value === "write") {
    return "success" as const;
  }
  if (value === "approve") {
    return "info" as const;
  }
  return "neutral" as const;
}

function StatusBanner({ tone, message }: { tone: "success" | "error"; message: string }) {
  const classes =
    tone === "success"
      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
      : "border-rose-200 bg-rose-50 text-rose-800";
  return <div className={`rounded-md border px-3 py-2 text-sm ${classes}`}>{message}</div>;
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

export default async function AdminUsersPage({ searchParams }: AdminUsersPageProps) {
  const query = await searchParams;
  const authHeader = await getServerAuthHeader();
  const actorRole = await getServerActorRole();
  const claims = await getServerSessionClaims();
  const currentUserId = String(claims?.sub ?? "").trim().toLowerCase();
  const status = String(query.status ?? "").trim();
  const errorMessage = String(query.message ?? "").trim();
  const showInvite = String(query.showInvite ?? "").trim() === "true";
  const canManageUsers = actorRole === "admin";

  try {
    const [usage, connectorPermissions, workspaceUsers, accessScopeAssignments] = await Promise.all([
      getBillingUsage({ role: actorRole, authHeader }),
      getConnectorPermissions(undefined, { role: actorRole, authHeader }),
      getWorkspaceUsers({ role: actorRole, authHeader }),
      getAccessScopeAssignments({ role: actorRole, authHeader }),
    ]);

    const byPrincipalType = connectorPermissions.reduce<Record<string, number>>((acc, item) => {
      acc[item.principalType] = (acc[item.principalType] ?? 0) + 1;
      return acc;
    }, {});

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
                <Link
                  href={showInvite ? "/admin/users" : "/admin/users?showInvite=true"}
                  className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
                >
                  {showInvite ? "Close Invite" : "Invite User"}
                </Link>
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

        {status === "user-error" ? (
          <StatusBanner tone="error" message={errorMessage || "Unable to update workspace user."} />
        ) : null}
        {status === "user-created" ? <StatusBanner tone="success" message="Workspace user invited." /> : null}
        {status === "role-updated" ? <StatusBanner tone="success" message="Workspace user role updated." /> : null}
        {status === "user-locked" ? <StatusBanner tone="success" message="Workspace user locked." /> : null}
        {status === "user-unlocked" ? <StatusBanner tone="success" message="Workspace user unlocked." /> : null}
        {status === "user-deactivated" ? <StatusBanner tone="success" message="Workspace user deactivated." /> : null}
        {status === "scope-created" ? <StatusBanner tone="success" message="Delegated access scope assigned." /> : null}
        {status === "scope-deleted" ? <StatusBanner tone="success" message="Delegated access scope removed." /> : null}

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
              Add a workspace user with editor, reviewer, or viewer access. Admin promotion stays explicit after the user exists.
            </p>
            <form action={createWorkspaceUserAction} className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1.5fr)_220px_auto] md:items-end">
              <input type="hidden" name="errorRedirectTo" value="/admin/users?showInvite=true" />
              <label className="grid gap-1 text-sm">
                <span className="font-medium text-slate-700">User ID</span>
                <input
                  type="text"
                  name="userId"
                  placeholder="name@example.com"
                  className="rounded-md border border-slate-300 px-3 py-2"
                  required
                />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="font-medium text-slate-700">Role</span>
                <select name="role" defaultValue="viewer" className="rounded-md border border-slate-300 px-3 py-2">
                  <option value="editor">Editor</option>
                  <option value="reviewer">Reviewer</option>
                  <option value="viewer">Viewer</option>
                </select>
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
          <CardTitle>Workspace Users</CardTitle>
          {workspaceUsers.length === 0 ? (
            <p className="mt-2 text-sm text-slate-600">No users yet. Invite the first user above.</p>
          ) : (
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[980px] text-left text-sm">
                <thead className="text-xs uppercase text-slate-500">
                  <tr>
                    <th className="py-2">User ID</th>
                    <th className="py-2">Role</th>
                    <th className="py-2">Status</th>
                    <th className="py-2">Locked Until</th>
                    <th className="py-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {workspaceUsers.map((user) => {
                    const statusChip = getUserStatus(user);
                    const isSelf = user.userId === currentUserId;

                    return (
                      <tr key={user.id} className="border-t border-slate-200">
                        <td className="py-2">
                          <div className="space-y-1">
                            <p className="font-medium text-slate-900">{user.userId}</p>
                            <p className="text-xs text-slate-500">Created {formatDateTime(user.createdAt)}</p>
                          </div>
                        </td>
                        <td className="py-2">
                          {canManageUsers ? (
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
                          )}
                        </td>
                        <td className="py-2">
                          <StatusChip label={statusChip.label} tone={statusChip.tone} />
                        </td>
                        <td className="py-2 text-slate-600">{formatDateTime(user.lockedUntil)}</td>
                        <td className="py-2">
                          {canManageUsers ? (
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
                              <form action={deactivateWorkspaceUserAction}>
                                <input type="hidden" name="userId" value={user.userId} />
                                <button
                                  type="submit"
                                  className="rounded-md border border-rose-300 px-3 py-2 text-sm font-medium text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
                                  disabled={isSelf || !user.isActive}
                                >
                                  Deactivate
                                </button>
                              </form>
                            </div>
                          ) : (
                            <span className="text-xs text-slate-500">Read-only</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
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
          {accessScopeAssignments.length === 0 ? (
            <p className="mt-3 text-sm text-slate-600">No delegated access assignments are configured.</p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[980px] text-left text-sm">
                <thead className="text-xs uppercase text-slate-500">
                  <tr>
                    <th className="py-2">Subject</th>
                    <th className="py-2">Scope</th>
                    <th className="py-2">Value</th>
                    <th className="py-2">Actions</th>
                    <th className="py-2">Updated</th>
                    <th className="py-2">Admin</th>
                  </tr>
                </thead>
                <tbody>
                  {accessScopeAssignments.map((assignment) => (
                    <tr key={assignment.id} className="border-t border-slate-200">
                      <td className="py-2">
                        <div className="space-y-1">
                          <p className="font-medium text-slate-900">{assignment.subjectId}</p>
                          <p className="text-xs text-slate-500">{assignment.subjectType}</p>
                        </div>
                      </td>
                      <td className="py-2">{assignment.scopeType}</td>
                      <td className="py-2 text-slate-600">
                        {assignment.categoryPath ?? assignment.connectorAccountAlias ?? assignment.scopeValue ?? assignment.categoryId ?? assignment.connectorInstallationId ?? "-"}
                      </td>
                      <td className="py-2 text-slate-600">{assignment.actions.length > 0 ? assignment.actions.join(", ") : "all"}</td>
                      <td className="py-2 text-slate-600">{formatDateTime(assignment.updatedAt)}</td>
                      <td className="py-2">
                        {canManageUsers ? (
                          <form action={deleteAccessScopeAssignmentAction}>
                            <input type="hidden" name="assignmentId" value={assignment.id} />
                            <button type="submit" className="rounded-md border border-rose-300 px-3 py-2 text-sm font-medium text-rose-700 hover:bg-rose-50">
                              Remove
                            </button>
                          </form>
                        ) : (
                          <span className="text-xs text-slate-500">Read-only</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card>
          <CardTitle>Role Matrix</CardTitle>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[700px] text-left text-sm">
              <thead className="text-xs uppercase text-slate-500">
                <tr>
                  <th className="py-2">Role</th>
                  <th className="py-2">Catalog</th>
                  <th className="py-2">Channels</th>
                  <th className="py-2">Operations</th>
                  <th className="py-2">Quality</th>
                  <th className="py-2">Admin</th>
                </tr>
              </thead>
              <tbody>
                {rolePermissions.map((entry) => (
                  <tr key={entry.role} className="border-t border-slate-200">
                    <td className="py-2 font-medium text-slate-900">{entry.role}</td>
                    <td className="py-2"><StatusChip label={entry.catalog} tone={toneForCapability(entry.catalog)} /></td>
                    <td className="py-2"><StatusChip label={entry.channels} tone={toneForCapability(entry.channels)} /></td>
                    <td className="py-2"><StatusChip label={entry.ops} tone={toneForCapability(entry.ops)} /></td>
                    <td className="py-2"><StatusChip label={entry.quality} tone={toneForCapability(entry.quality)} /></td>
                    <td className="py-2"><StatusChip label={entry.admin} tone={entry.admin === "full" ? "info" : entry.admin === "none" ? "neutral" : "warning"} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card>
          <CardTitle>Connector Permission Overrides</CardTitle>
          {connectorPermissions.length === 0 ? (
            <p className="mt-2 text-sm text-slate-600">No connector-specific overrides are configured.</p>
          ) : (
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[900px] text-left text-sm">
                <thead className="text-xs uppercase text-slate-500">
                  <tr>
                    <th className="py-2">Principal</th>
                    <th className="py-2">Type</th>
                    <th className="py-2">Connector</th>
                    <th className="py-2">Action</th>
                    <th className="py-2">Alias</th>
                    <th className="py-2">Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {connectorPermissions.map((permission) => (
                    <tr key={permission.id} className="border-t border-slate-200">
                      <td className="py-2 font-medium text-slate-900">{permission.principalId}</td>
                      <td className="py-2">{permission.principalType}</td>
                      <td className="py-2">{permission.connectorSlug}</td>
                      <td className="py-2">{permission.action}</td>
                      <td className="py-2">{permission.accountAlias}</td>
                      <td className="py-2 text-xs">{new Date(permission.updatedAt).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
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

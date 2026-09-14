import Link from "next/link";
import { redirect } from "next/navigation";
import { AdminUsersPageContent } from "./_components/admin-users-page-content";
import {
  ApiHttpError,
  getAccessScopeAssignments,
  getBillingUsage,
  getConnectorPermissions,
  getTenantAuthPolicy,
  getRoleCapabilities,
  getWorkspaceUsers,
  getWorkspaceUserStats,
  getWorkspaceUserLookup,
  type TenantAuthPolicy,
} from "@/lib/api";
import { buildLoginRedirect } from "@/lib/auth-redirect";
import { getServerSession, getServerSessionClaims } from "@/lib/server-session";
import { isSystemAdminBoundary } from "@/lib/role-capabilities";
import { PageHeader } from "@/components/ui/page-header";
import { SystemAdminRequiredCard } from "@/components/ui/system-admin-required-card";

export const dynamic = "force-dynamic";

interface AdminUsersPageProps {
  searchParams: Promise<Record<string, string | undefined>>;
}

function isAuthPolicyApiUnavailable(error: unknown): boolean {
  if (error instanceof ApiHttpError) {
    return error.status === 502 || error.status === 503 || error.status === 504;
  }
  if (!(error instanceof Error)) {
    return false;
  }
  const message = error.message.toLowerCase();
  const cause = "cause" in error ? (error as { cause?: unknown }).cause : undefined;
  const causeDetails =
    cause && typeof cause === "object"
      ? `${String((cause as { code?: unknown }).code ?? "")} ${String((cause as { message?: unknown }).message ?? "")}`.toLowerCase()
      : String(cause ?? "").toLowerCase();
  return (
    message.includes("fetch failed") ||
    causeDetails.includes("econnrefused") ||
    causeDetails.includes("enotfound") ||
    causeDetails.includes("socket hang up")
  );
}

export default async function AdminUsersPage({ searchParams }: AdminUsersPageProps) {
  const query = await searchParams;
  const { authHeader, actorRole, adminBoundaryRoles } = await getServerSession();
  if (!isSystemAdminBoundary(adminBoundaryRoles) && actorRole !== "admin") {
    return (
      <div className="space-y-5">
        <PageHeader
          title="Users"
          description="Workspace member roster, roles, and access."
          breadcrumb={
            <>
              <Link href="/dashboard" className="hover:underline">Dashboard</Link>{" / "}<Link href="/admin" className="hover:underline">Admin</Link>{" / "}<span className="font-semibold text-slate-700">Users</span>
            </>
          }
        />
        <SystemAdminRequiredCard surfaceLabel="User management" />
      </div>
    );
  }
  const claims = await getServerSessionClaims();
  const currentUserId = String(claims?.sub ?? "").trim().toLowerCase();
  const canManageUsers = actorRole === "admin";

  try {
    const [usage, connectorPermissions, workspaceUsers, accessScopeAssignments, capabilities, workspaceUserStats] = await Promise.all([
      getBillingUsage({ role: actorRole, authHeader }),
      getConnectorPermissions(undefined, { role: actorRole, authHeader }),
      getWorkspaceUsers({ role: actorRole, authHeader }),
      getAccessScopeAssignments({ role: actorRole, authHeader }),
      getRoleCapabilities({ role: actorRole, authHeader }),
      getWorkspaceUserStats({ role: actorRole, authHeader }),
    ]);

    let authPolicy: TenantAuthPolicy | null = null;
    let authPolicyUnavailable = false;
    try {
      authPolicy = await getTenantAuthPolicy({ role: actorRole, authHeader });
    } catch (error: unknown) {
      if (error instanceof ApiHttpError && (error.status === 401 || error.status === 403)) {
        redirect(buildLoginRedirect("/admin/users", error));
      }
      if (!isAuthPolicyApiUnavailable(error)) {
        throw error;
      }
      authPolicyUnavailable = true;
    }

    const byPrincipalType = connectorPermissions.reduce<Record<string, number>>((acc, item) => {
      acc[item.principalType] = (acc[item.principalType] ?? 0) + 1;
      return acc;
    }, {});
    // Real, unbounded counts from the API — not workspaceUsers.filter(...), which
    // only sees the 1,000 most recently created identities and can silently
    // undercount in a tenant with more than that (see #816/#819, #823). The
    // roster table below still renders from the capped workspaceUsers list —
    // paginating that is a separate UX decision, tracked in #823.
    const activeUsers = workspaceUserStats.activeUsers;
    const lockedUsers = workspaceUserStats.lockedUsers;
    const adminUsers = workspaceUserStats.adminUsers;
    const mfaEnrolledCount = workspaceUserStats.mfaEnrolledCount;
    const mfaUnenrolledCount = activeUsers - mfaEnrolledCount;
    const atUserLimit = usage.users.current >= usage.users.limit;

    const lookupUserId = String(query.lookupUserId ?? "").trim();
    const lookupResult = lookupUserId
      ? (await getWorkspaceUserLookup(lookupUserId, { role: actorRole, authHeader })).user
      : undefined;

    return (
      <AdminUsersPageContent
        query={query}
        currentUserId={currentUserId}
        canManageUsers={canManageUsers}
        usage={usage}
        connectorPermissions={connectorPermissions}
        workspaceUsers={workspaceUsers}
        accessScopeAssignments={accessScopeAssignments}
        capabilities={capabilities}
        authPolicy={authPolicy}
        authPolicyUnavailable={authPolicyUnavailable}
        byPrincipalType={byPrincipalType}
        activeUsers={activeUsers}
        lockedUsers={lockedUsers}
        adminUsers={adminUsers}
        mfaEnrolledCount={mfaEnrolledCount}
        mfaUnenrolledCount={mfaUnenrolledCount}
        atUserLimit={atUserLimit}
        lookupUserId={lookupUserId}
        lookupResult={lookupResult}
      />
    );
  } catch (error: unknown) {
    if (error instanceof ApiHttpError && (error.status === 401 || error.status === 403)) {
      redirect(buildLoginRedirect("/admin/users", error));
    }
    throw error;
  }
}

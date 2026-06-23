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
  type TenantAuthPolicy,
} from "@/lib/api";
import { buildLoginRedirect } from "@/lib/auth-redirect";
import { getServerSession, getServerSessionClaims } from "@/lib/server-session";

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
  const isSystemAdmin = adminBoundaryRoles.includes("system_admin") || adminBoundaryRoles.includes("super_admin");
  if (actorRole !== "admin" || !isSystemAdmin) {
    redirect("/admin");
  }
  const claims = await getServerSessionClaims();
  const currentUserId = String(claims?.sub ?? "").trim().toLowerCase();
  const canManageUsers = actorRole === "admin";

  try {
    const [usage, connectorPermissions, workspaceUsers, accessScopeAssignments, capabilities] = await Promise.all([
      getBillingUsage({ role: actorRole, authHeader }),
      getConnectorPermissions(undefined, { role: actorRole, authHeader }),
      getWorkspaceUsers({ role: actorRole, authHeader }),
      getAccessScopeAssignments({ role: actorRole, authHeader }),
      getRoleCapabilities({ role: actorRole, authHeader }),
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
    const activeUsers = workspaceUsers.filter((user) => user.isActive).length;
    const lockedUsers = workspaceUsers.filter((user) => user.isLocked && user.isActive).length;
    const adminUsers = workspaceUsers.filter((user) => user.role === "admin" && user.isActive).length;
    const mfaEnrolledCount = workspaceUsers.filter((user) => user.mfaEnrolled && user.isActive).length;
    const mfaUnenrolledCount = activeUsers - mfaEnrolledCount;
    const atUserLimit = usage.users.current >= usage.users.limit;

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
      />
    );
  } catch (error: unknown) {
    if (error instanceof ApiHttpError && (error.status === 401 || error.status === 403)) {
      redirect(buildLoginRedirect("/admin/users", error));
    }
    throw error;
  }
}

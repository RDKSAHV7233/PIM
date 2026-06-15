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

const DEFAULT_TENANT_AUTH_POLICY: TenantAuthPolicy = {
  id: null,
  tenantKey: "",
  externalIdentityMode: false,
  mfaRequired: false,
  mfaGracePeriodDays: 0,
  sessionTimeoutMinutes: 0,
  allowedAuthMethods: ["password"],
  isPersisted: false,
  createdBy: null,
  updatedBy: null,
  createdAt: null,
  updatedAt: null,
  runtimeApplied: {
    sessionTimeout: false,
    mfaEnrollment: false,
    externalIdentity: false,
  },
};

interface AdminUsersPageProps {
  searchParams: Promise<Record<string, string | undefined>>;
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

    let authPolicy: TenantAuthPolicy = {
      ...DEFAULT_TENANT_AUTH_POLICY,
      tenantKey: usage.profile.tenantKey,
    };
    try {
      authPolicy = await getTenantAuthPolicy({ role: actorRole, authHeader });
    } catch (error: unknown) {
      if (error instanceof ApiHttpError && (error.status === 401 || error.status === 403)) {
        redirect(buildLoginRedirect("/admin/users", error));
      }
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

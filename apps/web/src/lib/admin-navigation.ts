import type { AppRole } from "@/lib/api";

export type AdminNavigationAudience =
  | "all"
  | "editor_plus"
  | "channel_manager_plus"
  | "connector_admin_plus"
  | "approval_decider"
  | "admin"
  | "system_admin_gated";

export function canViewAdminNavigationItem(
  role: AppRole,
  audience: AdminNavigationAudience = "all",
  adminBoundaryRoles: readonly string[] = [],
): boolean {
  const isSuperAdmin = adminBoundaryRoles.includes("super_admin");
  const isSystemAdmin = adminBoundaryRoles.includes("system_admin");
  const isProductAdmin = adminBoundaryRoles.includes("product_admin");

  if (isSuperAdmin) return true;

  if (audience === "all") return true;
  if (audience === "editor_plus") {
    return role === "admin" || role === "editor" || isSystemAdmin || isProductAdmin;
  }
  if (audience === "channel_manager_plus") {
    return role === "admin" || role === "editor" || role === "channel_manager" || isSystemAdmin || isProductAdmin;
  }
  if (audience === "connector_admin_plus") {
    return role === "admin" || role === "editor" || role === "connector_admin" || isSystemAdmin || isProductAdmin;
  }
  if (audience === "approval_decider") {
    return role === "admin" || role === "approver" || role === "reviewer" || isSystemAdmin || isProductAdmin;
  }
  if (audience === "system_admin_gated") {
    return isSystemAdmin;
  }
  // "admin"
  return role === "admin" || isSystemAdmin;
}

export function describeAdminAccess(role: AppRole, adminBoundaryRoles: readonly string[] = []) {
  const isSystemAdmin = adminBoundaryRoles.includes("system_admin");
  const isProductAdmin = adminBoundaryRoles.includes("product_admin");
  const isSuperAdmin = adminBoundaryRoles.includes("super_admin");

  if (isSuperAdmin) {
    return {
      title: "Super admin access",
      body: "You have unrestricted access to all workspace governance, security, user management, and platform controls.",
    };
  }
  if (isSystemAdmin && !isProductAdmin) {
    return {
      title: "System admin access",
      body: "You can manage workspace users and roles, API keys, auth policy, OIDC/SSO, outbound webhooks, and audit logs. Product catalog operations remain with product-side roles.",
    };
  }
  if (isProductAdmin && !isSystemAdmin) {
    return {
      title: "Product admin access",
      body: "You can manage the full product catalog, channels, connectors, compliance settings, and plan usage. User account management stays with the system admin role.",
    };
  }
  if (isSystemAdmin && isProductAdmin) {
    return {
      title: "Full admin access (via boundary roles)",
      body: "You hold both product admin and system admin boundary roles, giving you access to all product operations and workspace governance tools.",
    };
  }
  if (role === "admin") {
    return {
      title: "Full admin access",
      body: "You can manage workspace governance, machine credentials, integration delivery, and audit follow-up from this area.",
    };
  }
  if (role === "editor") {
    return {
      title: "Limited admin access",
      body: "You can review plan usage, workspace users, connector access, and your own privacy status here. Admin-only tools like API keys, outbound webhooks, and audit logs stay hidden.",
    };
  }
  if (role === "connector_admin") {
    return {
      title: "Connector admin access",
      body: "You can manage connector permissions, account aliases, and integration access policies. Workspace-level governance and audit logs remain admin-only.",
    };
  }
  return {
    title: "Privacy-only access",
    body: "You can review your account privacy status here. Ask a workspace admin if you need elevated access.",
  };
}

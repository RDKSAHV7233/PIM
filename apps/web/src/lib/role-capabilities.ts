import type { AppRole } from "@/lib/api";

export function canEditWorkspace(role: AppRole): boolean {
  return role === "admin" || role === "editor";
}

export function canManageChannels(role: AppRole): boolean {
  return role === "admin" || role === "editor" || role === "channel_manager";
}

export function canPublishToChannels(role: AppRole): boolean {
  return role === "admin" || role === "publisher" || role === "channel_manager";
}

export function canViewPricing(role: AppRole): boolean {
  return ["admin", "editor", "approver", "publisher", "channel_manager", "viewer"].includes(role);
}

export function canEditPricing(role: AppRole): boolean {
  return role === "admin" || role === "editor";
}

export function canManageConnectors(role: AppRole): boolean {
  return role === "admin" || role === "editor" || role === "connector_admin";
}

// Narrower than canManageConnectors: editor is deliberately excluded here.
// Replacing a connector's persistent external-account secrets is a
// higher-privilege action than replacing a session (matches the backend's
// @Roles("admin", "connector_admin") on PATCH /connectors/:id/credentials).
export function canEditConnectorCredentials(role: AppRole): boolean {
  return role === "admin" || role === "connector_admin";
}

export function canResolveIssueInboxWarnings(role: AppRole): boolean {
  return role === "admin" || role === "editor";
}

export function canDecideApproval(role: AppRole): boolean {
  return role === "admin" || role === "approver" || role === "reviewer";
}

export function canManageApprovalWorkflow(role: AppRole): boolean {
  return role === "admin" || role === "editor" || role === "approver";
}

export function canViewConnectors(role: AppRole): boolean {
  return true;
}

export function isReadOnlyRole(role: AppRole): boolean {
  return !canEditWorkspace(role);
}

// System-admin-gated pages (API keys, users, webhooks, audit, commercial ops,
// OIDC/SSO, auth policy) require a boundary role on top of the workspace
// `role`. This is orthogonal to the can<Action>() checks above, which only
// look at `role` — see apps/web/src/lib/server-session.ts for where
// adminBoundaryRoles comes from.
export function isSystemAdminBoundary(adminBoundaryRoles: readonly string[]): boolean {
  return adminBoundaryRoles.includes("system_admin") || adminBoundaryRoles.includes("super_admin");
}

export function canAccessCommercialOperations(input: {
  actorRole: string;
  adminBoundaryRoles: readonly string[];
}): boolean {
  return input.actorRole === "admin" && isSystemAdminBoundary(input.adminBoundaryRoles);
}

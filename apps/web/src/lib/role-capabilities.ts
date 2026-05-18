import type { AppRole } from "@/lib/api";

export function canEditWorkspace(role: AppRole): boolean {
  return role === "admin" || role === "editor";
}

export function canManageChannels(role: AppRole): boolean {
  return role === "admin" || role === "editor" || role === "channel_manager";
}

export function canManageConnectors(role: AppRole): boolean {
  return role === "admin" || role === "editor" || role === "connector_admin";
}

export function canResolveIssueInboxWarnings(role: AppRole): boolean {
  return role === "admin" || role === "editor";
}

export function canDecideApproval(role: AppRole): boolean {
  return role === "admin" || role === "editor" || role === "approver" || role === "reviewer";
}

export function isReadOnlyRole(role: AppRole): boolean {
  return !canEditWorkspace(role);
}

import type { AppRole } from "@/lib/api";

export function canEditWorkspace(role: AppRole): boolean {
  return role === "admin" || role === "editor";
}

export function canManageChannels(role: AppRole): boolean {
  return role === "admin" || role === "editor";
}

export function canManageConnectors(role: AppRole): boolean {
  return role === "admin" || role === "editor";
}

export function canResolveIssueInboxWarnings(role: AppRole): boolean {
  return role === "admin" || role === "editor";
}

export function canDecideApproval(role: AppRole): boolean {
  return role === "admin" || role === "editor" || role === "reviewer";
}

export function canViewConnectors(role: AppRole): boolean {
  return true;
}

export function isReadOnlyRole(role: AppRole): boolean {
  return !canEditWorkspace(role);
}

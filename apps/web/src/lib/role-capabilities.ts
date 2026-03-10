import type { AppRole } from "@/lib/api";

export function canEditWorkspace(role: AppRole): boolean {
  return role === "admin" || role === "editor";
}

export function canResolveIssueInboxWarnings(role: AppRole): boolean {
  return role === "admin" || role === "editor";
}

export function canDecideApproval(role: AppRole): boolean {
  return role === "admin" || role === "editor" || role === "reviewer";
}

export function isReadOnlyRole(role: AppRole): boolean {
  return !canEditWorkspace(role);
}

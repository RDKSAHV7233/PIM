import type { AppRole } from "@/lib/api";

export type AdminNavigationAudience = "all" | "editor_plus" | "admin";

export function canViewAdminNavigationItem(
  role: AppRole,
  audience: AdminNavigationAudience = "all",
): boolean {
  if (audience === "all") {
    return true;
  }
  if (audience === "editor_plus") {
    return role === "admin" || role === "editor";
  }
  return role === "admin";
}

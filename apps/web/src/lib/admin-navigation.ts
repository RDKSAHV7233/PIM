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

export function describeAdminAccess(role: AppRole) {
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
  return {
    title: "Privacy-only access",
    body: "Your current role can only review signed-in-account privacy status here. Ask a workspace admin if you need plan, user, connector, or audit changes.",
  };
}

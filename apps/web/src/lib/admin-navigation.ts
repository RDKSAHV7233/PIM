import type { AppRole } from "@/lib/api";

export type AdminNavigationAudience = "all" | "editor_plus" | "connector_admin_plus" | "admin";

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
  if (audience === "connector_admin_plus") {
    return role === "admin" || role === "editor" || role === "connector_admin" || role === "channel_manager";
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
  if (role === "connector_admin") {
    return {
      title: "Connector admin access",
      body: "You can manage connector installations, credentials, and permission grants from this area.",
    };
  }
  if (role === "channel_manager") {
    return {
      title: "Channel manager access",
      body: "You can view and manage connector access permissions from this area.",
    };
  }
  if (role === "publisher") {
    return {
      title: "Publisher access",
      body: "You can review your account privacy status here. Publishing actions are available in the Channels section.",
    };
  }
  if (role === "approver") {
    return {
      title: "Approver access",
      body: "You can review your account privacy status here. Approval actions are available in the Catalog section.",
    };
  }
  if (role === "reviewer") {
    return {
      title: "Reviewer access",
      body: "You can review your account privacy status here. Use the Catalog section to view and comment on products.",
    };
  }
  return {
    title: "Viewer access",
    body: "You can review your account privacy status here. Ask a workspace admin if you need elevated access.",
  };
}

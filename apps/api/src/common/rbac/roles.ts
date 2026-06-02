import { SetMetadata } from "@nestjs/common";

export const APP_ROLES = ["admin", "editor", "publisher", "approver", "channel_manager", "connector_admin", "reviewer", "viewer"] as const;
export type AppRole = (typeof APP_ROLES)[number];
export const ADMIN_BOUNDARY_ROLES = ["product_admin", "system_admin", "super_admin"] as const;
export type AdminBoundaryRole = (typeof ADMIN_BOUNDARY_ROLES)[number];
export const BLOCKED_FOUNDATION_ROLES = ["category_manager", "vendor"] as const;
export type BlockedFoundationRole = (typeof BLOCKED_FOUNDATION_ROLES)[number];
export const FOUNDATION_ROLES = [...APP_ROLES, ...ADMIN_BOUNDARY_ROLES, ...BLOCKED_FOUNDATION_ROLES] as const;
export type FoundationRole = (typeof FOUNDATION_ROLES)[number];
export const APP_ROLE_PRECEDENCE: readonly AppRole[] = ["admin", "editor", "publisher", "approver", "channel_manager", "connector_admin", "reviewer", "viewer"];

export const ROLES_KEY = "required_roles";
export const DEFAULT_WRITE_ROLES: readonly AppRole[] = ["admin", "editor"];

// Enterprise role capabilities — used for UI display and policy documentation
export const ENTERPRISE_ROLE_CAPABILITIES: Record<AppRole, string> = {
  admin: "Full access to all product, channel, connector, and workspace operations",
  editor: "Edit catalog, import products, manage categories and attributes, publish to channels",
  publisher: "Publish approved products to channels; cannot edit catalog content",
  approver: "Approve or reject products in review; cannot edit catalog content",
  channel_manager: "Manage channel mappings, connector configurations, and readiness gates",
  connector_admin: "Install, configure, and manage connector credentials and installations",
  reviewer: "Read catalog and submission data, add comments",
  viewer: "Read-only access to catalog and reporting",
};

export const Roles = (...roles: AppRole[]) => SetMetadata(ROLES_KEY, roles);

/** Per-domain capability matrix for all eight app roles. Used by admin/users UI. */
export const ROLE_PERMISSION_MATRIX = [
  { role: "Admin",           catalog: "write",   channels: "write",   ops: "write", quality: "write",   admin: "full" },
  { role: "Editor",          catalog: "write",   channels: "write",   ops: "write", quality: "write",   admin: "limited" },
  { role: "Publisher",       catalog: "read",    channels: "publish", ops: "read",  quality: "read",    admin: "none" },
  { role: "Approver",        catalog: "read",    channels: "read",    ops: "read",  quality: "approve", admin: "none" },
  { role: "Channel Manager", catalog: "read",    channels: "manage",  ops: "read",  quality: "read",    admin: "none" },
  { role: "Connector Admin", catalog: "read",    channels: "config",  ops: "read",  quality: "read",    admin: "limited" },
  { role: "Reviewer",        catalog: "read",    channels: "read",    ops: "read",  quality: "comment", admin: "none" },
  { role: "Viewer",          catalog: "read",    channels: "read",    ops: "read",  quality: "read",    admin: "none" },
] as const;

export type RolePermissionEntry = (typeof ROLE_PERMISSION_MATRIX)[number];

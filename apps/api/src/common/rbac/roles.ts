import { SetMetadata } from "@nestjs/common";

export const APP_ROLES = ["admin", "editor", "reviewer", "viewer"] as const;
export type AppRole = (typeof APP_ROLES)[number];
export const ADMIN_BOUNDARY_ROLES = ["product_admin", "system_admin", "super_admin"] as const;
export type AdminBoundaryRole = (typeof ADMIN_BOUNDARY_ROLES)[number];
export const BLOCKED_FOUNDATION_ROLES = ["category_manager", "vendor"] as const;
export type BlockedFoundationRole = (typeof BLOCKED_FOUNDATION_ROLES)[number];
export const FOUNDATION_ROLES = [...APP_ROLES, ...ADMIN_BOUNDARY_ROLES, ...BLOCKED_FOUNDATION_ROLES] as const;
export type FoundationRole = (typeof FOUNDATION_ROLES)[number];
export const APP_ROLE_PRECEDENCE: readonly AppRole[] = ["admin", "editor", "reviewer", "viewer"];

export const ROLES_KEY = "required_roles";
export const DEFAULT_WRITE_ROLES: readonly AppRole[] = ["admin", "editor"];

export const Roles = (...roles: AppRole[]) => SetMetadata(ROLES_KEY, roles);

import { SetMetadata } from "@nestjs/common";

export const APP_ROLES = ["admin", "editor", "reviewer", "viewer"] as const;
export type AppRole = (typeof APP_ROLES)[number];

export const ROLES_KEY = "required_roles";
export const DEFAULT_WRITE_ROLES: readonly AppRole[] = ["admin", "editor"];

export const Roles = (...roles: AppRole[]) => SetMetadata(ROLES_KEY, roles);

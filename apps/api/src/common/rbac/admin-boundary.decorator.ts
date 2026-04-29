import { SetMetadata } from "@nestjs/common";
import { type AdminBoundaryCapability } from "./role-utils";
import { type AdminBoundaryRole } from "./roles";

export const ADMIN_BOUNDARY_ACCESS_KEY = "admin_boundary_access";

export type AdminBoundaryAccessConfig = {
  capability?: AdminBoundaryCapability;
  allowedRoles?: readonly AdminBoundaryRole[];
  allowLegacyAdminFallback?: boolean;
};

export const AdminBoundaryAccess = (config: AdminBoundaryAccessConfig) =>
  SetMetadata(ADMIN_BOUNDARY_ACCESS_KEY, config);

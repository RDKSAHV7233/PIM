import { SetMetadata } from "@nestjs/common";
import { type BlockedFoundationRole } from "./roles";

export const FOUNDATION_ROLE_ACCESS_KEY = "foundation_role_access";

export type FoundationRoleAccessConfig = {
  allowedRoles: readonly BlockedFoundationRole[];
};

export const FoundationRoleAccess = (...allowedRoles: BlockedFoundationRole[]) =>
  SetMetadata(FOUNDATION_ROLE_ACCESS_KEY, { allowedRoles } satisfies FoundationRoleAccessConfig);

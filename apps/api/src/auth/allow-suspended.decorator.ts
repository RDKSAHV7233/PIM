import { SetMetadata } from "@nestjs/common";

export const ALLOW_SUSPENDED_TENANT_KEY = "allowSuspendedTenantRoute";
export const AllowSuspendedTenant = () => SetMetadata(ALLOW_SUSPENDED_TENANT_KEY, true);

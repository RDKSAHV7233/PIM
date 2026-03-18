import { Transform } from "class-transformer";
import { IsIn, IsString } from "class-validator";
import { APP_ROLES, type AppRole } from "../../common/rbac/roles";

export class UpdateWorkspaceUserRoleDto {
  @Transform(({ value }) => String(value ?? "").trim().toLowerCase())
  @IsString()
  @IsIn(APP_ROLES)
  role!: AppRole;
}

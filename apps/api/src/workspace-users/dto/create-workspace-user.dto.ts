import { Transform } from "class-transformer";
import { IsIn, IsString, MinLength } from "class-validator";
import { APP_ROLES, type AppRole } from "../../common/rbac/roles";

export class CreateWorkspaceUserDto {
  @Transform(({ value }) => String(value ?? "").trim().toLowerCase())
  @IsString()
  @MinLength(1)
  userId!: string;

  @Transform(({ value }) => String(value ?? "").trim().toLowerCase())
  @IsString()
  @IsIn(APP_ROLES)
  role!: AppRole;
}

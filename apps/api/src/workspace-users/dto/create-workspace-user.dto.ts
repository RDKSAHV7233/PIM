import { Transform } from "class-transformer";
import { ArrayUnique, IsArray, IsIn, IsOptional, IsString, MinLength } from "class-validator";
import { APP_ROLES, FOUNDATION_ROLES, type AppRole, type FoundationRole } from "../../common/rbac/roles";

export class CreateWorkspaceUserDto {
  @Transform(({ value }) => String(value ?? "").trim().toLowerCase())
  @IsString()
  @MinLength(1)
  userId!: string;

  @Transform(({ value }) => String(value ?? "").trim().toLowerCase())
  @IsString()
  @IsIn(APP_ROLES)
  role!: AppRole;

  @Transform(({ value }) =>
    Array.isArray(value)
      ? value.map((entry) => String(entry ?? "").trim().toLowerCase()).filter((entry) => entry.length > 0)
      : value,
  )
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(FOUNDATION_ROLES, { each: true })
  assignedRoles?: FoundationRole[];
}

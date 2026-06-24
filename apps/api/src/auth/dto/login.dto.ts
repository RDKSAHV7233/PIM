import { Transform } from "class-transformer";
import { IsIn, IsInt, IsOptional, IsString, Max, Min, MinLength } from "class-validator";
import { Matches, MaxLength } from "class-validator";
import { APP_ROLES } from "../../common/rbac/roles";

export class LoginDto {
  @IsOptional()
  @IsString()
  @IsIn(APP_ROLES)
  role?: string;
  @Transform(({ value }) => String(value ?? "").trim().toLowerCase())
  @IsString()
  @MinLength(3)
  @MaxLength(32)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  @IsOptional()
  workspaceSlug?: string;

  @Transform(({ value }) => String(value ?? "").trim().toLowerCase())
  @IsString()
  @MaxLength(64)
  @IsOptional()
  tenantId?: string;

  @IsString()
  @Transform(({ value }) => String(value ?? "").trim())
  @MinLength(1)
  @MaxLength(255)
  userId!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(4 * 60)
  expiresInMinutes?: number;

  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  password!: string;
}

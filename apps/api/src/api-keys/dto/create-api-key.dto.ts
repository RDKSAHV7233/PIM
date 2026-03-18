import { Transform } from "class-transformer";
import { IsDateString, IsIn, IsOptional, IsString, MaxLength, MinLength } from "class-validator";
import { APP_ROLES, type AppRole } from "../../common/rbac/roles";

export class CreateApiKeyDto {
  @Transform(({ value }) => String(value ?? "").trim())
  @IsString()
  @MinLength(3)
  @MaxLength(80)
  label!: string;

  @Transform(({ value }) => String(value ?? "").trim().toLowerCase())
  @IsString()
  @IsIn(APP_ROLES)
  role!: AppRole;

  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}

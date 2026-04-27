import { Transform } from "class-transformer";
import { ArrayUnique, IsArray, IsDateString, IsIn, IsOptional, IsString, MaxLength, MinLength } from "class-validator";
import { API_CLIENT_SCOPE_VALUES, type ApiClientScope } from "../../common/rbac/api-client-policy.decorator";
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

  @IsOptional()
  @Transform(({ value }) => {
    if (Array.isArray(value)) {
      return value.map((entry) => String(entry ?? "").trim().toLowerCase()).filter(Boolean);
    }
    if (value == null || value === "") {
      return [];
    }
    return [String(value).trim().toLowerCase()].filter(Boolean);
  })
  @IsArray()
  @ArrayUnique()
  @IsIn(API_CLIENT_SCOPE_VALUES, { each: true })
  scopes?: ApiClientScope[];
}

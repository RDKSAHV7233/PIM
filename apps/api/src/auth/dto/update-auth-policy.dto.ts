import { Transform } from "class-transformer";
import { ArrayMinSize, ArrayUnique, IsArray, IsBoolean, IsIn, IsInt, IsOptional, Max, Min } from "class-validator";

const AUTH_POLICY_METHODS = ["password", "oidc"] as const;

export type AuthPolicyMethod = (typeof AUTH_POLICY_METHODS)[number];

export class UpdateAuthPolicyDto {
  @IsOptional()
  @IsBoolean()
  externalIdentityMode?: boolean;

  @IsOptional()
  @IsBoolean()
  mfaRequired?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(90)
  mfaGracePeriodDays?: number;

  @IsOptional()
  @IsInt()
  @Min(15)
  @Max(240)
  sessionTimeoutMinutes?: number;

  @Transform(({ value }) =>
    Array.isArray(value)
      ? value.map((entry) => String(entry ?? "").trim().toLowerCase()).filter((entry) => entry.length > 0)
      : value,
  )
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsIn(AUTH_POLICY_METHODS, { each: true })
  allowedAuthMethods?: AuthPolicyMethod[];
}

import { IsIn, IsString, MaxLength, MinLength } from "class-validator";

export class InternalSetTenantPlanTierDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  tenantKey!: string;

  @IsString()
  @IsIn(["STARTER", "GROWTH", "ENTERPRISE"])
  planTier!: "STARTER" | "GROWTH" | "ENTERPRISE";
}

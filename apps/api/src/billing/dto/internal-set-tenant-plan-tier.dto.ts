import { IsIn, IsString, MinLength } from "class-validator";

export class InternalSetTenantPlanTierDto {
  @IsString()
  @MinLength(1)
  tenantKey!: string;

  @IsString()
  @IsIn(["STARTER", "GROWTH", "ENTERPRISE"])
  planTier!: "STARTER" | "GROWTH" | "ENTERPRISE";
}

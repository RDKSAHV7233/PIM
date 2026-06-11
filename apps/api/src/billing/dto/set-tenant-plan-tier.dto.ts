import { IsIn, IsString } from "class-validator";

export class SetTenantPlanTierDto {
  @IsString()
  @IsIn(["STARTER", "GROWTH", "BUSINESS", "ENTERPRISE"])
  planTier!: "STARTER" | "GROWTH" | "BUSINESS" | "ENTERPRISE";
}

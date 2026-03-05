import { IsIn, IsString } from "class-validator";

export class SetTenantPlanTierDto {
  @IsString()
  @IsIn(["STARTER", "GROWTH", "ENTERPRISE"])
  planTier!: "STARTER" | "GROWTH" | "ENTERPRISE";
}

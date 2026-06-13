import { IsIn, IsOptional, IsString, MaxLength } from "class-validator";

export class CreatePlanUpgradeRequestDto {
  @IsOptional()
  @IsString()
  @IsIn(["STARTER", "GROWTH", "BUSINESS", "ENTERPRISE"])
  requestedPlanTier?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  source?: string;
}

import { Transform } from "class-transformer";
import { IsIn, IsInt, IsOptional, Max, Min } from "class-validator";

export class ListEnrichedTenantsDto {
  @IsOptional()
  @Transform(({ value }) => String(value ?? "").trim().toUpperCase() || undefined)
  @IsIn(["TRIAL", "STARTER", "GROWTH", "BUSINESS", "ENTERPRISE"])
  planTier?: string;

  @IsOptional()
  @Transform(({ value }) => String(value ?? "").trim().toLowerCase() || undefined)
  @IsIn(["trial", "active_paid", "past_due", "cancelled", "expired"])
  billingStatus?: string;

  @IsOptional()
  @Transform(({ value }) => {
    const parsed = Number.parseInt(String(value ?? "").trim(), 10);
    return Number.isFinite(parsed) ? parsed : undefined;
  })
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

import { Transform } from "class-transformer";
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";

export class ListPlanUpgradeRequestsDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  tenantKey?: string;

  @IsOptional()
  @IsString()
  @IsIn(["open", "acknowledged", "resolved", "cancelled"])
  status?: "open" | "acknowledged" | "resolved" | "cancelled";

  @IsOptional()
  @IsString()
  @IsIn(["attention"])
  sla?: "attention";

  @IsOptional()
  @Transform(({ value }) => {
    const parsed = Number.parseInt(String(value ?? "").trim(), 10);
    return Number.isFinite(parsed) ? parsed : undefined;
  })
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}

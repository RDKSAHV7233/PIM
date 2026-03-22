import { Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from "class-validator";

export class ListOutboundWebhookDeliveriesDto {
  @IsOptional()
  @IsString()
  endpointId?: string;

  @IsOptional()
  @IsIn(["queued", "delivered", "failed", "skipped"])
  status?: "queued" | "delivered" | "failed" | "skipped";

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}

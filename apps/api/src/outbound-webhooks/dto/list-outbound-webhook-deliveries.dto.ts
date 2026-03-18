import { IsIn, IsInt, IsOptional, IsString, Max, Min } from "class-validator";

export class ListOutboundWebhookDeliveriesDto {
  @IsOptional()
  @IsString()
  endpointId?: string;

  @IsOptional()
  @IsIn(["queued", "delivered", "failed", "skipped"])
  status?: "queued" | "delivered" | "failed" | "skipped";

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}

import { IsIn } from "class-validator";
import { IsOptional, IsString } from "class-validator";

export const MARKETPLACE_CHANNELS = ["amazon", "flipkart", "meesho"] as const;

export class SimulateMarketplaceDto {
  @IsIn(MARKETPLACE_CHANNELS)
  channel!: (typeof MARKETPLACE_CHANNELS)[number];

  @IsOptional()
  @IsString()
  templateId?: string;
}

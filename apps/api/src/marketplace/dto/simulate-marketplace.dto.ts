import { IsIn } from "class-validator";
import { IsOptional, IsString } from "class-validator";
import { MARKETPLACE_CHANNELS } from "../marketplace-channels";

export class SimulateMarketplaceDto {
  @IsIn(MARKETPLACE_CHANNELS)
  channel!: (typeof MARKETPLACE_CHANNELS)[number];

  @IsOptional()
  @IsString()
  templateId?: string;
}
